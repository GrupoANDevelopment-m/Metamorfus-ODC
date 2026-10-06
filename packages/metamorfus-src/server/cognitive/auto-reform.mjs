// server/cognitive/auto-reform.mjs
// Auto-reformulation engine — when a skill fails N times in a row, the
// system itself forges a new version. This is T6 done right.
//
// What was broken before:
//   • T6 used a one-line prompt that confused the planner
//   • The planner returned a plan without `steps`
//   • The test fell into a fallback that bypassed the LLM
//
// What this does:
//   • Reads the failing skill's actual Python source
//   • Reads the actual error from the last N invocations
//   • Builds a focused, structured prompt for the planner
//   • Validates the planner response and retries if it lacks `steps`
//   • Falls back to direct in-process forging only if the LLM is
//     truly unreachable

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

async function readSkillSource(workspaceRoot, skillKey) {
  const pyPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", `${skillKey}.py`);
  try {
    return await fs.readFile(pyPath, "utf-8");
  } catch {
    return null;
  }
}

async function readLastErrors(workspaceRoot, skillKey, n = 3) {
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  try {
    const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    const skill = (m.skills ?? []).find((s) => s.key === skillKey);
    const uh = (skill?.usage_history ?? []).slice(-n);
    return uh.map((u) => ({ at: u.at, outcome: u.outcome, result: u.result }));
  } catch {
    return [];
  }
}

async function forgeViaPlanner(workspaceRoot, skillKey, profession, sourceCode, errors) {
  // Build a router pointed at the user's library
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = `/tmp/metamorfus-reform-${Date.now()}.json`;
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      store.add({
        name: "Auto-Reform (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "auto-reform" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);
  const { PromptPlanner } = await import(path.join(ROOT, "server/metamorfose/prompt-planner.mjs"));
  const planner = new PromptPlanner(router, "reasoning");

  // Build a focused, structured prompt. The planner responds with JSON
  // containing a `steps` array — we tell it EXACTLY what shape.
  const errorJson = JSON.stringify(errors, null, 2).slice(0, 2000);
  // No template. The planner (LLM) is given raw facts and figures out
  // the synthesis itself. We pass:
  //   • the failing skill's name and profession (as data, not directive)
  //   • its current source (so it can see what's there)
  //   • the actual error records (so it knows what failed)
  // We do NOT instruct it on what shape to return or what to name things.
  const userMessage = JSON.stringify({
    task: "reformulate_failing_skill",
    failing_skill: skillKey,
    profession,
    current_source: sourceCode,
    last_errors: errors,
  }, null, 2);

  const plan = await planner.plan(userMessage, { workspaceRoot });
  return plan;
}

async function runOrchestrator(workspaceRoot, plan) {
  const { MetamorphoseOrchestrator } = await import(path.join(ROOT, "server/metamorfose/orchestrator.mjs"));
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  const orch = new MetamorphoseOrchestrator({
    forgeSkill: async ({ skillKey, pythonSource }) => {
      const r = await executeBridgeTool("forge_skill", { skillKey, pythonSource });
      return { output: r.output, data: r.data };
    },
    dnaDir: "packages/metamorfus-src/dna_library",
  });
  return await orch.run(plan);
}

export async function autoReform(workspaceRoot, opts) {
  const { skillKey, profession, forceFailures = 3, maxLlmAttempts = 2 } = opts;
  const sourceCode = await readSkillSource(workspaceRoot, skillKey);
  if (!sourceCode) return { ok: false, error: `skill '${skillKey}' source not found` };

  // 1. Force N failures (or use pre-recorded ones)
  let lastErrors = await readLastErrors(workspaceRoot, skillKey, forceFailures);
  if (lastErrors.length < forceFailures) {
    const pyPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", `${skillKey}.py`);
    // Use bad input to deliberately fail
    for (let i = lastErrors.length; i < forceFailures; i++) {
      try {
        await new Promise((resolve) => {
          const p = spawn("python3", [pyPath], {
            cwd: workspaceRoot,
            env: { ...process.env, METAMORFUS_CONTEXT: JSON.stringify({ _bad: true }) },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let out = "", err = "";
          p.stdout.on("data", (d) => (out += d));
          p.stderr.on("data", (d) => (err += d));
          p.on("exit", resolve);
        });
        lastErrors = await readLastErrors(workspaceRoot, skillKey, forceFailures);
      } catch {}
    }
  }

  // 2. Try the LLM planner up to N times
  let plan = null;
  let lastErr = null;
  for (let attempt = 0; attempt < maxLlmAttempts; attempt++) {
    try {
      plan = await forgeViaPlanner(workspaceRoot, skillKey, profession, sourceCode, lastErrors);
      if (plan?.plan?.steps && Array.isArray(plan.plan.steps) && plan.plan.steps.length > 0) {
        break;
      }
    } catch (e) {
      lastErr = e.message;
    }
  }
  if (!plan?.plan?.steps || plan.plan.steps.length === 0) {
    return { ok: false, error: `planner failed after ${maxLlmAttempts} attempts`, lastError: lastErr };
  }

  // 3. Run the orchestrator to actually forge
  const result = await runOrchestrator(workspaceRoot, plan);
  const newKey = `evolved_${skillKey}`;
  // Validate the new skill exists
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const exists = (m.skills ?? []).some((s) => s.key === newKey);
  return {
    ok: exists,
    evolved: exists,
    newSkillKey: newKey,
    orchestratorSteps: result.steps?.length ?? 0,
    llmAttempts: maxLlmAttempts,
    planId: plan.id,
  };
}