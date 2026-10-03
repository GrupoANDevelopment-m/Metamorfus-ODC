// LLM provider adapters.
//
// Each adapter takes a config (from the LLM Library) plus a request and
// returns a normalized shape:
//
//   { content, reasoning, model, provider, sessionId,
//     usage: { promptTokens, completionTokens, totalTokens } }
//
// The router (router.mjs) treats all providers identically, so adding
// a new provider = one new function in PROVIDERS map.
//
// Supported providers:
//   • openai-compatible — NVIDIA NIM, OpenAI, Mistral, DeepSeek,
//                          Groq, Together, OpenRouter, xAI/Grok,
//                          Perplexity, Cohere-via-openai
//   • anthropic          — Claude (Messages API, x-api-key auth)
//   • google             — Gemini (generateContent, ?key= query auth)

const DEFAULT_TIMEOUT_MS = 120_000;

async function openaiCompatible(config, req) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    /** @type {Record<string, any>} */
    const body = {
      model: config.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: false,
    };
    // kimi-k3 reasoning toggle — keeps the model from burning budget
    // on internal monologue before producing visible content.
    if (typeof config.model === "string" && config.model.toLowerCase().includes("kimi")) {
      body.chat_template_kwargs = { enable_thinking: true };
    }
    const resp = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(config.metadata?.extraHeaders ?? {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new ProviderError(resp.status, resp.statusText, errText);
    }
    const data = await resp.json();
    const choice = data?.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      reasoning: choice?.message?.reasoning_content ?? null,
      model: data?.model ?? config.model,
      provider: config.provider,
      sessionId: `${config.provider}-${Date.now().toString(36)}`,
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

async function anthropic(config, req) {
  // OpenAI-style messages → Anthropic's {system, messages}.
  const sysMsg = req.messages.find((m) => m.role === "system");
  const chatMessages = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const body = {
    model: config.model,
    messages: chatMessages,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature ?? 0.7,
    ...(sysMsg ? { system: sysMsg.content } : {}),
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new ProviderError(resp.status, resp.statusText, errText);
    }
    const data = await resp.json();
    const text = (data?.content ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    return {
      content: text,
      reasoning: null,
      model: data?.model ?? config.model,
      provider: "anthropic",
      sessionId: `anthropic-${Date.now().toString(36)}`,
      usage: {
        promptTokens: data?.usage?.input_tokens ?? 0,
        completionTokens: data?.usage?.output_tokens ?? 0,
        totalTokens: (data?.usage?.input_tokens ?? 0) + (data?.usage?.output_tokens ?? 0),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function google(config, req) {
  const sysMsg = req.messages.find((m) => m.role === "system");
  const userMessages = req.messages.filter((m) => m.role !== "system");
  const contents = userMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = {
    contents,
    generationConfig: {
      temperature: req.temperature ?? 0.7,
      maxOutputTokens: req.maxTokens ?? 4096,
    },
    ...(sysMsg ? { systemInstruction: { parts: [{ text: sysMsg.content }] } } : {}),
  };
  const url = `${config.endpoint.replace(/\/$/, "")}/${config.model}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new ProviderError(resp.status, resp.statusText, errText);
    }
    const data = await resp.json();
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    const usage = data?.usageMetadata ?? {};
    return {
      content: text,
      reasoning: null,
      model: config.model,
      provider: "google",
      sessionId: `google-${Date.now().toString(36)}`,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export class ProviderError extends Error {
  constructor(status, statusText, body) {
    super(`${status} ${statusText}: ${String(body).slice(0, 200)}`);
    this.name = "ProviderError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export const PROVIDERS = {
  "openai-compatible": openaiCompatible,
  "nvidia-direct": openaiCompatible, // alias — same wire format
  anthropic: anthropic,
  google: google,
};

export async function callProvider(config, req) {
  const fn = PROVIDERS[config.provider];
  if (!fn) throw new Error(`unknown provider: ${config.provider}`);
  return await fn(config, req);
}

/** Provider presets the UI uses to pre-fill the "add" form. */
export const PROVIDER_PRESETS = [
  {
    provider: "nvidia-direct",
    label: "NVIDIA NIM",
    category: "multimodal",
    endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
    modelHint: "moonshotai/kimi-k3",
  },
  {
    provider: "openai-compatible",
    label: "Kimi (Moonshot)",
    category: "text",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    modelHint: "moonshot-v1-8k",
  },
  {
    provider: "openai-compatible",
    label: "OpenAI",
    category: "text",
    endpoint: "https://api.openai.com/v1/chat/completions",
    modelHint: "gpt-4o-mini",
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    category: "reasoning",
    endpoint: "https://api.anthropic.com/v1/messages",
    modelHint: "claude-3-5-sonnet-latest",
  },
  {
    provider: "google",
    label: "Google Gemini",
    category: "multimodal",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    modelHint: "gemini-2.0-flash",
  },
  {
    provider: "openai-compatible",
    label: "Mistral",
    category: "text",
    endpoint: "https://api.mistral.ai/v1/chat/completions",
    modelHint: "mistral-large-latest",
  },
  {
    provider: "openai-compatible",
    label: "DeepSeek",
    category: "reasoning",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    modelHint: "deepseek-reasoner",
  },
  {
    provider: "openai-compatible",
    label: "Groq",
    category: "text",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    modelHint: "llama-3.3-70b-versatile",
  },
  {
    provider: "openai-compatible",
    label: "Together",
    category: "text",
    endpoint: "https://api.together.xyz/v1/chat/completions",
    modelHint: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  {
    provider: "openai-compatible",
    label: "OpenRouter",
    category: "text",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelHint: "anthropic/claude-3.5-sonnet",
  },
  {
    provider: "openai-compatible",
    label: "xAI (Grok)",
    category: "text",
    endpoint: "https://api.x.ai/v1/chat/completions",
    modelHint: "grok-2-latest",
  },
];
