/**
 * Vision tool — wraps NVIDIA NIM with the moonshotai/kimi-k3 vision model.
 *
 * This is the implementation backing the organism's `vision_describe_protocol`
 * skill: when the Executor (or ChatPanel) needs to make sense of an image,
 * it calls `describeImage(url, prompt)` and gets back a structured observation.
 *
 * Note: NVIDIA API key is read from the existing env surface. The key is
 * supplied by the user via SettingsModal (NVIDIA_API_KEY in the .env). We
 * never log the key. We never echo the raw error from NVIDIA back to the UI
 * beyond a short prefix.
 */

const NVIDIA_INVOKE_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";
const DEFAULT_VISION_MODEL = "moonshotai/kimi-k3";
const DEFAULT_TIMEOUT_MS = 120_000;

export interface VisionRequest {
  /** Public URL of the image to describe. The vision model fetches it. */
  imageUrl: string;
  /** Optional question / instruction. Defaults to "Describe this image in detail." */
  prompt?: string;
  /** Optional model override. Defaults to the configured vision model. */
  model?: string;
  /** Max tokens for the description. Defaults to 4096. */
  maxTokens?: number;
}

export interface VisionResponse {
  description: string;
  model: string;
  reasoning: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

function getApiKey(): string | null {
  // Order: process.env NVIDIA_API_KEY (set by .env or host). The SettingsModal
  // in the UI persists into localStorage but we never accept user-supplied keys
  // in server-side calls; the operator must put the key in .env.
  const key = process.env.NVIDIA_API_KEY;
  return key && key.length > 0 ? key : null;
}

export async function describeImage(req: VisionRequest): Promise<VisionResponse> {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      "NVIDIA_API_KEY not configured. Set it in packages/metamorfus-src/.env.",
    );
  }
  if (!req.imageUrl || typeof req.imageUrl !== "string") {
    throw new Error("imageUrl is required and must be a string");
  }

  const payload = {
    messages: [
      {
        role: "user" as const,
        content: [
          { type: "text" as const, text: req.prompt ?? "Describe this image in detail." },
          {
            type: "image_url" as const,
            image_url: { url: req.imageUrl },
          },
        ],
      },
    ],
    model: req.model ?? DEFAULT_VISION_MODEL,
    max_tokens: req.maxTokens ?? 4096,
    stream: false,
    temperature: 1,
    top_p: 0.95,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(NVIDIA_INVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => "");
      throw new Error(
        `NVIDIA vision call failed: ${resp.status} ${resp.statusText} ${errBody.slice(0, 200)}`.trim(),
      );
    }

    const data = (await resp.json()) as {
      choices?: Array<{
        message?: { content?: string; reasoning_content?: string };
      }>;
      model?: string;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = data.choices?.[0];
    const description = choice?.message?.content ?? "";
    const reasoning = choice?.message?.reasoning_content ?? null;
    const usage = {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    };

    return {
      description,
      reasoning,
      model: data.model ?? payload.model,
      usage,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Skill registration shape — the Executor (System 1) and the Cortex (System 2)
 * look up skills in `organism.dna.library` by key. When the user asks for
 * "describe the image", the Cortex routes to `vision_describe_protocol` and
 * this is the implementation invoked.
 */
export const VISION_SKILL_KEY = "vision_describe_protocol";

/**
 * Pure intention shape returned to the kernel — mirrors the GeneticForge
 * contract from constants.ts.
 */
export function buildVisionIntention(imageUrl: string, prompt?: string) {
  return {
    action: "VISION_DESCRIBE",
    intensity: 0.5,
    required_attributes: { cpu: 30 },
    version: 1,
    params: { image_url: imageUrl, prompt: prompt ?? null },
  };
}
