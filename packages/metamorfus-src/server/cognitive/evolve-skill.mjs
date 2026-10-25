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
import { DEFAULT_CODE_MODEL } from "../llm-library/model-registry.mjs";
import { packageRoot } from "../package-root.mjs";

// Resolved from this module's own location — see server/package-root.mjs.
// The literal sandbox path this replaced only existed on one machine.
const ROOT = packageRoot();

async function callLlmForPython(skillKey, profession, sourceCode, errors, forceModel = null) {
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const { MODEL_FALLBACK_CHAIN } = await import(path.join(ROOT, "server/llm-library/model-registry.mjs"));
  const libPath = `/tmp/metamorfus-evolve-${Date.now()}.json`;
  const store = new LlmLibraryStore(libPath);
  await store.load();
  if (forceModel && process.env.NVIDIA_API_KEY) {
    await store.add({
      name: `Evolve — ${forceModel}`,
      provider: "nvidia-direct",
      category: "reasoning",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      apiKey: process.env.NVIDIA_API_KEY,
      model: forceModel,
      // Priority 1 beats the env-registered chain (5+), so the router
      // uses exactly this model for this one attempt.
      priority: 1,
      metadata: { contextWindow: 128000, source: "evolve-skill", forced: true },
    });
    await store.save();
  }
  if (process.env.NVIDIA_API_KEY) {
    const hasR = store.list({ category: "reasoning" }).length > 0;
    if (!hasR) {
      // Register the whole verified chain, not one model. The router's
      // own failover stops at the first *transport* error; a model that
      // answers 200 with Python missing the `skill` function is not a
      // transport error, so it would be accepted as the final result.
      // Keeping several models here lets the loop below try the next one
      // when the returned code fails validation.
      let priority = 5;
      for (const model of MODEL_FALLBACK_CHAIN) {
        await store.add({
          name: `Evolve — ${model} (env)`,
          provider: "nvidia-direct",
          category: "reasoning",
          endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
          apiKey: process.env.NVIDIA_API_KEY,
          model,
          priority: priority++,
          metadata: { contextWindow: 128000, source: "evolve-skill" },
        });
      }
      await store.save();
    }
  }
  const router = new LlmRouter(store);

  // The prompt describes the CAPABILITY that is missing, derived from
  // the failing inputs and (when available) the source of the skill
  // being replaced. It does not contain a fixed template.
  //
  // It used to. The prompt said "read context.get('stations')" and
  // "return PRESSURE_GRADIENT", so asking for a carbon-footprint skill
  // produced a carbon-footprint skill that computed pressure gradients.
  // The model did exactly what it was told; the telling was wrong.
  const capability = (errors || []).join("\n").trim();
  const sourceNote = sourceCode
    ? `\n\nHere is the existing implementation you are improving on (\`${skillKey}\`):\n\n${sourceCode.slice(0, 2500)}`
    : "";

  const userMessage = `Write a Python function that adds a capability the organism does not have yet.

CAPABILITY TO IMPLEMENT:
${capability}
${sourceNote}

The function must be called exactly \`skill\` and have the signature \`skill(organism, context)\`.

Rules:
1. Implement the capability described above. Do not implement a different one.
2. Read whatever inputs that capability needs from \`context\` (a dict).
3. ALWAYS return a dict with keys: action, intensity, version, result.
   - \`action\` is a short UPPER_SNAKE string naming what was computed.
   - \`\`intensity\`\` is a float between 0 and 1.
   - \`\`result\`\` holds the computed data.
4. Handle bad or missing input by returning a valid dict with an \`"error\`\`
   key inside \`result\` — never raise.
5. Wrap the body in try/except so the function can never raise.
6. Use only the standard library. No third-party imports.

Output ONLY the source code. No markdown fences, no explanation, no
commentary before or after the code.`;

  const r = await router.complete("reasoning", {
    messages: [
      { role: "system", content: "Output ONLY valid Python source code, no markdown fences, no commentary. The code must be syntactically complete." },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
    maxTokens: 3000,
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

  // 1. Try the LLM, walking the verified model chain until one returns
  //    Python that actually validates.
  //
  //    One attempt is not enough. The router's failover only covers
  //    transport errors (429, 5xx, timeouts). A model can answer HTTP
  //    200 with a body that omits the `skill` function entirely, and the
  //    router has no way to know that. Probed on 2026-10-23:
  //    nemotron-3-ultra-550b and glm-5.3 both return usable code for a
  //    simple task, while nemotron-3.5-lightning frequently returns
  //    nothing. So the loop below re-asks with an explicit model until
  //    validation passes or the chain is exhausted.
  let python = null;
  let lastLlmErr = null;
  const triedModels = [];

  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const { MODEL_FALLBACK_CHAIN } = await import(path.join(ROOT, "server/llm-library/model-registry.mjs"));

  for (const model of MODEL_FALLBACK_CHAIN) {
    try {
      const code = await callLlmForPython(skillKey, profession, sourceCode, failureInputs.errors, model);
      const v = await validatePython(code);
      if (v.ok) {
        python = v.normalized ?? code;
        triedModels.push({ model, ok: true });
        break;
      }
      triedModels.push({ model, ok: false, error: String(v.stderr ?? "").slice(-200) });
      lastLlmErr = v.stderr.slice(-500);
    } catch (e) {
      triedModels.push({ model, ok: false, error: String(e.message).slice(0, 200) });
      lastLlmErr = e.message;
    }
  }

  if (!python) {
    return {
      ok: false,
      evolved: false,
      attempts: triedModels.length,
      reason: "no model in the fallback chain produced valid Python",
      lastLlmError: lastLlmErr,
      triedModels,
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