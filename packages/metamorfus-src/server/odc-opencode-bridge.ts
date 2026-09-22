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
  const workspaceRoot = ctx?.workspaceRoot ?? path.resolve(process.cwd(), "../..");
  const dnaDir = ctx?.dnaDir;
  return executeTool(name, args, {
    workspaceRoot,
    env: process.env,
    ...(dnaDir ? { dnaDir } : {}),
  });
}

/**
 * Quick reachability check used by /api/chat to fail fast with a 503 when
 * the OpenCode sidecar is down. Cheap — short timeout, single GET.
 */
export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${OPENCODE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
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
    const session = (await sessionRes.json()) as { id?: string };
    if (!session.id) throw new Error("OpenCode session.create returned no id");
    const sessionId: string = session.id;

    // 2) Build the parts payload. OpenCode accepts a `parts` array of typed
    //    segments; text-only is enough for the Metamorfus use case.
    const parts = req.messages.map((m) => ({
      type: "text" as const,
      text: m.content,
    }));

    const body: Record<string, unknown> = {
      agent: METAMORFUS_AGENT,
      parts,
      temperature: req.temperature ?? 0.7,
      maxTokens: req.maxTokens ?? 4096,
    };
    if (req.provider) body.provider = req.provider;
    if (req.model) body.model = req.model;

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
    const result = (await promptRes.json()) as {
      content?: string;
      model?: string;
      provider?: string;
      usage?: Partial<BridgeUsage>;
    };

    const usage: BridgeUsage = {
      promptTokens: result.usage?.promptTokens ?? 0,
      completionTokens: result.usage?.completionTokens ?? 0,
      totalTokens: result.usage?.totalTokens ?? 0,
    };

    return {
      content: result.content ?? "",
      model: result.model ?? req.model ?? "opencode-default",
      provider: result.provider ?? req.provider ?? "opencode-default",
      sessionId,
      usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}
