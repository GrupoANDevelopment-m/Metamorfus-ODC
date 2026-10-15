// server/skills/runner.mjs
// The link between skill execution and manifest persistence.
// Existing useSkill() in metamorph.ts updates usage_history in memory
// but does NOT write to disk — so every recall() in the past saw an
// empty usage_history. This runner closes the loop:
//   1. Spawn the real Python (or runtime) of the skill
//   2. Capture the result
//   3. Record into usage_history with a real timestamp + outcome
//   4. Persist the manifest to disk
//   5. Promote transferable=true if 2+ distinct professions have used it
//   6. Return the skill result + updated manifest slice
//
// Used by every cognitive test in the T1–T11 battery (T2 needs real
// usage, T3 needs the growth curve, T4 needs precision, etc.).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runSkill(workspaceRoot, opts) {
  const {
    skillKey,
    byProfession,
    context = {},
    timeoutMs = 30_000,
    recordOutcome = null,
  } = opts;

  const dnaDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library");
  const pyPath = path.join(dnaDir, `${skillKey}.py`);

  // Load the manifest from disk (not from a stale in-memory copy).
  const manifestPath = path.join(dnaDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const skill = (manifest.skills ?? []).find((s) => s.key === skillKey);
  if (!skill) {
    return { ok: false, error: `skill '${skillKey}' not in manifest` };
  }

  // 1. Invoke the skill (real subprocess)
  // We don't spawn the .py file directly because that means the
  // `skill(organism, context)` function never gets called — the
  // interpreter just defines it and exits 0. Instead we use a real
  // invoker wrapper that loads METAMORFUS_CONTEXT, imports the
  // module, calls skill(), and prints the result as JSON with the
  // __METAMORFUS_RESULT__ prefix.
  //
  // For large contexts (>64KB), we write the context to a temp file
  // and pass METAMORFUS_CONTEXT_FILE instead. The OS env var size
  // limit (ARG_MAX, ~128KB on Linux) would otherwise cause E2BIG.
  const startedAt = Date.now();
  let parsed, exitCode, stdout, stderr;
  const invokerPath = path.join(__dirname, "invoker.py");
  const contextJson = JSON.stringify(context);
  let contextFile = null;
  let invokerEnv = { ...process.env };
  if (contextJson.length > 65536) {
    contextFile = path.join(workspaceRoot, `.tmp-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await fs.writeFile(contextFile, contextJson);
    invokerEnv = { ...process.env, METAMORFUS_CONTEXT_FILE: contextFile };
  } else {
    invokerEnv = { ...process.env, METAMORFUS_CONTEXT: contextJson };
  }
  try {
    ({ parsed, exitCode, stdout, stderr } = await new Promise((resolve, reject) => {
      const p = spawn("python3", [invokerPath, pyPath], {
        cwd: workspaceRoot,
        env: invokerEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      const tm = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
      p.on("error", reject);
      p.on("exit", (code) => {
        clearTimeout(tm);
        const trimmed = out.replace(/^__METAMORFUS_RESULT__/, "").trim();
        let p = null;
        try { p = JSON.parse(trimmed); } catch { p = { raw: out }; }
        resolve({ parsed: p, exitCode: code, stdout: out, stderr: err });
      });
    }));
  } catch (e) {
    return { ok: false, error: `spawn failed: ${e.message}` };
  } finally {
    // Clean up the temp context file
    if (contextFile) {
      try { await fs.unlink(contextFile); } catch {}
    }
  }
  const durationMs = Date.now() - startedAt;

  // 2. Record into usage_history
  const at = new Date().toISOString();
  const usedSkill = manifest.skills.find((s) => s.key === skillKey);
  if (!usedSkill.usage_history) usedSkill.usage_history = [];
  usedSkill.usage_history.push({
    at,
    by_profession: byProfession,
    context: typeof context === "object" ? Object.keys(context) : [],
    result: parsed,
    outcome: recordOutcome ?? (exitCode === 0 && !parsed?.error ? 1 : -1),
    duration_ms: durationMs,
  });
  usedSkill.last_used_at = at;
  usedSkill.mastery = Math.min(1.0, (usedSkill.mastery ?? 0) + 0.05);

  // 3. Promote transferable=true if 2+ distinct professions used it
  const distinctProfs = new Set(
    usedSkill.usage_history.map((u) => u.by_profession).filter(Boolean),
  );
  if (distinctProfs.size >= 2 && !usedSkill.transferable) {
    usedSkill.transferable = true;
    usedSkill.transferable_at = at;
  }

  // 4. Persist the manifest
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  // 5. Determine actual ok/fail: a skill is ok only if it exited 0 AND
  // its JSON output has no `error` field. Anything else (exit != 0,
  // traceback, structured error) is a failure.
  const skillOk = exitCode === 0 && !parsed?.error;

  return {
    ok: skillOk,
    skillKey,
    byProfession,
    durationMs,
    exitCode,
    result: parsed,
    error: skillOk ? null : (parsed?.error ?? `exit code ${exitCode}`),
    usageHistoryLength: usedSkill.usage_history.length,
    distinctProfessions: [...distinctProfs],
    transferable: usedSkill.transferable === true,
    mastery: usedSkill.mastery,
  };
}