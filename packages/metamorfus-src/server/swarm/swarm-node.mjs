// Swarm node — runs as a child process of SwarmManager.
//
// Reads line-delimited JSON requests from stdin and writes line-delimited
// JSON responses to stdout. Supports:
//   • { op: "EXEC", code: "<python>" }  — runs the Python payload in a
//     subprocess and returns stdout/stderr/exitCode.
//   • { op: "PING" }                    — health check.
//
// Python sandboxing: we use `subprocess.run` with a short wall-clock
// timeout. The user can layer Pyodide or seccomp on top, but the
// default behaviour is: each Python call is a short-lived subprocess
// with no inherited env beyond PATH, and stdout/stderr captured.

import { writeStdoutLine, readStdinLines } from "./swarm-protocol.mjs";

const nodeId = process.env.SWARM_NODE_ID ?? `node-anon-${process.pid}`;

writeStdoutLine({
  kind: "hello",
  nodeId,
  pid: process.pid,
  capabilities: ["exec:python"],
});

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";
const EXEC_TIMEOUT_MS = Number(process.env.SWARM_EXEC_TIMEOUT_MS ?? 30_000);

async function runPython(code) {
  const wrapped = `
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
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, ["-c", wrapped], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
    }, EXEC_TIMEOUT_MS);
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
    if (op === "EXEC") {
      const code = String(req.code ?? "");
      const r = await runPython(code);
      writeStdoutLine({ requestId, ok: r.ok, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode });
    } else if (op === "PING") {
      writeStdoutLine({ requestId, ok: true, nodeId, pid: process.pid });
    } else {
      writeStdoutLine({ requestId, ok: false, error: `unknown op: ${op}` });
    }
  }
})();
