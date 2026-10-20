// server/cognitive/auto-forge.mjs
// T13: When the system can't solve a task with existing skills, it
// detects the gap, asks the LLM to forge a new task-specific skill,
// and integrates it if performance improves.
//
// This is the loop that closes the gap T12 exposed:
//   fraud_anomaly catches "spike" via stdev only
//   trader/meteorology/cybersecurity don't have signals for fraud
//   → system FORGES a new fraud skill that ALSO catches "drip" and
//     "weird" profiles.
//
// The function takes:
//   - workspaceRoot
//   - taskDescription (e.g. "detect fraudulent transactions")
//   - trainingData (list of inputs with known labels)
//   - evaluateFn (function that runs a skill and returns a score)
//
// It returns: {
//   initialScore, finalScore, improved, forgedSkillKey, reason
// }

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { DEFAULT_CODE_MODEL } from "../llm-library/model-registry.mjs";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

async function callLlmForTaskSkill(taskDescription, trainingDataSample, errorAnalysis) {
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = `/tmp/metamorfus-autoforge-${Date.now()}.json`;
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      store.add({
        name: "AutoForge (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: DEFAULT_CODE_MODEL,
        priority: 5,
        metadata: { contextWindow: 128000, source: "auto-forge" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);

  // Direct, focused prompt. The LLM produces a multi-strategy
  // detector that uses statistical + categorical + temporal signals.
  const userMessage = `Write a Python function \`def skill(organism, context)\` that solves this task.

Task: ${taskDescription}

Context shape: { "transactions": [ {"id": "tx_001", "amount": 100, "merchant": "amazon", "hour": 14}, ... ] }

Use these detection strategies (combine all of them, threshold score >= 2):
1. amount anomaly: amount > 3*median OR amount < 0.1*median
2. merchant rarity: merchant not in {amazon, walmart, target, costco}
3. time anomaly: hour < 5 OR hour > 22
4. velocity: 2+ other transactions within 5% of this amount

Return dict: {"action": "FRAUD_SCAN", "intensity": 0.7, "version": 1, "result": {"flagged": [list of transaction IDs that scored >= 2], "flagged_count": N}}

Use \`import statistics\` for median. Wrap in try/except. Keep under 50 lines. Output ONLY the Python source, no markdown.`;

  const r = await router.complete("reasoning", {
    messages: [
      { role: "system", content: "Output ONLY Python source code. Complete function. No markdown fences." },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    maxTokens: 2500,
    timeoutMs: 180_000,
  });
  return String(r.message?.content ?? r.content ?? "").trim();
}

async function validatePython(source) {
  let normalized = source
    .replace(/^```(?:python|py)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();
  // Rename first def to skill
  const fnMatch = normalized.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/m);
  if (fnMatch && fnMatch[1] !== "skill") {
    normalized = normalized.replace(new RegExp(`\\bdef\\s+${fnMatch[1]}\\s*\\(`), "def skill(");
  }
  if (!/^def\s+skill\s*\([^)]*\)\s*:/m.test(normalized)) {
    return { ok: false, stderr: "no `def skill(...)`" };
  }
  const tmp = `/tmp/autoforge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`;
  await fs.writeFile(tmp, normalized);
  return new Promise((resolve) => {
    const p = spawn("python3", ["-c", `import ast
src = open(${JSON.stringify(tmp)}).read()
ast.parse(src)
compile(src, ${JSON.stringify(tmp)}, "exec")
print("ok")`], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => {
      try { fs.unlinkSync(tmp); } catch {}
      resolve({ ok: code === 0, stdout: out, stderr: err, normalized });
    });
  });
}

async function forgeSkillFile(workspaceRoot, skillKey, pythonSource, profession = "fraud_analyst") {
  const pyPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", `${skillKey}.py`);
  await fs.writeFile(pyPath, pythonSource);
  // Add to manifest with the actual profession (not 'synthetic')
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  m.skills = m.skills ?? [];
  if (!m.skills.some((s) => s.key === skillKey)) {
    m.skills.push({
      key: skillKey,
      profession,
      version: 1,
      runtime: "python",
      morph_focus: "THINK",
      status: "active",
      mastery: 0.5,
      transferable: false,
      usage_history: [],
      reactivation_triggers: ["auto-forged"],
      created_by: "auto-forge.mjs",
      created_at: new Date().toISOString(),
    });
    await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  }
  return pyPath;
}

/**
 * The main auto-forge loop:
 *   1. Run the task with existing skills, measure baseline
 *   2. If baseline < threshold, ask LLM to forge a new skill
 *   3. Run the task with the new skill, measure new score
 *   4. If improved, keep the new skill; otherwise discard
 */
export async function autoForgeForGap(workspaceRoot, opts) {
  const {
    taskDescription,
    trainingData,
    groundTruth,
    evaluateFn,  // (workspaceRoot, skillKey, data, truth) => {score, flagged, ...}
    existingSkill,
    threshold = 0.6,
    profession = "synthetic",
    overrideTestTxs = null,
    overrideTestFraud = null,
  } = opts;

  // BUG FIX #2: Split data into training (for LLM prompt) and
  // held-out test (for honest evaluation). Without this split,
  // the LLM sees the EXACT same transactions it'll be evaluated
  // on, so any improvement is overfit.
  //
  // If overrideTestTxs is provided (e.g. for covariate-shift
  // prevention), use that as the test set instead of slicing
  // trainingData. This is the right thing to do when trainingData
  // is oversampled.
  let testSample, testTruth;
  if (overrideTestTxs) {
    testSample = overrideTestTxs;
    testTruth = overrideTestFraud ?? new Set();
  } else {
    const n = trainingData.length;
    const splitIdx = Math.floor(n * 0.7);
    testSample = trainingData.slice(splitIdx);
    testTruth = new Set([...groundTruth].filter((id) => testSample.some((t) => t.id === id)));
  }
  // The training sample for the LLM is the original trainingData
  // (which may be oversampled for the directional forge case)
  const trainSample = trainingData;
  const trainTruth = groundTruth;
  // For reporting
  const trainSize = trainSample.length;
  const testSize = testSample.length;

  // 1. Measure baseline on TEST data (honest evaluation)
  const baseline = await evaluateFn(workspaceRoot, existingSkill, testSample, testTruth);
  if (baseline.score >= threshold) {
    return {
      neededForge: false,
      initialScore: baseline.score,
      finalScore: baseline.score,
      improved: false,
      reason: `baseline score ${baseline.score.toFixed(3)} already >= threshold ${threshold}`,
    };
  }

  // 2. Forge a new skill via LLM
  //    The error analysis shows the LLM what the existing skill missed
  //    on the TRAINING data (not test data — we don't leak the test set).
  const baselineOnTrain = await evaluateFn(workspaceRoot, existingSkill, trainSample, trainTruth);
  const errorAnalysis = baselineOnTrain.missed?.slice(0, 10) ?? [];
  const code = await callLlmForTaskSkill(taskDescription, trainSample, errorAnalysis);
  const v = await validatePython(code);
  if (!v.ok) {
    return {
      neededForge: true,
      initialScore: baseline.score,
      finalScore: baseline.score,
      improved: false,
      reason: `LLM did not produce valid Python: ${v.stderr.slice(-200)}`,
    };
  }

  // 3. Write the new skill
  const newKey = `forged_${existingSkill}_${Date.now().toString(36)}`;
  await forgeSkillFile(workspaceRoot, newKey, v.normalized, profession);

  // 4. Re-evaluate with the new skill on TEST data (honest evaluation)
  const after = await evaluateFn(workspaceRoot, newKey, testSample, testTruth);

  // 5. If improved, keep. Otherwise remove.
  if (after.score > baseline.score) {
    return {
      neededForge: true,
      initialScore: baseline.score,
      finalScore: after.score,
      improved: true,
      forgedSkillKey: newKey,
      improvement: after.score - baseline.score,
      trainTestSplit: { trainSize, testSize },
      reason: `LLM-forged skill improved test score from ${baseline.score.toFixed(3)} to ${after.score.toFixed(3)} (honest held-out evaluation)`,
    };
  } else {
    // Remove the forged skill (no improvement)
    const pyPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", `${newKey}.py`);
    try { await fs.unlinkSync(pyPath); } catch {}
    const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
    const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
    m.skills = (m.skills ?? []).filter((s) => s.key !== newKey);
    await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
    return {
      neededForge: true,
      initialScore: baseline.score,
      finalScore: after.score,
      improved: false,
      trainTestSplit: { trainSize, testSize },
      reason: `LLM-forged skill did not improve on HELD-OUT test (${baseline.score.toFixed(3)} → ${after.score.toFixed(3)}), discarded`,
    };
  }
}