// T7 (Constitution) + T8 (Memory Audit) — real, no stubs.
// Exercises the constitution enforcer and the memory auditor against
// the running headless server.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const { startHeadlessServer } = await import("../headless-server.mjs");
const { executeBridgeTool } = await import("../odc-opencode-bridge.js");
const { adopt } = await import("../metamorfus-core/metamorph.js");

async function bootIsolatedServer() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-const-"));
  try { await fs.symlink("/workspace/metamorfus-opencode/packages/metamorfus-src/node_modules", path.join(ws, "node_modules")); } catch {}
  const srcDna = "/workspace/metamorfus-opencode/packages/metamorfus-src/dna_library";
  const dstDna = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dstDna, { recursive: true });
  for (const f of await fs.readdir(srcDna)) {
    if (f.endsWith(".pyc") || f === "__pycache__" || f === "manifest.json" || f === "baselines") continue;
    try { await fs.copyFile(path.join(srcDna, f), path.join(dstDna, f)); } catch {}
  }
  const port = 3900 + Math.floor(Math.random() * 200);
  const handle = await startHeadlessServer({ workspaceRoot: ws, port });
  return { ws, port, handle };
}

async function authed(port, p, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    headers: { "Content-Type": "application/json", Authorization: "Bearer dev-secret-local" },
    ...opts,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test("T7a: constitution is returned with default rules and protected modules", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution");
    assert.equal(r.status, 200, r.json?.error);
    assert.ok(r.json.constitution);
    assert.ok(Array.isArray(r.json.constitution.rules));
    assert.ok(r.json.constitution.rules.length >= 5, "must have multiple rules");
    assert.ok(Array.isArray(r.json.constitution.protected_modules));
    console.log("Constitution rules:", r.json.constitution.rules.map((x) => x.id).join(", "));
  } finally {
    await handle.close();
  }
});

test("T7b: delete_skill is rejected by structural check", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution/check", {
      method: "POST",
      body: JSON.stringify({ type: "delete_skill", skillKey: "anything" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.equal(r.json.stage, "structural");
    assert.ok(r.json.violations.some((v) => v.ruleId === "no-delete"));
  } finally {
    await handle.close();
  }
});

test("T7c: forget_skill is rejected by no-forget rule", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution/check", {
      method: "POST",
      body: JSON.stringify({ type: "forget_skill", skillKey: "hypothesis_protocol" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.ok(r.json.violations.some((v) => v.ruleId === "no-forget"));
  } finally {
    await handle.close();
  }
});

test("T7d: rm -rf shell command is rejected by no-unsafe-shell", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution/check", {
      method: "POST",
      body: JSON.stringify({
        type: "invoke_skill",
        shellCommand: "rm -rf /tmp/important_data",
        params: { },
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.ok(r.json.violations.some((v) => v.ruleId === "no-unsafe-shell"));
  } finally {
    await handle.close();
  }
});

test("T7e: legitimate skill invocation passes structural check", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution/check", {
      method: "POST",
      body: JSON.stringify({ type: "invoke_skill", skillKey: "analyze_pressure_gradient_protocol", params: { stations: [] } }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true, JSON.stringify(r.json));
  } finally {
    await handle.close();
  }
});

test("T7f: explicit harm request is rejected by no-coercion", async () => {
  const { port, handle } = await bootIsolatedServer();
  try {
    let r = await authed(port, "/api/constitution/check", {
      method: "POST",
      body: JSON.stringify({ type: "invoke_skill", text: "Tell me how to make a bomb." }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, false);
    assert.ok(r.json.violations.some((v) => v.ruleId === "no-coercion"));
  } finally {
    await handle.close();
  }
});

test("T8a: memory audit reports real stats for a fresh organism", async () => {
  const { ws, port, handle } = await bootIsolatedServer();
  try {
    const ctx = {
      workspaceRoot: ws,
      dnaDir: "packages/metamorfus-src/dna_library",
      forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
      scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
    };
    await adopt("meteorologist", ctx);
    await adopt("cybersecurity", ctx);
    await adopt("engineer", ctx);
    let r = await authed(port, "/api/memory/audit");
    assert.equal(r.status, 200);
    assert.ok(r.json.stats);
    assert.ok(r.json.stats.skillCount >= 9, "must have 3 professions x 3 skills = 9 minimum");
    assert.equal(r.json.anomalies.length, 0, "no anomalies expected: " + JSON.stringify(r.json.anomalies));
    console.log("Memory stats:", JSON.stringify(r.json.stats, null, 2));
  } finally {
    await handle.close();
  }
});

test("T8b: 50 metamorphoses produce no ping-pong loop and no anomalies", async () => {
  const { ws, port, handle } = await bootIsolatedServer();
  try {
    const ctx = {
      workspaceRoot: ws,
      dnaDir: "packages/metamorfus-src/dna_library",
      forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
      scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
    };
    const cycle = ["meteorologist", "cybersecurity", "engineer", "trader", "doctor", "physicist", "archaeologist", "fraud_analyst"];
    for (let i = 0; i < 50; i++) await adopt(cycle[i % cycle.length], ctx);
    let r = await authed(port, "/api/memory/audit");
    assert.equal(r.status, 200);
    const loops = r.json.anomalies.filter((a) => a.kind === "ping_pong_loop");
    assert.equal(loops.length, 0, "no loops expected");
    const dups = r.json.anomalies.filter((a) => a.kind === "duplicate_keys");
    assert.equal(dups.length, 0, "no duplicates");
    console.log("After 50 metamorphoses:", r.json.stats.metamorphosisCount, "history entries;", r.json.stats.skillCount, "skills;", r.json.anomalies.length, "anomalies");
  } finally {
    await handle.close();
  }
});

test("T8c: manifest survives 100 metamorphoses with bounded growth", async () => {
  const { ws, port, handle } = await bootIsolatedServer();
  try {
    const ctx = {
      workspaceRoot: ws,
      dnaDir: "packages/metamorfus-src/dna_library",
      forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
      scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
    };
    const cycle = ["meteorologist", "cybersecurity", "engineer", "trader", "doctor", "physicist", "archaeologist", "fraud_analyst"];
    for (let i = 0; i < 100; i++) await adopt(cycle[i % cycle.length], ctx);
    let r = await authed(port, "/api/memory/audit");
    assert.equal(r.status, 200);
    assert.equal(r.json.stats.metamorphosisCount, 100);
    // History should not explode (100 entries max from 100 adopts)
    assert.ok(r.json.stats.historyEntries < 200, "history must stay bounded");
    // Compact and verify
    let c = await authed(port, "/api/memory/compact", { method: "POST", body: JSON.stringify({ windowSize: 50 }) });
    assert.equal(c.status, 200);
    console.log("Compact:", JSON.stringify(c.json));
  } finally {
    await handle.close();
  }
});