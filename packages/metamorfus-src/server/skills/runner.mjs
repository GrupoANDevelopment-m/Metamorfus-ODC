// server/skills/runner.mjs
// The link between skill execution and manifest persistence.
// Existing useSkill() in metamorph.ts updates usage_history in memory
// but does NOT write to disk — so every recall() in the past saw an
// empty usage_history. This runner closes the loop:
//   1. Spawn the real runtime of the skill (python, shell, javascript
//      or a non-executable spec)
//   2. Capture the result
//   3. Record into usage_history with a real timestamp + outcome
//   4. Persist the manifest to disk
//   5. Promote transferable=true if 2+ distinct professions have used it
//   6. Return the skill result + updated manifest slice
//
// Used by every cognitive test in the T1–T18 battery (T2 needs real
// usage, T3 needs the growth curve, T4 needs precision, etc.).

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULT_PREFIX = "__METAMORFUS_RESULT__";

/**
 * The file extension each runtime is materialised to. This used to be
 * hardcoded to ".py", which meant a skill declared as `runtime:
 * "shell"` was looked up as `<key>.py` — a file that only exists when
 * the skill was originally a Python one. In a fresh workspace, where
 * adopt() writes the seed's own runtime, those skills were simply
 * unreachable: four of them (sharpen_axe, navigate_forest,
 * weather_read, material_selection) were declared with a runtime the
 * executor ignored.
 */
const RUNTIME_EXTENSION = {
  python: ".py",
  shell: ".sh",
  javascript: ".js",
  spec: ".spec.json",
};

/**
 * Where the skill's file lives for a given runtime, with a .py
 * fallback. The fallback also changes the EFFECTIVE runtime: a skill
 * that declares `shell` but only has a .py on disk must be executed as
 * Python, or bash would be handed a Python file.
 */
async function resolveSkillFile(dnaDir, skillKey, runtime) {
  const wanted = RUNTIME_EXTENSION[runtime] ?? ".py";
  const primary = path.join(dnaDir, `${skillKey}${wanted}`);
  if (await fs.stat(primary).then(() => true).catch(() => false)) {
    return { path: primary, effectiveRuntime: runtime };
  }
  // Fall back to the Python implementation when the runtime-specific
  // file is absent — that is the case for skills whose manifest entry
  // was backfilled without a runtime.
  const fallback = path.join(dnaDir, `${skillKey}.py`);
  if (await fs.stat(fallback).then(() => true).catch(() => false)) {
    return { path: fallback, effectiveRuntime: "python" };
  }
  return { path: primary, effectiveRuntime: runtime };
}

/** Parses whatever the runtime printed into a result object. */
function parseOutput(stdout) {
  const trimmed = stdout.replace(/^__METAMORFUS_RESULT__/, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.split("\n").pop());
    } catch {
      return { raw: stdout };
    }
  }
}

/** Runs a command, capturing stdout/stderr and the exit code. */
function runProcess(command, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const p = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const tm = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (e) => {
      clearTimeout(tm);
      reject(e);
    });
    p.on("exit", (code) => {
      clearTimeout(tm);
      resolve({ stdout: out, stderr: err, exitCode: code });
    });
  });
}

/**
 * Invokes a JavaScript skill. The seed payload declares a plain
 * `function skill(organism, context)`, so the harness appends an
 * export and imports the source as a module.
 */
const JS_HARNESS = `
import fs from "node:fs";
const source = fs.readFileSync(process.argv[2], "utf8");
const raw = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
// The organism's cross-runtime contract is context.get(key), which is
// Python's dict.get. JavaScript skills written against the same
// contract need it too, so the context carries both the plain
// properties and a get() method.
const context = {
  ...raw,
  get: (key, fallback) =>
    Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : fallback,
};
const mod = await import(
  "data:text/javascript;base64," +
    Buffer.from(source + "\\nexport default skill;\\n").toString("base64")
);
const result = mod.default({}, context);
process.stdout.write(${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(result ?? null));
`;

