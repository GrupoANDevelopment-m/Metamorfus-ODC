// Skill Invoker — executes the Python skills in the DNA library
// as REAL programs. The previous "intention dict" stub design is
// gone: a skill is any Python module that defines a callable.
//
// Two invocation modes:
//
//   1. importMode (default): spawn a Python process that
//        importlib-loads the .py file, finds `def skill(o, c)`
//        (or run/main), calls it with the JSON context from
//        stdin, and prints the result.
//
//   2. spawnMode: spawn `python3 <skillPath> <args>` directly.
//        Useful for skills that are real CLI tools.
//
// The invoker is domain-agnostic: it runs whatever code the
// organism forged. Cybersecurity tools, research APIs, trading
// bots — same invoker, same contract.

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

const RUNNER_PY = (skillPath) => `
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("metamorfus_skill_${Date.now()}", ${JSON.stringify(skillPath)})
mod = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(mod)
except Exception as e:
    sys.stderr.write(f"ERROR loading skill: {e}\\n")
    sys.exit(2)
skill = getattr(mod, "skill", None) \
     or getattr(mod, "run", None) \
     or getattr(mod, "main", None) \
     or getattr(mod, "handler", None) \
     or getattr(mod, "invoke", None)
if skill is None:
    sys.stderr.write("ERROR: skill must define def skill(o, c), def run(...), def main(...), def handler(...), or def invoke(...)\\n")
    sys.exit(3)
raw = json.loads(sys.stdin.read())
# Accept both shapes: {"context": {...}} and flat {...}
ctx = raw.get("context", raw) if isinstance(raw, dict) else raw
organism = raw.get("organism") if isinstance(raw, dict) else None
try:
    result = skill(organism or {}, ctx)
except Exception as e:
    sys.stderr.write(f"ERROR executing skill: {type(e).__name__}: {e}\\n")
    sys.exit(4)
print("__METAMORFUS_RESULT__" + json.dumps(result, default=str))
`;

/**
 * @param {{
 *   skillKey: string,
 *   context?: any,
 *   dnaDir?: string,
 *   pythonBin?: string,
 *   timeoutMs?: number,
 *   mode?: "import"|"spawn",
 * }} opts
 */
export async function invokeSkill(opts) {
  if (!opts || typeof opts.skillKey !== "string") {
    throw new Error("invokeSkill: skillKey is required");
  }
  const dnaDir = opts.dnaDir ?? "packages/metamorfus-src/dna_library";
  const skillPath = path.resolve(dnaDir, `${opts.skillKey}.py`);
  try {
    await fs.access(skillPath);
  } catch {
    throw new Error(`invokeSkill: skill file not found: ${skillPath}`);
  }
  const py = opts.pythonBin ?? PYTHON_BIN;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const mode = opts.mode ?? "import";

  const cmd = mode === "spawn"
    ? { cmd: py, args: [skillPath, JSON.stringify(opts.context ?? {})] }
    : { cmd: py, args: ["-c", RUNNER_PY(skillPath)] };

  const proc = spawn(cmd.cmd, cmd.args, { stdio: ["pipe", "pipe", "pipe"] });
  if (mode === "import") {
    proc.stdin.write(JSON.stringify(opts.context ?? {}));
    proc.stdin.end();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* */ }
      reject(new Error(`invokeSkill: ${opts.skillKey} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c) => { stderr += c.toString(); });
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`invokeSkill: spawn failed: ${err.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`invokeSkill: ${opts.skillKey} exited ${code}: ${stderr.slice(0, 800)}`));
      }
      const marker = "__METAMORFUS_RESULT__";
      const idx = stdout.indexOf(marker);
      if (idx >= 0) {
        const payload = stdout.slice(idx + marker.length).trim();
        try {
          return resolve({ ok: true, result: JSON.parse(payload), stdout, stderr, exitCode: code });
        } catch {
          return resolve({ ok: true, result: payload, stdout, stderr, exitCode: code });
        }
      }
      // No marker — the skill didn't use the runner contract (or
      // is a CLI tool). Return raw stdout.
      resolve({ ok: true, result: stdout.trim(), stdout, stderr, exitCode: code });
    });
  });
}
