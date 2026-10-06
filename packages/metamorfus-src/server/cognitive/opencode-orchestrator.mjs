// server/cognitive/opencode-orchestrator.mjs
// Routes requests to the correct OpenCode agent based on intent:
//   • cortex   — planning, reasoning, conversation
//   • executor — concrete skill execution, action-taking
//   • forge    — meta-programming, skill creation
//
// What was broken before:
//   • The bridge called cortex for everything, ignoring executor/forge
//   • cortex never delegated — it answered everything itself
//   • Multi-agent orchestration was advertised in opencode.jsonc but
//     never actually wired up
//
// What this does:
//   • classifyIntent() — picks the right agent from the request shape
//   • orchestrate()    — runs the agent, with fallback to a local
//     multi-step orchestration when OpenCode is unreachable

import path from "node:path";
import fs from "node:fs/promises";
import fssync from "node:fs";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Classify the request intent. Three classes:
 *   • "plan"   — high-level strategy, MHU chain, multi-step planning
 *   • "exec"   — concrete skill invocation, action-taking
 *   • "forge"  — meta-programming: create / refactor skills
 *
 * No templates. The classification is done by the LLM itself. We
 * give it the conversation, ask which agent is the right handler,
 * and parse the structured JSON response. This means the system's
 * routing adapts to whatever the LLM understands, not to whatever
 * keywords we hardcoded.
 */
export async function classifyIntent(req) {
  const body = req?.body ?? {};
  const explicitAgent = body.agent;
  if (explicitAgent && ["cortex", "executor", "forge"].includes(explicitAgent)) return explicitAgent;

  // Defer to the LLM — pass the conversation, get a JSON back
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = "/tmp/metamorfus-classify-library.json";
  try { fssync.unlinkSync(libPath); } catch {}
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      store.add({
        name: "Classify (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "opencode-classify" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);
  const messages = body.messages ?? [];
  const userText = messages.map((m) => `${m.role}: ${m.content ?? ""}`).join("\n").slice(0, 4000);
  let r;
  try {
    r = await router.complete("reasoning", {
      messages: [
        {
          role: "system",
          content: "You are a router for a multi-agent cognitive system. Classify the user's request into ONE of three agents:\n\n" +
                   "  • cortex   — strategic reasoning, planning, analysis, conversation, advice, answers to questions\n" +
                   "  • executor — concrete action: invoke a specific skill, run a tool, take a direct action\n" +
                   "  • forge    — meta-programming: create a new skill, refactor an existing one, improve the system itself\n\n" +
                   "Return JSON: {\"agent\": \"cortex|executor|forge\", \"confidence\": <0-1>, \"reason\": \"<one sentence>\"}",
        },
        { role: "user", content: userText || "(empty request)" },
      ],
      temperature: 0.1,
      maxTokens: 200,
    });
  } catch (e) {
    // No LLM available — safe default is cortex (the conversational
    // agent handles whatever the user says).
    return "cortex";
  }
  const m = (r.content || "").match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (["cortex", "executor", "forge"].includes(parsed.agent)) return parsed.agent;
    } catch {}
  }
  return "cortex";  // safe default
}

/**
 * Orchestrate a request through the right agent. If OpenCode is
 * reachable, we delegate to it. If not, we run a local fallback
 * that respects the same intent boundaries.
 */
export async function orchestrate(req) {
  const intent = await classifyIntent(req);
  const opencodeUp = await pingOpencode();
  if (opencodeUp) {
    try {
      const { complete } = await import(path.join(ROOT, "server/odc-opencode-bridge.ts"));
      const r = await complete({
        agent: intent,
        messages: req.body?.messages ?? [],
        temperature: req.body?.temperature ?? (intent === "forge" ? 0.8 : intent === "executor" ? 0.3 : 0.7),
        maxTokens: req.body?.max_tokens ?? 4096,
      });
      return { agent: intent, backend: "opencode", ...r };
    } catch (e) {
      // OpenCode failed; fall through to local
    }
  }
  return await localOrchestrate(intent, req);
}

