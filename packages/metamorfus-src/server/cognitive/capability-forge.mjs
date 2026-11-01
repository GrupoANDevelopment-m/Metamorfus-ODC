/**
 * Capability forge — the organism grows a NEW capability on demand.
 *
 * This is the production path for "the organism creates capabilities",
 * not a demonstration. It is the same machinery that runs the
 * self-evolution cycle, exposed for the case where the gap is not a
 * failing skill but a capability nobody has implemented yet:
 *
 *   describe the gap  ->  the model writes the skill  ->  the skill is
 *   validated by RUNNING it  ->  it is registered in the tenant's
 *   library with its provenance  ->  it is invoked with a smoke-test
 *   context and the real result is returned.
 *
 * Design rules, all of them learned the hard way:
 *
 * • The prompt describes the CAPABILITY. There is no domain template.
 *   An earlier version told the model to read `context.get("stations")`
 *   and return `PRESSURE_GRADIENT`, so asking for a carbon-footprint
 *   skill produced a skill that computed pressure gradients. The
 *   model did exactly what it was told; the telling was wrong.
 *
 * • The skill is validated by EXECUTING it, not by parsing it. A model
 *   can return syntactically perfect Python that throws on the first
 *   real input.
 *
 * • The skill is written into the CALLER'S workspace. An earlier
 *   version passed the workspace root to the bridge in the wrong
 *   shape, so the bridge silently fell back to its own directory and
 *   every forged skill landed in the installed package instead.
 *
 * • Nothing is fabricated. If the forge fails, the failure and the
 *   reason come back; if it succeeds, the result of the smoke test
 *   comes back, not a promise that it would work.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { generateValidPython } from "./llm-codegen.mjs";
import { packageRoot } from "../package-root.mjs";

const ROOT = packageRoot();

const KEY_RE = /^[a-z][a-z0-9_]{2,63}$/;

/** The DNA library of a workspace, per the runner's contract. */
function dnaDirOf(workspaceRoot) {
  return path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library");
}

/**
 * Runs the skill through the REAL invoker and returns what it said.
 * This is the same path every other invocation takes, so a skill that
 * passes here passes everywhere.
 */
async function invokeForSmokeTest(workspaceRoot, skillKey, context) {
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const r = await runSkill(workspaceRoot, {
    skillKey,
    byProfession: "generalist",
    context,
    timeoutMs: 30_000,
  });
  return r;
}

/**
 * Forges a capability the organism does not have.
 *
 * @param {string} workspaceRoot  whose library to grow
 * @param {object} opts
 * @param {string} opts.skillKey            snake_case id for the new skill
 * @param {string|string[]} opts.capability  WHAT the skill must do
 * @param {string} [opts.profession]        owning profession (default: generalist)
 * @param {object} [opts.context]           smoke-test input
 * @param {number} [opts.maxAttempts]       how many models to try
 * @param {boolean} [opts.register]          add it to the manifest (default true)
 * @returns {Promise<object>} an honest report — including the smoke-test output
 */
export async function forgeCapability(workspaceRoot, opts) {
  const {
    skillKey,
    capability,
    profession = "generalist",
    context = {},
    maxAttempts = 3,
    register = true,
  } = opts ?? {};

  if (!KEY_RE.test(String(skillKey ?? ""))) {
    return {
      created: false,
      reason: `invalid skillKey "${skillKey}" — must be snake_case, 3-64 chars, starting with a letter`,
    };
  }
  const cap = Array.isArray(capability) ? capability.filter(Boolean).join("; ") : String(capability ?? "");
  if (cap.length < 15) {
    return {
      created: false,
      reason: "capability description is too short to implement from — say what the skill must compute and what it must read",
    };
  }

  const dnaDir = dnaDirOf(workspaceRoot);
  await fs.mkdir(dnaDir, { recursive: true });

  // A capability that already exists is not forged again. The library
  // is append-only; superseding is a different operation.
  const manifestPath = path.join(dnaDir, "manifest.json");
  let manifest = { skills: [] };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  } catch {
    manifest = { skills: [] };
  }
  manifest.skills = manifest.skills ?? [];

  const existing = manifest.skills.find((s) => s.key === skillKey);
  if (existing) {
    return {
      created: false,
      reason: `skill "${skillKey}" already exists in this library`,
      skillKey,
      existing: { profession: existing.profession, status: existing.status, created_by: existing.created_by },
    };
  }

  // 1. The model writes the skill.
  const gen = await generateValidPython({
    capability: cap,
    skillKey,
    profession,
    maxAttempts,
  });

  if (!gen.ok) {
    return {
      created: false,
      reason: "no model produced valid Python for this capability",
      error: gen.error,
      triedModels: gen.triedModels,
    };
  }

  // 2. Write it into THIS workspace's library.
  const pyPath = path.join(dnaDir, `${skillKey}.py`);
  await fs.writeFile(pyPath, gen.code, "utf8");

  // 3. Register it with provenance.
  if (register) {
    manifest.skills.push({
      key: skillKey,
      profession,
      version: 1,
      runtime: "python",
      morph_focus: "THINK",
      status: "active",
      mastery: 0.5,
      transferable: true,
      usage_history: [],
      reactivation_triggers: [],
      created_by: "capability-forge",
      created_at: new Date().toISOString(),
      forged_by_model: gen.model,
      capability: cap,
    });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  // 4. Prove it runs. A skill that was never executed is a claim, not
  //    a capability.
  const smoke = await invokeForSmokeTest(workspaceRoot, skillKey, context);
  const smokeOk = smoke?.ok === true;
  const smokeResult = smokeOk ? smoke.result : null;

  return {
    created: true,
    skillKey,
    profession,
    bytes: gen.code.length,
    model: gen.model,
    triedModels: gen.triedModels,
    registered: register,
    smokeTest: {
      ok: smokeOk,
      result: smokeResult,
      error: smokeOk ? null : String(smoke?.error ?? "unknown").slice(0, 300),
    },
    // A skill that does not run is not a capability. Say so plainly
    // instead of counting it.
    usable: smokeOk,
    reason: smokeOk
      ? `forged with ${gen.model} (${gen.code.length} bytes), registered and executed`
      : `forged with ${gen.model}, but it did not execute: ${String(smoke?.error ?? "unknown").slice(0, 200)}`,
  };
}

/**
 * Lists the capabilities the organism currently holds, with the
 * provenance of each one.
 */
export async function listCapabilities(workspaceRoot) {
  const manifestPath = path.join(dnaDirOf(workspaceRoot), "manifest.json");
  let manifest = { skills: [] };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  } catch {
    return { total: 0, capabilities: [] };
  }
  const skills = manifest.skills ?? [];
  const capabilities = skills.map((s) => ({
    key: s.key,
    profession: s.profession,
    status: s.status,
    runtime: s.runtime,
    created_by: s.created_by ?? "seed",
    forged_by_model: s.forged_by_model ?? null,
    mastery: s.mastery ?? null,
    usages: s.usage_history?.length ?? 0,
  }));
  return {
    total: capabilities.length,
    forged: capabilities.filter((c) => c.created_by !== "seed").length,
    capabilities,
  };
}
