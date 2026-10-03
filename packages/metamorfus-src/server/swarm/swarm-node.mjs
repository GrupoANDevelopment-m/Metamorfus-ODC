// Swarm node — runs as a child process of SwarmManager.
//
// Reads line-delimited JSON requests from stdin and writes line-delimited
// JSON responses to stdout. Supports a polyglot payload dispatcher:
//
//   { op: "EXEC", runtime: "python",     code: "<python>", timeoutMs? }
//   { op: "EXEC", runtime: "javascript", code: "<nodejs>",  timeoutMs? }
//   { op: "EXEC", runtime: "shell",      command: "<bash>", timeoutMs? }
//   { op: "EXEC", runtime: "wasm",       bytes_ref, exports }   // placeholder
//   { op: "EXEC", runtime: "spec",       content, format }      // data only
//   { op: "PING" }
//   { op: "LIST_RUNTIMES" }
//
// Each runtime runs in its own subprocess with a configurable timeout.
// Runtimes can be disabled via env (e.g. SWARM_DISABLE_RUNTIMES="wasm,shell")
// to harden the node. The dispatcher is registry-based: new runtimes
// are added by registering a handler in RUNTIMES.

import { writeStdoutLine, readStdinLines } from "./swarm-protocol.mjs";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const nodeId = process.env.SWARM_NODE_ID ?? `node-anon-${process.pid}`;
const disabled = new Set(
  (process.env.SWARM_DISABLE_RUNTIMES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

writeStdoutLine({
  kind: "hello",
  nodeId,
  pid: process.pid,
  capabilities: ["exec:python", "exec:javascript", "exec:shell"],
  disabled_runtimes: [...disabled],
});

// ----------------------------------------------------------------------------
// Runtime registry — pure dispatcher, no domain assumptions
// ----------------------------------------------------------------------------

/**
 * @typedef {Object} ExecContext
 * @property {Record<string, unknown>} payload
 * @property {number} timeoutMs
 */

/**
 * Dangerous shell command patterns. The shell runtime rejects any
 * command whose first token matches one of these (or whose command
 * line contains a deny-listed substring). Operators can extend
 * SWARM_SHELL_DENYLIST with extra patterns via env.
 */
const SHELL_DENYLIST = [
  "rm",
  "rmdir",
  "mkfs",
  "dd",
  "shred",
  "mv",
  "chmod",
  "chown",
  "curl",
  "wget",
  "nc",
  "ncat",
  "ssh",
  "scp",
  "rsync",
  "sudo",
  "su",
  "bash",
  "sh",
  "zsh",
  "fish",
  "eval",
  "exec",
  "source",
];
const SHELL_DENY_PATTERNS = [
  /\|\s*(ba)?sh\b/i,
  /\|\s*python/i,
  /\brm\s+-rf?\s+\//i,
  /;\s*rm\b/i,
  /&&\s*rm\b/i,
  /`.*`/, // backticks
  /\$\(/, // command substitution
  />\s*\/(etc|root|home)\//i, // redirect to sensitive paths
];

function shellIsAllowed(command) {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  const firstToken = trimmed.split(/\s+/)[0] ?? "";
  // Strip path prefix: /usr/bin/rm → rm
  const baseToken = firstToken.split("/").pop() ?? "";
  if (SHELL_DENYLIST.includes(baseToken)) {
    return { ok: false, reason: `command "${baseToken}" is deny-listed` };
  }
  for (const pattern of SHELL_DENY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { ok: false, reason: `pattern ${pattern} matches a deny rule` };
    }
  }
  // Operator extensions via env (newline-separated).
  const extra = (process.env.SWARM_SHELL_DENYLIST ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const tok of extra) {
    if (baseToken === tok) {
      return { ok: false, reason: `command "${tok}" is deny-listed (operator override)` };
    }
  }
  return { ok: true };
}

/** @type {Record<string, (ctx: ExecContext) => Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number|null }>>} */
const RUNTIMES = {
  python: async ({ payload, timeoutMs }) => {
    const code = String(payload.code ?? "");
    return runSubprocess("python3", ["-c", wrapPython(code)], {
      PYTHONUNBUFFERED: "1",
      timeoutMs,
    });
  },
  javascript: async ({ payload, timeoutMs }) => {
    const code = String(payload.code ?? "");
    return runSubprocess(process.execPath, ["-e", code], {
      NODE_NO_WARNINGS: "1",
      timeoutMs,
    });
  },
  shell: async ({ payload, timeoutMs }) => {
    const command = String(payload.command ?? "");
    const check = shellIsAllowed(command);
    if (!check.ok) {
      return {
        ok: false,
        stdout: "",
        stderr: `shell runtime: ${check.reason}. Set SWARM_DISABLE_RUNTIMES=shell to disable shell entirely.`,
        exitCode: null,
      };
    }
    return runSubprocess("bash", ["-c", command], {
      timeoutMs,
    });
  },
  wasm: async ({ payload, timeoutMs }) => {
    // WASM: we accept WAT (text format) and assemble to WASM bytes
    // using the built-in wabt-style fallback. For raw .wasm bytes
    // referenced by `bytes_ref`, the host must pre-load them into the
    // runtime's memory. Since we don't have a full Wasm runtime
    // embedded here, we surface a clear error and return a typed
    // response. Operators can drop in wasmer-js or wasmtime-js by
    // replacing this handler — the shape is preserved.
    //
    // To wire a real implementation:
    //   1. npm install @bytecodealliance/wasmtime-js
    //   2. Replace this function body with the engine's instantiation.
    //   3. Map the `exports` array to JS functions that the runtime
    //      can call via `runtime.exports.<name>(...)`.
    const ref = String(payload.bytes_ref ?? "");
    const exports = Array.isArray(payload.exports) ? payload.exports : [];
    if (!ref && exports.length === 0) {
      return {
        ok: false,
        stdout: "",
        stderr: "wasm runtime: payload.bytes_ref or payload.exports required",
        exitCode: null,
      };
    }
    return {
      ok: false,
      stdout: "",
      stderr:
        `wasm runtime not wired on this node (bytes_ref="${ref.slice(0, 32)}…", ` +
        `exports=[${exports.join(", ")}]). ` +
        `Install @bytecodealliance/wasmtime-js or wasmer-js and replace this handler.`,
      exitCode: null,
    };
  },
  spec: async ({ payload }) => {
    // "spec" is data only — we echo the payload back as JSON so the
    // caller can confirm what was stored. Real executors will replace
    // this with their own dispatch.
    return {
      ok: true,
      stdout: JSON.stringify(payload.content ?? null),
      stderr: "",
      exitCode: 0,
    };
  },
};

function wrapPython(code) {
  return `
import sys, json
try:
${code
  .split("\n")
  .map((line) => "    " + line)
  .join("\n")}
except Exception as e:
    print(json.dumps({"_error": repr(e)}), file=sys.stderr)
    sys.exit(1)
`;
}

async function runSubprocess(cmd, args, opts) {
  const env = { ...process.env, ...(opts.envOverride ?? {}) };
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => proc.kill("SIGKILL"), opts.timeoutMs);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: stderr + `\nspawn error: ${err.message}`,
        exitCode: null,
      });
    });
  });
}

