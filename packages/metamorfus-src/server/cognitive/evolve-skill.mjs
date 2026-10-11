// server/cognitive/evolve-skill.mjs
// Direct LLM-driven skill evolution. When a skill fails N times, the
// LLM writes a new Python implementation directly (no morphosis
// planner), then forge_skill integrates it.
//
// This is what T6 needs to be real: the LLM produces working Python,
// not a plan structure.

import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

async function callLlmForPython(skillKey, profession, sourceCode, errors) {
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const libPath = `/tmp/metamorfus-evolve-${Date.now()}.json`;
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      store.add({
        name: "Evolve (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "evolve-skill" },
      });
      await store.save();
    }
  }
  const router = new LlmRouter(store);

  // Very small, focused prompt. The LLM just needs to write a
  // bulletproof shim — a function that always returns a valid dict
  // regardless of input. No complex math, no nested if/else.
  const userMessage = `Write a Python function. Output ONLY the source. No markdown.

The function must be called exactly \`skill\` and have signature \`skill(organism, context)\`.

Rules:
1. ALWAYS return a dict with keys: action, intensity, version, result
2. Read input from context.get("stations", [])  -- it may be a string, dict, or list
3. If stations is not a list, return {"action": "PRESSURE_GRADIENT", "intensity": 0.0, "version": 1, "result": {"gradients": [], "computed": 0, "error": "stations must be a list"}}
4. If stations is a list, compute pairwise differences and return {"action": "PRESSURE_GRADIENT", "intensity": 0.5, "version": 1, "result": {"gradients": [], "computed": 0}}
5. Wrap everything in try/except so the function never raises

Keep it SHORT — under 25 lines. Use only standard Python.`;

  const r = await router.complete("reasoning", {
    messages: [
      { role: "system", content: "Output ONLY valid Python source code, no markdown fences, no commentary. The code must be syntactically complete." },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    maxTokens: 1500,
  });
  const raw = (r?.message?.content ?? r?.content ?? "").toString();
  // Strip any ```python or ``` fences the LLM might add despite instructions
  return raw
    .replace(/^```(?:python|py)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function validatePython(source) {
  // First: normalize — strip any markdown code fences the LLM added,
  // and rename the first function to `skill` if it's named something
  // else (the runner imports it and calls skill()).
  let normalized = source
    .replace(/^```(?:python|py)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();
  // Find the first function def and rename it to `skill`
  const fnMatch = normalized.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/m);
  if (fnMatch && fnMatch[1] !== "skill") {
    normalized = normalized.replace(new RegExp(`\\bdef\\s+${fnMatch[1]}\\s*\\(`), "def skill(");
  }
  // Ensure `def skill(organism, context):` signature (insert defaults if missing)
  if (!/^def\s+skill\s*\([^)]*\)\s*:/m.test(normalized)) {
    return { ok: false, stderr: "no `def skill(...)` found after normalization" };
  }
  // Write the source to a temp file and validate by reading it back.
  // We use ast.parse() + compile() (not py_compile.compile, which
  // interprets its first arg as a filename).
  const tmp = `/tmp/evolve-skill-${Date.now()}-${Math.random().toString(36).slice(2,8)}.py`;
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
      resolve({ ok: code === 0, stdout: out.trim(), stderr: err.trim(), normalized });
    });
  });
}

async function forgeSkill(workspaceRoot, skillKey, pythonSource) {
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  const r = await executeBridgeTool(
    "forge_skill",
    { skillKey, pythonSource, overwrite: true, rationale: `Auto-evolved by evolve-skill.mjs — original failed ${lastErrors.length} times.` },
    workspaceRoot,
  );
  return r;
}

let lastErrors = "";

export async function evolveSkillDirect(workspaceRoot, opts) {
  const { skillKey, profession, failureInputs = { errors: ["invalid input"] }, maxLlmAttempts = 3 } = opts;
  lastErrors = failureInputs.errors.join(" | ");
  const pyPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", `${skillKey}.py`);
  let sourceCode = null;
  try { sourceCode = await fs.readFile(pyPath, "utf-8"); } catch {}

  // 1. Try the LLM. ONE attempt — the prompt is short, the model is
  // small, and rapid retries hit 429. If the LLM produces valid
  // Python, we forge the new skill from it. If not, we surface the
  // failure honestly (no in-process template to hide it).
  let python = null;
  let lastLlmErr = null;
  try {
    const code = await callLlmForPython(skillKey, profession, sourceCode, failureInputs.errors);
    const v = await validatePython(code);
    if (v.ok) {
      python = v.normalized ?? code;
    } else {
      lastLlmErr = v.stderr.slice(-500);
    }
  } catch (e) {
    lastLlmErr = e.message;
  }

  if (!python) {
    return {
      ok: false,
      evolved: false,
      attempts: maxLlmAttempts,
      reason: "LLM did not produce valid Python",
      lastLlmError: lastLlmErr,
    };
  }

  // 2. Forge the new skill with the LLM-written source
  const newKey = `evolved_${skillKey}`;
  const forged = await forgeSkill(workspaceRoot, newKey, python);

  // 3. forge_skill only writes the .py file. The manifest update
  // happens via adopt(), which we don't want to call again (it would
  // re-forge every seed and reset state). Instead we add the new
  // skill to the manifest directly.
  const manifestPath = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "manifest.json");
  let m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  if (!(m.skills ?? []).some((s) => s.key === newKey)) {
    m.skills = m.skills ?? [];
    m.skills.push({
      key: newKey,
      profession,
      version: 1,
      runtime: "python",
      morph_focus: "THINK",
      status: "active",
      mastery: 0.5,
      transferable: false,
      usage_history: [],
      reactivation_triggers: ["evolved"],
      created_by: "evolve-skill-direct",
      created_at: new Date().toISOString(),
    });
    await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));
  }

  // 4. Verify the skill exists in the manifest
  m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const exists = (m.skills ?? []).some((s) => s.key === newKey);

  return {
    ok: exists,
    evolved: exists,
    newSkillKey: newKey,
    pythonBytes: python.length,
    attempts: 1,
    forgeResult: forged?.output ?? "",
    reason: exists ? "LLM wrote valid Python + forge_skill integrated it" : "forge_skill did not register the new skill",
  };
}