/**
 * @metamorfus-odc/opencode-bridge
 *
 * Thin adapter between the Metamorfus ODC server (server.ts) and the OpenCode
 * headless server (`opencode serve`). Replaces the manual NVIDIA → Kimi →
 * Mistral fallback chain with a single call to OpenCode, which then routes
 * to whichever provider is configured.
 *
 * The Cortex (in Cortex.py / constants.ts) continues to use the
 * `self.api_proxy_url` indirection, so all LLM calls — including those
 * originating from the Python simulation — now flow through OpenCode.
 *
 * Configuration (env):
 *   OPENCODE_URL   — default http://localhost:4096
 *   OPENCODE_AGENT — default "cortex"
 */

import path from "node:path";

export interface BridgeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BridgeRequest {
  messages: BridgeMessage[];
  /** Provider override (anthropic, openai, google, ollama, ...). Optional. */
  provider?: string;
  /** Model override. Optional. */
  model?: string;
  /** Temperature. Defaults to 0.7 (matches the existing Metamorfus default). */
  temperature?: number;
  /** Max tokens. Defaults to 4096 (matches the existing Metamorfus default). */
  maxTokens?: number;
  /** Per-request timeout in ms. Defaults to 120000 (matches the original 2-min cap). */
  timeoutMs?: number;
}

export interface BridgeUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface BridgeResponse {
  /** Assistant message content (string). */
  content: string;
  /** Model that produced the response (echoed by OpenCode). */
  model: string;
  /** Provider that produced the response (echoed by OpenCode). */
  provider: string;
  /** OpenCode session id (so callers can resume). */
  sessionId: string;
  /** Token usage (best effort — OpenCode may return 0 if not enabled). */
  usage: BridgeUsage;
}

const OPENCODE_URL: string = (process.env.OPENCODE_URL ?? "http://localhost:4096").replace(/\/+$/, "");
const METAMORFUS_AGENT: string = process.env.OPENCODE_AGENT ?? "cortex";

import { executeTool, listTools } from "./opencode-tools/registry.js";

/**
 * In-process tool registry (Option B). When the OpenCode sidecar is
 * reachable, OpenCode invokes these tools natively via the `tools` block
 * in `opencode.jsonc`. When it isn't (or when a host route wants to skip
 * the sidecar), `executeBridgeTool` does the same job directly. The two
 * paths share the exact same `execute()` implementation, so a tool
 * invoked by the sidecar and a tool invoked directly behave identically.
 */
export const FALLBACK_TOOLS = listTools();

export async function executeBridgeTool(
  name: string,
  args: Record<string, unknown>,
  ctx?: { workspaceRoot?: string; dnaDir?: string },
) {
  // A malformed context used to fail SILENTLY: passing a bare string
  // instead of `{ workspaceRoot }` left `ctx.workspaceRoot` undefined,
  // and the tool then wrote into `cwd/../..` — the installed package
  // — instead of the caller's workspace. Every forged skill landed in
  // the wrong place and nobody was told. Now it is an error.
  if (ctx !== undefined && (typeof ctx !== "object" || ctx === null || Array.isArray(ctx))) {
    throw new Error(
      `executeBridgeTool("${name}"): ctx must be { workspaceRoot?, dnaDir? }, got ${typeof ctx}. ` +
      `Passing a bare string silently wrote into the installed package instead of the workspace.`,
    );
  }
  const workspaceRoot = ctx?.workspaceRoot ?? path.resolve(process.cwd(), "../..");
  const dnaDir = ctx?.dnaDir;
  return executeTool(name, args, {
    workspaceRoot,
    env: process.env,
    ...(dnaDir ? { dnaDir } : {}),
  });
}

/**
 * OpenCode's health endpoint. It used to be `/health`; the current
 * server exposes it at `/global/health`
 * (packages/opencode/src/server/routes/instance/httpapi/groups/global.ts).
 * The bridge asked for `/health`, got a 404, and reported the sidecar
 * as unreachable — so the OpenCode path never engaged and every chat
 * silently fell back to the local LLM library. Both paths are tried.
 */