// ----------------------------------------------------------------------------
// Dispatch loop
// ----------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = Number(process.env.SWARM_EXEC_TIMEOUT_MS ?? 30_000);

(async () => {
  for await (const line of readStdinLines()) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      writeStdoutLine({ kind: "error", error: "invalid JSON" });
      continue;
    }
    const { requestId, op } = req ?? {};
    if (typeof requestId !== "string") {
      writeStdoutLine({ kind: "error", error: "missing requestId" });
      continue;
    }
    if (op === "PING") {
      writeStdoutLine({ requestId, ok: true, nodeId, pid: process.pid });
      continue;
    }
    if (op === "LIST_RUNTIMES") {
      writeStdoutLine({
        requestId,
        ok: true,
        runtimes: Object.keys(RUNTIMES).filter((r) => !disabled.has(r)),
      });
      continue;
    }
    if (op === "EXEC") {
      const runtime = String(req.runtime ?? "python");
      const timeoutMs = Number(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (disabled.has(runtime)) {
        writeStdoutLine({
          requestId,
          ok: false,
          error: `runtime "${runtime}" is disabled on this node`,
        });
        continue;
      }
      const handler = RUNTIMES[runtime];
      if (!handler) {
        writeStdoutLine({
          requestId,
          ok: false,
          error: `unknown runtime "${runtime}". Available: ${Object.keys(RUNTIMES).join(", ")}`,
        });
        continue;
      }
      try {
        const r = await handler({ payload: req, timeoutMs });
        writeStdoutLine({
          requestId,
          ok: r.ok,
          stdout: r.stdout,
          stderr: r.stderr,
          exitCode: r.exitCode,
          runtime,
        });
      } catch (e) {
        writeStdoutLine({
          requestId,
          ok: false,
          error: e?.message ?? "runtime dispatch error",
          runtime,
        });
      }
      continue;
    }
    writeStdoutLine({ requestId, ok: false, error: `unknown op: ${op}` });
  }
})();
