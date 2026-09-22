// Swarm Manager — botnet control without Docker.
//
// Each "swarm node" is a child Node process running `swarm-node.mjs`.
// The manager spawns N nodes, broadcasts commands to them, and
// collects structured responses. The protocol is line-delimited JSON
// over stdio (one JSON object per line).
//
// Why this design (instead of Docker):
//   • Works in any Node environment without a Docker daemon.
//   • True process isolation — each node has its own PID, memory,
//     and Python interpreter subprocess if it spawns one.
//   • Pyodide-style sandboxing can be layered per-node if needed.
//   • The user can KILL any node independently.
//   • Bottleneck is the spawn cost (~30-80ms per node), not hardware.
//
// The Reality Bridge protocol is honored:
//   CMD::EXEC::<python_code>   → executed inside the node
//   CMD::SWARM::<botnet_code>  → executed across all live nodes
//
// This file lives outside the user's existing code; it does not
// modify any source.

import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {Object} SwarmNodeInfo
 * @property {string} id
 * @property {number} pid
 * @property {string} startedAt
 * @property {boolean} alive
 * @property {number|null} exitCode
 * @property {string[]} capabilities
 */

/**
 * @typedef {Object} ExecResult
 * @property {string} nodeId
 * @property {boolean} ok
 * @property {string} stdout
 * @property {string} stderr
 * @property {number|null} exitCode
 * @property {number} durationMs
 */

/**
 * Manages a fleet of swarm nodes. Each node is a child Node process
 * running `swarm-node.mjs`, which itself can spawn child Python
 * subprocesses for `CMD::EXEC::` payloads.
 */
export class SwarmManager extends EventEmitter {
  /** @type {Array<{id:string,proc:any,info:any,buffer:string,pending:Map<string,{resolve:Function,reject:Function,timer:any}>,requestSeq:number}>} */
  nodes = [];
  closed = false;

  /**
   * @param {{count:number,defaultTimeoutMs?:number,nodeScript?:string}} opts
   */
  constructor(opts) {
    super();
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.nodeScript = opts.nodeScript ?? path.join(__dirname, "swarm-node.mjs");
    for (let i = 0; i < opts.count; i++) {
      this.spawnNode(i);
    }
  }

  spawnNode(index) {
    const id = `node-${index}-${Date.now().toString(36)}`;
    const proc = spawn(process.execPath, [this.nodeScript], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, SWARM_NODE_ID: id },
    });

    /** @type {{id:string,proc:any,info:any,buffer:string,pending:Map<string,{resolve:Function,reject:Function,timer:any}>,requestSeq:number}} */
    const node = {
      id,
      proc,
      buffer: "",
      pending: new Map(),
      requestSeq: 0,
      info: {
        id,
        pid: proc.pid ?? -1,
        startedAt: new Date().toISOString(),
        alive: true,
        exitCode: null,
        capabilities: ["exec:python", "broadcast"],
      },
    };

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => this.onStdout(node, chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      this.emit("node:stderr", { nodeId: node.id, chunk });
    });

    proc.on("exit", (code) => {
      node.info.alive = false;
      node.info.exitCode = code;
      this.emit("node:exit", { nodeId: node.id, code });
      for (const [, p] of node.pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`node ${node.id} exited (code=${code})`));
      }
      node.pending.clear();
    });

    this.nodes.push(node);
    this.emit("node:start", node.info);
    return node;
  }

  onStdout(node, chunk) {
    node.buffer += chunk;
    let nl;
    while ((nl = node.buffer.indexOf("\n")) !== -1) {
      const line = node.buffer.slice(0, nl).trim();
      node.buffer = node.buffer.slice(nl + 1);
      if (line.length === 0) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit("node:stdout-junk", { nodeId: node.id, line });
        continue;
      }
      if (msg && typeof msg.requestId === "string" && node.pending.has(msg.requestId)) {
        const p = node.pending.get(msg.requestId);
        node.pending.delete(msg.requestId);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg);
        else {
          // Surface stderr so callers see WHY the node rejected.
          const errMsg = msg.error ?? msg.stderr ?? "swarm node error";
          p.reject(new Error(errMsg));
        }
      } else {
        this.emit("node:event", { nodeId: node.id, msg });
      }
    }
  }

  nextRequestId(node) {
    node.requestSeq += 1;
    return `${node.id}#${node.requestSeq}`;
  }

  /**
   * Send a JSON request to one node, await the response.
   * @param {{id:string,proc:any,info:any,buffer:string,pending:Map<string,{resolve:Function,reject:Function,timer:any}>,requestSeq:number}} node
   * @param {Record<string,unknown>} payload
   * @param {number} [timeoutMs]
   */
  async requestOnNode(node, payload, timeoutMs = this.defaultTimeoutMs) {
    if (!node.info.alive) {
      throw new Error(`node ${node.id} is dead (exit=${node.info.exitCode})`);
    }
    const requestId = this.nextRequestId(node);
    const message = JSON.stringify({ requestId, ...payload });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (node.pending.has(requestId)) {
          node.pending.delete(requestId);
          reject(new Error(`request ${requestId} timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      node.pending.set(requestId, { resolve, reject, timer });
      node.proc.stdin.write(message + "\n");
    });
  }

  /**
   * Run a Python payload on one specific node.
   * @param {string} nodeId
   * @param {string} pythonCode
   * @param {number} [timeoutMs]
   * @returns {Promise<ExecResult>}
   */
  async execOnNode(nodeId, pythonCode, timeoutMs) {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);
    const t0 = Date.now();
    const r = await this.requestOnNode(node, { op: "EXEC", code: pythonCode }, timeoutMs);
    return {
      nodeId,
      ok: !!r.ok,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      exitCode: r.exitCode ?? null,
      durationMs: Date.now() - t0,
    };
  }

  /**
   * Broadcast the same payload to ALL live nodes.
   * @param {string} pythonCode
   * @param {number} [timeoutMs]
   * @returns {Promise<ExecResult[]>}
   */
  async broadcast(pythonCode, timeoutMs) {
    const promises = this.nodes.map(async (n) => {
      try {
        return await this.execOnNode(n.id, pythonCode, timeoutMs);
      } catch (e) {
        return {
          nodeId: n.id,
          ok: false,
          stdout: "",
          stderr: (e && e.message) || "broadcast error",
          exitCode: null,
          durationMs: 0,
        };
      }
    });
    return Promise.all(promises);
  }

  listNodes() {
    return this.nodes.map((n) => ({ ...n.info }));
  }

  killNode(nodeId, signal = "SIGTERM") {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return false;
    node.proc.kill(signal);
    return true;
  }

  spawn() {
    const n = this.spawnNode(this.nodes.length);
    return { ...n.info };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const n of this.nodes) {
      try {
        n.proc.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
    await Promise.all(
      this.nodes.map(
        (n) =>
          new Promise((resolve) => {
            if (!n.info.alive) return resolve();
            n.proc.once("exit", () => resolve());
            setTimeout(() => {
              try {
                if (n.info.alive) n.proc.kill("SIGKILL");
              } catch {
                // ignore
              }
              resolve();
            }, 1_000);
          }),
      ),
    );
  }
}