const HEALTH_PATHS = ["/global/health", "/health"];

/**
 * Quick reachability check used by /api/chat to fail fast with a 503 when
 * the OpenCode sidecar is down. Cheap — short timeout, single GET.
 */
export async function ping(): Promise<boolean> {
  for (const p of HEALTH_PATHS) {
    try {
      const res = await fetch(`${OPENCODE_URL}${p}`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // try the next path
    }
  }
  return false;
}

/**
 * Run a chat completion through OpenCode. Mirrors the previous
 * `server.ts` contract: a list of messages, returns a single assistant
 * message in OpenAI-compatible shape. Used by /api/chat.
 */
export async function complete(req: BridgeRequest): Promise<BridgeResponse> {
  const timeoutMs = req.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // 1) Create (or reuse) a session. OpenCode routes per-session context.
    const sessionRes = await fetch(`${OPENCODE_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    if (!sessionRes.ok) {
      const err = await safeText(sessionRes);
      throw new Error(`OpenCode session.create failed (${sessionRes.status}): ${err}`);
    }
    const session = (await sessionRes.json()) as { id?: string; info?: { id?: string } };
    const sessionId: string = session.id ?? session.info?.id ?? "";
    if (!sessionId) throw new Error("OpenCode session.create returned no id");

    // 2) Build the parts payload. OpenCode accepts a `parts` array of typed
    //    segments; text-only is enough for the Metamorfus use case.
    const parts = req.messages.map((m) => ({
      type: "text" as const,
      text: m.content,
    }));

    const body: Record<string, unknown> = {
      agent: METAMORFUS_AGENT,
      parts,
      // PromptInput has no temperature/maxTokens — OpenCode's schema
      // ignores excess properties, and the model config carries the
      // sampling settings. They are kept out of the request so the
      // payload matches the server's schema exactly.
    };
    // `model` must be a ModelRef ({ id, providerID }), not a string:
    // SessionPrompt.PromptInput validates its type, so a bare string
    // is rejected with a 400 and the whole OpenCode path fails.
    if (req.model) body.model = toModelRef(req.model);

    const promptRes = await fetch(
      `${OPENCODE_URL}/session/${encodeURIComponent(sessionId)}/message`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    );
    if (!promptRes.ok) {
      const err = await safeText(promptRes);
      throw new Error(`OpenCode prompt failed (${promptRes.status}): ${err}`);
    }
    // OpenCode returns SessionV1.WithParts: { info, parts }. The
    // assistant's text lives in parts[] (each { type, text }); the
    // legacy shape { content } is still accepted.
    const result = (await promptRes.json()) as {
      content?: string;
      parts?: Array<{ type?: string; text?: string }>;
      info?: {
        modelID?: string;
        providerID?: string;
        tokens?: {
          total?: number;
          input?: number;
          output?: number;
          reasoning?: number;
          cache?: { read?: number; write?: number };
        };
      };
      model?: string;
      provider?: string;
      usage?: Partial<BridgeUsage>;
    };

    const text =
      typeof result.content === "string"
        ? result.content
        : (result.parts ?? [])
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text as string)
            .join("");

    const tokens = result.info?.tokens;
    const usage: BridgeUsage = {
      promptTokens: tokens?.input ?? result.usage?.promptTokens ?? 0,
      completionTokens: tokens?.output ?? result.usage?.completionTokens ?? 0,
      totalTokens: tokens?.total ?? result.usage?.totalTokens ?? 0,
    };

    return {
      content: text,
      model: result.info?.modelID ?? result.model ?? req.model ?? "opencode-default",
      provider: result.info?.providerID ?? result.provider ?? req.provider ?? "opencode-default",
      sessionId,
      usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Converts a model id into OpenCode's ModelRef.
 * OpenCode splits ids as `provider/model`
 * (packages/opencode/src/provider/provider.ts:2029).
 */
export function toModelRef(model: string): { id: string; providerID: string } {
  const separator = model.indexOf("/");
  if (separator <= 0) return { id: model, providerID: model };
  return { id: model, providerID: model.slice(0, separator) };
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}
