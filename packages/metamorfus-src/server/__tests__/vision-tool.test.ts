/**
 * Tests for vision-tool — the wrapper around NVIDIA NIM's moonshotai/kimi-k3
 * vision endpoint that backs the `vision_describe_protocol` organism skill.
 *
 * Strategy: stub `globalThis.fetch` so each test controls the simulated
 * response from the NVIDIA API. No live API call required.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeImage,
  buildVisionIntention,
  VISION_SKILL_KEY,
} from "../vision-tool.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

type FetchCall = { url: string; init?: RequestInit };

function installFetchMock(impl: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  const stub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({ url, init });
    return impl({ url, init });
  };
  globalThis.fetch = stub;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

const SAMPLE_NVIDIA_OK = {
  choices: [
    {
      message: {
        role: "assistant",
        content: "A wooden boardwalk through a marsh.",
        reasoning_content: "It is clearly a wetland trail.",
      },
    },
  ],
  model: "moonshotai/kimi-k3",
  usage: { prompt_tokens: 650, completion_tokens: 12, total_tokens: 662 },
};

// ----------------------------------------------------------------------------
// buildVisionIntention()
// ----------------------------------------------------------------------------

test("buildVisionIntention: returns the canonical skill intention shape", () => {
  const intention = buildVisionIntention("https://x/y.jpg", "What?");
  assert.equal(intention.action, "VISION_DESCRIBE");
  assert.equal(intention.version, 1);
  assert.equal(intention.intensity, 0.5);
  assert.deepEqual(intention.required_attributes, { cpu: 30 });
  assert.equal((intention.params as any).image_url, "https://x/y.jpg");
  assert.equal((intention.params as any).prompt, "What?");
});

test("buildVisionIntention: prompt defaults to null when omitted", () => {
  const intention = buildVisionIntention("https://x/y.jpg");
  assert.equal((intention.params as any).prompt, null);
});

test("VISION_SKILL_KEY: matches the organism DNA library convention", () => {
  assert.equal(VISION_SKILL_KEY, "vision_describe_protocol");
});

// ----------------------------------------------------------------------------
// describeImage()
// ----------------------------------------------------------------------------

test("describeImage: throws when NVIDIA_API_KEY is not set", async () => {
  const previous = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  try {
    await assert.rejects(
      () => describeImage({ imageUrl: "https://x/y.jpg" }),
      /NVIDIA_API_KEY not configured/,
    );
  } finally {
    if (previous !== undefined) process.env.NVIDIA_API_KEY = previous;
  }
});

test("describeImage: throws when imageUrl is missing", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() => jsonResponse({}));
  try {
    await assert.rejects(
      () => describeImage({ imageUrl: "" }),
      /imageUrl is required/,
    );
    assert.equal(mock.calls.length, 0, "fetch must not be called for invalid input");
  } finally {
    mock.restore();
  }
});

test("describeImage: posts to NVIDIA with the expected payload", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() => jsonResponse(SAMPLE_NVIDIA_OK));
  try {
    const result = await describeImage({
      imageUrl: "https://x/y.jpg",
      prompt: "What?",
    });
    assert.equal(mock.calls.length, 1);
    const call = mock.calls[0]!;
    assert.equal(call.url, "https://integrate.api.nvidia.com/v1/chat/completions");
    assert.equal(call.init?.method, "POST");
    const headers = call.init?.headers as Record<string, string> | undefined;
    assert.match(String(headers?.Authorization), /^Bearer nvapi-test$/);

    const body = JSON.parse(String(call.init?.body));
    assert.equal(body.model, "moonshotai/kimi-k3");
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages[0].content, [
      { type: "text", text: "What?" },
      { type: "image_url", image_url: { url: "https://x/y.jpg" } },
    ]);

    assert.equal(result.description, "A wooden boardwalk through a marsh.");
    assert.equal(result.reasoning, "It is clearly a wetland trail.");
    assert.equal(result.model, "moonshotai/kimi-k3");
    assert.deepEqual(result.usage, {
      promptTokens: 650,
      completionTokens: 12,
      totalTokens: 662,
    });
  } finally {
    mock.restore();
  }
});

test("describeImage: uses default prompt when omitted", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() => jsonResponse(SAMPLE_NVIDIA_OK));
  try {
    await describeImage({ imageUrl: "https://x/y.jpg" });
    const body = JSON.parse(String(mock.calls[0]!.init?.body));
    assert.equal(body.messages[0].content[0].text, "Describe this image in detail.");
  } finally {
    mock.restore();
  }
});

test("describeImage: throws with a useful prefix when NVIDIA returns 4xx/5xx", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() => textResponse("rate limited", 429));
  try {
    await assert.rejects(
      () => describeImage({ imageUrl: "https://x/y.jpg" }),
      /NVIDIA vision call failed: 429/,
    );
  } finally {
    mock.restore();
  }
});

test("describeImage: tolerates missing reasoning_content", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() =>
    jsonResponse({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      model: "moonshotai/kimi-k3",
    }),
  );
  try {
    const result = await describeImage({ imageUrl: "https://x/y.jpg" });
    assert.equal(result.description, "ok");
    assert.equal(result.reasoning, null);
  } finally {
    mock.restore();
  }
});

test("describeImage: honors model override", async () => {
  process.env.NVIDIA_API_KEY = "nvapi-test";
  const mock = installFetchMock(() => jsonResponse(SAMPLE_NVIDIA_OK));
  try {
    await describeImage({
      imageUrl: "https://x/y.jpg",
      model: "custom/model-v1",
    });
    const body = JSON.parse(String(mock.calls[0]!.init?.body));
    assert.equal(body.model, "custom/model-v1");
  } finally {
    mock.restore();
  }
});