export async function runSkill(workspaceRoot, opts) {
  const {
    skillKey,
    byProfession,
    context = {},
    timeoutMs = 30_000,
    recordOutcome = null,
  } = opts;

  const dnaDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library");

  // Load the manifest from disk (not from a stale in-memory copy).
  const manifestPath = path.join(dnaDir, "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const skill = (manifest.skills ?? []).find((s) => s.key === skillKey);
  if (!skill) {
    return { ok: false, error: `skill '${skillKey}' not in manifest` };
  }

  const runtime = skill.runtime ?? "python";
  // The runtime actually used. It can differ from the declared one when
  // the runtime-specific file is absent and the runner falls back to the
  // skill's Python implementation.
  let effectiveRuntime = runtime;
  const startedAt = Date.now();
  let parsed, exitCode, stdout, stderr;
  const contextJson = JSON.stringify(context);
  let contextFile = null;
  let contextEnv = { ...process.env };

  // For large contexts (>64KB) we write the context to a temp file and
  // pass METAMORFUS_CONTEXT_FILE instead. The OS env var size limit
  // (ARG_MAX, ~128KB on Linux) would otherwise cause E2BIG.
  const needsFile = contextJson.length > 65536;
  if (needsFile) {
    contextFile = path.join(workspaceRoot, `.tmp-context-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await fs.writeFile(contextFile, contextJson);
    contextEnv = { ...process.env, METAMORFUS_CONTEXT_FILE: contextFile };
  } else {
    contextEnv = { ...process.env, METAMORFUS_CONTEXT: contextJson };
  }

  try {
    const resolved = await resolveSkillFile(dnaDir, skillKey, runtime);
    effectiveRuntime = resolved.effectiveRuntime;

    if (effectiveRuntime === "spec") {
      // A spec is a reference document, not an executable. The cortex
      // recalls it; the executor returns it as guidance.
      const specPath = resolved.path;
      let content = null;
      try {
        content = JSON.parse(await fs.readFile(specPath, "utf-8"));
      } catch {
        content = { raw: await fs.readFile(specPath, "utf-8").catch(() => "") };
      }
      parsed = {
        action: "SPEC_REFERENCE",
        intensity: 0.2,
        version: 1,
        result: content,
      };
      exitCode = 0;
      stdout = JSON.stringify(parsed);
      stderr = "";
    } else if (effectiveRuntime === "shell") {
      const scriptPath = resolved.path;
      const r = await runProcess("bash", [scriptPath], {
        cwd: workspaceRoot,
        env: contextEnv,
        timeoutMs,
      });
      stdout = r.stdout;
      stderr = r.stderr;
      exitCode = r.exitCode;
      parsed = parseOutput(r.stdout);
      if (exitCode !== 0 && !parsed?.error) {
        parsed = { error: `shell skill exited ${exitCode}: ${String(r.stderr).slice(0, 200)}` };
      } else if (parsed?.raw !== undefined && parsed.action === undefined) {
        // A shell skill that prints plain text still has to answer in
        // the skill contract: action, intensity, version, result.
        parsed = {
          action: "SHELL_RESULT",
          intensity: 0.3,
          version: 1,
          result: { stdout: String(parsed.raw).trim().slice(0, 4000) },
        };
      }
    } else if (effectiveRuntime === "javascript") {
      const scriptPath = resolved.path;
      const harnessPath = path.join(
        workspaceRoot,
        `.tmp-jsharness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mjs`,
      );
      const ctxPath = contextFile ?? path.join(workspaceRoot, `.tmp-jctx-${Date.now()}.json`);
      if (!contextFile) await fs.writeFile(ctxPath, contextJson);
      await fs.writeFile(harnessPath, JS_HARNESS, "utf8");
      try {
        const r = await runProcess("node", [harnessPath, scriptPath, ctxPath], {
          cwd: workspaceRoot,
          env: contextEnv,
          timeoutMs,
        });
        stdout = r.stdout;
        stderr = r.stderr;
        exitCode = r.exitCode;
        parsed = parseOutput(r.stdout);
        if (exitCode !== 0 && !parsed?.error) {
          parsed = { error: `javascript skill exited ${exitCode}: ${String(r.stderr).slice(0, 200)}` };
        } else if (parsed?.raw !== undefined && parsed.action === undefined) {
          parsed = {
            action: "JAVASCRIPT_RESULT",
            intensity: 0.3,
            version: 1,
            result: { stdout: String(parsed.raw).trim().slice(0, 4000) },
          };
        }
      } finally {
        await fs.unlink(harnessPath).catch(() => {});
        if (!contextFile) await fs.unlink(ctxPath).catch(() => {});
      }
    } else {
      // Python — the default runtime. We don't spawn the .py file
      // directly because that means the `skill(organism, context)`
      // function never gets called — the interpreter just defines it
      // and exits 0. Instead we use a real invoker wrapper that loads
      // the context, imports the module, calls skill(), and prints the
      // result as JSON with the __METAMORFUS_RESULT__ prefix.
      const pyPath = resolved.path;
      const invokerPath = path.join(__dirname, "invoker.py");
      const r = await runProcess("python3", [invokerPath, pyPath], {
        cwd: workspaceRoot,
        env: contextEnv,
        timeoutMs,
      });
      stdout = r.stdout;
      stderr = r.stderr;
      exitCode = r.exitCode;
      parsed = parseOutput(r.stdout);
    }
  } catch (e) {
    return { ok: false, error: `spawn failed: ${e.message}` };
  } finally {
    if (contextFile) {
      try { await fs.unlink(contextFile); } catch {}
    }
  }
  const durationMs = Date.now() - startedAt;

  // 2. Determine actual ok/fail: a skill is ok only if it exited 0 AND
  // its JSON output has no `error` field. Anything else (exit != 0,
  // traceback, structured error) is a failure.
  const skillOk = exitCode === 0 && !parsed?.error;
  //
  // A failure is not one thing. The invoker prefixes its own faults
  // with "invoker:" — a module that will not import, a skill function
  // that does not exist, or a skill that RAISED. Those are defects.
  // A skill that ran and returned {"error": "nginx not installed"} is
  // not a defect: it reported a condition truthfully. Collapsing the
  // two made the reachability audit call working skills "broken".
  const failureKind = skillOk
    ? null
    : typeof parsed?.error === "string" && parsed.error.startsWith("invoker:")
      ? "raised"
      : "condition";

  // 3. Record into usage_history
  const at = new Date().toISOString();
  const usedSkill = manifest.skills.find((s) => s.key === skillKey);
  if (!usedSkill.usage_history) usedSkill.usage_history = [];
  usedSkill.usage_history.push({
    at,
    by_profession: byProfession,
    runtime: effectiveRuntime,
    context: typeof context === "object" ? Object.keys(context) : [],
    result: parsed,
    outcome: recordOutcome ?? (exitCode === 0 && !parsed?.error ? 1 : -1),
    failure_kind: skillOk ? null : failureKind,
    duration_ms: durationMs,
  });
  usedSkill.last_used_at = at;
  usedSkill.mastery = Math.min(1.0, (usedSkill.mastery ?? 0) + 0.05);

  // 4. Promote transferable=true if 2+ distinct professions used it
  const distinctProfs = new Set(
    usedSkill.usage_history.map((u) => u.by_profession).filter(Boolean),
  );
  if (distinctProfs.size >= 2 && !usedSkill.transferable) {
    usedSkill.transferable = true;
    usedSkill.transferable_at = at;
  }

  // 5. Persist the manifest
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    ok: skillOk,
    skillKey,
    byProfession,
    runtime: effectiveRuntime,
    durationMs,
    exitCode,
    result: parsed,
    error: skillOk ? null : (parsed?.error ?? `exit code ${exitCode}`),
    // "raised" = the skill itself is broken. "condition" = the skill
    // ran and reported something truthfully (missing dependency,
    // missing input, unreachable host).
    failureKind,
    usageHistoryLength: usedSkill.usage_history.length,
    distinctProfessions: [...distinctProfs],
    transferable: usedSkill.transferable === true,
    mastery: usedSkill.mastery,
  };
}
