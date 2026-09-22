// Simulates the cortex+executor+forge multi-agent flow against the
// real NVIDIA NIM provider (moonshotai/kimi-k3). This exercises only the
// Cortex prompt directly; Executor and Forge are also exercised separately
// in the script to prove the orchestration works end-to-end without needing
// an OpenCode sidecar.

import fs from "node:fs/promises";
import path from "node:path";

const NVIDIA_INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const VISION_MODEL = "moonshotai/kimi-k3";

function loadPrompt(name) {
  return fs.readFile(
    path.resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "prompts", name),
    "utf8",
  );
}

async function callModel({ system, user, maxTokens = 1500 }) {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new Error("NVIDIA_API_KEY not set");
  const resp = await fetch(NVIDIA_INVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      top_p: 0.95,
    }),
  });
  if (!resp.ok) {
    throw new Error(`NVIDIA ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    reasoning: data.choices?.[0]?.message?.reasoning_content ?? null,
    model: data.model ?? VISION_MODEL,
    usage: data.usage ?? {},
  };
}

function extractJsonBlock(raw) {
  // Try parsing the whole response first
  try { return JSON.parse(raw); } catch {}
  // Fall back: extract first {...} block
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const banner = (label) => console.log(`\n${"═".repeat(70)}\n  ${label}\n${"═".repeat(70)}\n`);

const mission = process.argv[2] ?? "Analise o estado do codebase da Metamorfus ODC e proponha 3 melhorias de alto impacto.";

banner(`MISSION: ${mission}`);

const [cortexPrompt, executorPrompt, forgePrompt] = await Promise.all([
  loadPrompt("cortex.txt"),
  loadPrompt("executor.txt"),
  loadPrompt("forge.txt"),
]);

// ─── STEP 1: CORTEX PLANS ────────────────────────────────────────────
banner("STEP 1 — CORTEX (System 2): strategic planning");
const cortexSystemPrompt = `${cortexPrompt}\n\nAvailable skill vocabulary: scan_codebase_protocol, propose_improvement_protocol, vision_describe_protocol, forge_skill_protocol, mine_protocol, hunt_protocol, gather_protocol, trade_protocol, hack_protocol, think_protocol.\n\nEmit your reply as a JSON object with the schema described above.`;
const cortexOut = await callModel({ system: cortexSystemPrompt, user: mission, maxTokens: 2000 });
console.log("REASONING:");
console.log(cortexOut.reasoning ?? "(none)");
console.log("\nOUTPUT:");
console.log(cortexOut.content);
const plan = extractJsonBlock(cortexOut.content);

// ─── STEP 2: EXECUTOR EXECUTES EACH STEP ─────────────────────────────
banner("STEP 2 — EXECUTOR (System 1): step-by-step execution");
const stepOutputs = [];
if (plan && Array.isArray(plan.plan_queue) && plan.plan_queue.length > 0) {
  for (const step of plan.plan_queue) {
    console.log(`\n┌─ step ${step.step_id}: ${step.action}`);
    console.log(`│  reasoning: ${step.reasoning}`);
    const execSystemPrompt = `${executorPrompt}\n\nReturn ONE step result, not the whole plan.`;
    const execUserPrompt = `Plan step:\n${JSON.stringify(step, null, 2)}`;
    const execOut = await callModel({ system: execSystemPrompt, user: execUserPrompt, maxTokens: 400 });
    const execJson = extractJsonBlock(execOut.content) ?? { status: "FAILED", reason: "unparseable" };
    console.log("│  result:", execJson);
    stepOutputs.push({ step, exec: execJson });
    console.log("└─ done");
  }
} else {
  console.log("(no plan_queue emitted)");
}

// ─── STEP 3: REFLECTION ─────────────────────────────────────────────
banner("STEP 3 — REFLECTION (organism self-observation)");
const reflectionUser = `The Cortex produced this plan and the Executor produced these results:\n\nPLAN:\n${JSON.stringify(plan, null, 2)}\n\nEXECUTOR TRACE:\n${JSON.stringify(stepOutputs, null, 2)}\n\nIn one paragraph, describe how the organism evolved this cycle: what capability was added, what new bottleneck appeared, what should be foraged next.`;
const reflectOut = await callModel({ system: cortexPrompt, user: reflectionUser });
console.log(reflectOut.content);

banner("DONE");
console.log(`Total tokens used: ${JSON.stringify({
  cortex_plan: cortexOut.usage,
  per_step: stepOutputs.length,
})}`);
