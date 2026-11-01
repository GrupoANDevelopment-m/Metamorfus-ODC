// server/cognitive/evolve-skill.mjs
// Direct LLM-driven skill evolution. When a skill fails N times, the
// LLM writes a new Python implementation directly (no morphosis
// planner), then forge_skill integrates it.
//
// This is what T6 needs to be real: the LLM produces working Python,
// not a plan structure.

import path from "node:path";
import fs from "node:fs/promises";
import { generateValidPython } from "./llm-codegen.mjs";
import { packageRoot } from "../package-root.mjs";

// Resolved from this module's own location — see server/package-root.mjs.
// The literal sandbox path this replaced only existed on one machine.
const ROOT = packageRoot();

async function forgeSkill(workspaceRoot, skillKey, pythonSource) {
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  const r = await executeBridgeTool(
    "forge_skill",
    { skillKey, pythonSource, overwrite: true, rationale: `Auto-evolved by evolve-skill.mjs — original failed ${lastErrors.length} times.` },
    { workspaceRoot },
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
  //    router has no way to know that. The shared codegen layer
  //    (llm-codegen.mjs) re-asks with an explicit model until
  //    validation passes or the chain is exhausted.
  const gen = await generateValidPython({
    capability: failureInputs.errors,
    existingSource: sourceCode,
    skillKey,
    profession,
    maxAttempts: maxLlmAttempts,
  });
  const python = gen.ok ? gen.code : null;
  const triedModels = gen.triedModels ?? [];

  if (!python) {
    return {
      ok: false,
      evolved: false,
      attempts: triedModels.length,
      reason: "no model in the fallback chain produced valid Python",
      lastLlmError: gen.error ?? null,
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
    attempts: triedModels.length,
    model: gen.model ?? null,
    forgeResult: forged?.output ?? "",
    reason: exists ? "LLM wrote valid Python + forge_skill integrated it" : "forge_skill did not register the new skill",
  };
}