/**
 * Shared LLM code generation for the cognitive layer.
 *
 * Two callers need "ask a verified model for a working Python skill":
 *
 *   • evolve-skill.mjs     — replace a skill that failed
 *   • capability-forge.mjs — create a capability the organism lacks
 *
 * They used to each own a copy of the model registration and the
 * validation logic, which is how they drifted. The shared rules that
 * matter:
 *
 * 1. Availability is not catalog presence. Every model is probed by
 *    generating code and RUNNING it, not by reading /v1/models.
 * 2. The router's failover only covers transport errors. A model can
 *    answer HTTP 200 with a body that omits the `skill` function, and
 *    the router cannot see that. So the caller walks the chain itself
 *    and re-asks until the code validates.
 * 3. The prompt describes the CAPABILITY, never a domain template. It
 *    used to contain "read context.get('stations')" and "return
 *    PRESSURE_GRADIENT", so asking for a carbon-footprint skill
 *    produced a carbon-footprint skill that computed pressure
 *    gradients. The model did exactly what it was told; the telling
 *    was wrong.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { packageRoot } from "../package-root.mjs";

const ROOT = packageRoot();

/**
 * Validates a candidate skill: parses it, compiles it, and makes sure
 * it exposes the `skill(organism, context)` entry point the runner
 * calls. Also normalizes the source (strips code fences, renames the
 * first function to `skill`).
 */
export async function validatePython(source) {
  let normalized = String(source ?? "")
    .replace(/^```(?:python|py)?\s*\n?/im, "")
    .replace(/\n?```\s*$/im, "")
    .trim();
  const fnMatch = normalized.match(/^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/m);
  if (fnMatch && fnMatch[1] !== "skill") {
    normalized = normalized.replace(new RegExp(`\\bdef\\s+${fnMatch[1]}\\s*\\(`), "def skill(");
  }
  if (!/^def\s+skill\s*\([^)]*\)\s*:/m.test(normalized)) {
    return { ok: false, stderr: "no `def skill(...)` found after normalization", normalized };
  }
  const tmp = `/tmp/metamorfus-codegen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`;
  await fs.writeFile(tmp, normalized);
  return new Promise((resolve) => {
    // ast.parse + compile — NOT py_compile.compile, which interprets
    // its first argument as a filename.
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

/**
 * Builds the prompt for one capability. `existingSource` is optional:
 * when the caller is improving a skill it is included, when the caller
 * is creating a capability from scratch it is not.
 */
export function buildCapabilityPrompt({ capability, existingSource, skillKey, profession }) {
  const cap = Array.isArray(capability) ? capability.join("\n") : String(capability ?? "");
  const sourceNote = existingSource
    ? `\n\nHere is the existing implementation you are improving on (\`${skillKey}\`):\n\n${String(existingSource).slice(0, 2500)}`
    : "";
  return `Write a Python function that adds a capability the organism does not have yet.

CAPABILITY TO IMPLEMENT:
${cap}
${sourceNote}

The function must be called exactly \`skill\` and have the signature \`skill(organism, context)\`.

Rules:
1. Implement the capability described above. Do not implement a different one.
2. Read whatever inputs that capability needs from \`context\` (a dict).
3. ALWAYS return a dict with keys: action, intensity, version, result.
   - \`action\` is a short UPPER_SNAKE string naming what was computed.
   - \`intensity\` is a float between 0 and 1.
   - \`result\` holds the computed data.
4. Handle bad or missing input by returning a valid dict with an \`"error"\`
   key inside \`result\` — never raise.
5. Wrap the body in try/except so the function can never raise.
6. Use only the standard library. No third-party imports.

Output ONLY the source code. No markdown fences, no explanation, no
commentary before or after the code.`;
}

/**
 * Registers the verified model chain on a throwaway library and returns
 * a router for it. The whole chain is registered, not just one model:
 * the router stops at the first *transport* error, so a model that
 * answers 200 with unusable code would be accepted as the final
 * result.
 */
async function buildRouter({ forceModel, label }) {
  const { LlmLibraryStore } = await import(path.join(ROOT, "server/llm-library/store.mjs"));
  const { LlmRouter } = await import(path.join(ROOT, "server/llm-library/router.mjs"));
  const { MODEL_FALLBACK_CHAIN } = await import(path.join(ROOT, "server/llm-library/model-registry.mjs"));

  const libPath = `/tmp/metamorfus-codegen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const store = new LlmLibraryStore(libPath);
  await store.load();

  if (forceModel && process.env.NVIDIA_API_KEY) {
    await store.add({
      name: `${label} — ${forceModel}`,
      provider: "nvidia-direct",
      category: "reasoning",
      endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
      apiKey: process.env.NVIDIA_API_KEY,
      model: forceModel,
      // Priority 1 beats the env-registered chain (5+), so the router
      // uses exactly this model for this one attempt.
      priority: 1,
      metadata: { contextWindow: 128000, source: label, forced: true },
    });
    await store.save();
  }

  if (process.env.NVIDIA_API_KEY) {
    const hasReasoning = store.list({ category: "reasoning" }).length > 0;
    if (!hasReasoning) {
      let priority = 5;
      for (const model of MODEL_FALLBACK_CHAIN) {
        await store.add({
          name: `${label} — ${model} (env)`,
          provider: "nvidia-direct",
          category: "reasoning",
          endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
          apiKey: process.env.NVIDIA_API_KEY,
          model,
          priority: priority++,
          metadata: { contextWindow: 128000, source: label },
        });
      }
      await store.save();
    }
  }

  return new LlmRouter(store);
}

/**
 * Asks ONE model for the code. Returns the raw source.
 */
export async function requestPythonFromModel({ model, prompt }) {
  const router = await buildRouter({ forceModel: model, label: "Codegen" });
  const r = await router.complete("reasoning", {
    messages: [
      {
        role: "system",
        content: "Output ONLY valid Python source code, no markdown fences, no commentary. The code must be syntactically complete.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    maxTokens: 3000,
  });
  const raw = (r?.message?.content ?? r?.content ?? "").toString();
  return raw
    .replace(/^```(?:python|py)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

/**
 * Walks the verified model chain until one of them returns code that
 * validates. Returns the code plus the model that produced it.
 */
export async function generateValidPython({
  capability,
  existingSource = null,
  skillKey,
  profession,
  maxAttempts = 3,
  onAttempt = null,
}) {
  const { MODEL_FALLBACK_CHAIN } = await import(path.join(ROOT, "server/llm-library/model-registry.mjs"));
  const prompt = buildCapabilityPrompt({ capability, existingSource, skillKey, profession });

  const triedModels = [];
  let lastError = null;
  const chain = MODEL_FALLBACK_CHAIN.slice(0, Math.max(1, maxAttempts));

  for (const model of chain) {
    try {
      const code = await requestPythonFromModel({ model, prompt });
      const v = await validatePython(code);
      triedModels.push({ model, ok: v.ok, bytes: code.length });
      if (v.ok) {
        return { ok: true, code: v.normalized, model, triedModels };
      }
      lastError = v.stderr || "code did not validate";
    } catch (e) {
      triedModels.push({ model, ok: false, error: String(e?.message ?? e).slice(0, 200) });
      lastError = String(e?.message ?? e);
    }
    if (typeof onAttempt === "function") await onAttempt({ model, triedModels, lastError });
  }

  return {
    ok: false,
    error: lastError ?? "no model produced valid Python",
    triedModels,
  };
}