async function pingOpencode() {
  try {
    const { ping } = await import(path.join(ROOT, "server/odc-opencode-bridge.ts"));
    return await ping();
  } catch {
    return false;
  }
}

/**
 * Local multi-agent fallback. Each "agent" is a different system
 * instruction with a different temperature bias. The dispatcher:
 *   • cortex   — passes the conversation to the LLM router (which
 *                picks the right provider from the LLM library)
 *   • executor — resolves the right skill from the manifest and
 *                invokes it via skills/runner.mjs
 *   • forge    — calls the PromptPlanner + Orchestrator to forge a
 *                new skill based on the request
 */
async function localOrchestrate(intent, req) {
  if (intent === "executor") {
    return await localExecutor(req);
  }
  if (intent === "forge") {
    return await localForge(req);
  }
  // cortex: route through LLM router
  return await localCortex(req);
}

async function localCortex(req) {
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = "/tmp/metamorfus-cortex-library.json";
  try { fssync.unlinkSync(libPath); } catch {}
  const store = new LlmLibraryStore(libPath);
  await store.load();
  // If NVIDIA key is in the env and no text provider exists, register one.
  if (process.env.NVIDIA_API_KEY) {
    const hasText = store.list({ category: "text" }).length > 0;
    if (!hasText) {
      store.add({
        name: "Cortex (env)",
        provider: "nvidia-direct",
        category: "text",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "opencode-orchestrator-cortex" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);
  const result = await router.complete("text", {
    messages: req.body?.messages ?? [],
    temperature: req.body?.temperature ?? 0.7,
    maxTokens: req.body?.max_tokens ?? 4096,
  });
  return { agent: "cortex", backend: "local-llm-library", content: result.content, model: result.model, provider: result.provider };
}

async function localExecutor(req) {
  // Extract a skill name from the last user turn
  const text = (req.body?.messages ?? []).map((m) => m.content ?? "").join(" ");
  const skillMatch = text.match(/\b([a-z][a-z0-9_]+_protocol)\b/);
  if (!skillMatch) {
    return { agent: "executor", backend: "local", content: "no skill specified", ok: false };
  }
  const skillKey = skillMatch[1];
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const ws = req.tenant?.workspaceRoot ?? req.body?.workspaceRoot;
  if (!ws) return { agent: "executor", backend: "local", ok: false, error: "no workspace" };
  const result = await runSkill(ws, {
    skillKey,
    byProfession: "executor",
    context: req.body?.context ?? {},
  });
  return { agent: "executor", backend: "local-runner", content: JSON.stringify(result.result), ok: result.ok, ...result };
}

async function localForge(req) {
  const text = (req.body?.messages ?? []).map((m) => m.content ?? "").join(" ");
  // Forge the skill using the planner + orchestrator
  const { PromptPlanner } = await import(path.join(ROOT, "server/metamorfose/prompt-planner.mjs"));
  const { MetamorphoseOrchestrator } = await import(path.join(ROOT, "server/metamorfose/orchestrator.mjs"));
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = "/tmp/metamorfus-forge-library.json";
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      store.add({
        name: "Forge (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "forge" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);
  const planner = new PromptPlanner(router, "reasoning");
  const ws = req.tenant?.workspaceRoot ?? req.body?.workspaceRoot;
  const plan = await planner.plan(text, { workspaceRoot: ws });
  if (!plan?.plan?.steps || plan.plan.steps.length === 0) {
    return { agent: "forge", backend: "local", ok: false, error: "planner returned no steps" };
  }
  const orch = new MetamorphoseOrchestrator({
    forgeSkill: async ({ skillKey, pythonSource }) => {
      const r = await executeBridgeTool("forge_skill", { skillKey, pythonSource });
      return { output: r.output, data: r.data };
    },
    dnaDir: "packages/metamorfus-src/dna_library",
  });
  const result = await orch.run(plan);
  return {
    agent: "forge",
    backend: "local-planner-orchestrator",
    ok: true,
    stepsRun: result.steps?.length ?? 0,
    stepStatuses: result.steps?.map((s) => ({ kind: s.kind, status: s.status, skillKey: s.skillKey })) ?? [],
  };
}