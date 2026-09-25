// Direct NVIDIA NIM bridge — calls the OpenAI-compatible chat
// completions endpoint at integrate.api.nvidia.com. This is the
// fallback LLM backend when OpenCode sidecar is unreachable but the
// operator wants real LLM responses (no mocks).
//
// We deliberately keep this separate from odc-opencode-bridge.ts so
// the bridge logic stays pure (HTTP shape). This module is a thin
// adapter over NVIDIA's OpenAI-compatible API.
//
// Used by:
//   • headless-server.mjs (when OPENCODE_URL is unreachable or absent)
//   • tests (the "100% real, no mocks" requirement — every test calls
//     the actual NVIDIA NIM endpoint)

const NVIDIA_INVOKE_URL =
  process.env.NVIDIA_INVOKE_URL ?? "https://integrate.api.nvidia.com/v1/chat/completions";

export const PROVIDER_NAME = "nvidia-direct";

/**
 * Stream a chat completion from NVIDIA NIM. Returns the same shape
 * the OpenCode bridge returns so callers don't care which backend
 * served the request.
 *
 * @param {{
 *   messages: Array<{role: "system"|"user"|"assistant", content: string}>,
 *   model?: string,
 *   temperature?: number,
 *   maxTokens?: number,
 *   apiKey?: string,
 *   timeoutMs?: number,
 * }} req
 * @returns {Promise<{
 *   content: string,
 *   reasoning: string | null,
 *   model: string,
 *   provider: string,
 *   sessionId: string,
 *   usage: { promptTokens: number, completionTokens: number, totalTokens: number },
 * }>}
 */
export async function nvidiaComplete(req) {
  const apiKey = req.apiKey ?? process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_API_KEY not set. Required for the NVIDIA-direct backend. " +
        "Either set the env var, or use OpenCode sidecar (set OPENCODE_URL).",
    );
  }
  const model = req.model ?? "moonshotai/kimi-k3";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
  try {
    const resp = await fetch(NVIDIA_INVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 4096,
        stream: false,
        // kimi-k3 exposes reasoning_content. Setting enable_thinking
        // to true prevents the model from spending its entire
        // completion budget on internal monologue before producing
        // the visible answer.
        chat_template_kwargs: { enable_thinking: true },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `NVIDIA NIM ${resp.status} ${resp.statusText}: ${errText.slice(0, 200)}`,
      );
    }
    const data = await resp.json();
    const choice = data?.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      reasoning: choice?.message?.reasoning_content ?? null,
      model: data?.model ?? model,
      provider: PROVIDER_NAME,
      sessionId: `nvidia-${Date.now().toString(36)}`,
      usage: {
        promptTokens: data?.usage?.prompt_tokens ?? 0,
        completionTokens: data?.usage?.completion_tokens ?? 0,
        totalTokens: data?.usage?.total_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheap reachability check used by the headless server to decide
 * which backend to route to. Returns true iff the API key is present.
 * (We don't make a real ping call here — the operator may not have
 * credits to spare on a smoke test.)
 */
export function nvidiaAvailable() {
  return Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.length > 0);
}
