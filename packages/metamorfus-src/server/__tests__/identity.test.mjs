// T1/T9 — Identity Preservation Score (real, not smoke).
// Exercises /api/identity/score, /api/identity/snapshot, /api/recall,
// /api/recall/suggest end-to-end via the running headless server.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const { startHeadlessServer } = await import("../headless-server.mjs");
const { executeBridgeTool } = await import("../odc-opencode-bridge.js");
const { adopt, loadManifest } = await import("../metamorfus-core/metamorph.js");

async function bootIsolatedServer() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-ips-"));
  // Seed the workspace by symlinking the source dna_library + node_modules
  try { await fs.symlink("/workspace/metamorfus-opencode/packages/metamorfus-src/node_modules", path.join(ws, "node_modules")); } catch {}
  const srcDna = "/workspace/metamorfus-opencode/packages/metamorfus-src/dna_library";
  const dstDna = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dstDna, { recursive: true });
  for (const f of await fs.readdir(srcDna)) {
    if (f.endsWith(".pyc") || f === "__pycache__" || f === "manifest.json" || f === "baselines") continue;
    try { await fs.copyFile(path.join(srcDna, f), path.join(dstDna, f)); } catch {}
  }
  // Use a high port to avoid clashes
  const port = 3700 + Math.floor(Math.random() * 200);
  const handle = await startHeadlessServer({
    workspaceRoot: ws,
    port,
  });
  return { ws, port, handle };
}

async function authed(port, p, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${port}${p}`, {
    headers: { "Content-Type": "application/json", Authorization: "Bearer dev-secret-local" },
    ...opts,
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test("T1: real Identity Preservation Score over a 3-domain journey", async () => {
  const { ws, port, handle } = await bootIsolatedServer();
  try {
    const ctx = {
      workspaceRoot: ws,
      dnaDir: "packages/metamorfus-src/dna_library",
      forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
      scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
    };

    // Phase 1 — adopt meteorologist and actually USE one of its skills
    await adopt("meteorologist", ctx);
    // Invoke analyze_pressure_gradient so usage_history gets a real entry
    const { spawn } = await import("node:child_process");
    const pyPath = path.join(ws, "packages", "metamorfus-src", "dna_library", "analyze_pressure_gradient_protocol.py");
    await new Promise((resolve) => {
      const p = spawn("python3", [pyPath], {
        cwd: ws,
        env: { ...process.env, METAMORFUS_CONTEXT: JSON.stringify({ stations: [{ station_id: "A", lat: 0, lon: 0, pressure_hpa: 1010 }, { station_id: "B", lat: 0, lon: 1, pressure_hpa: 1005 }] }) },
        stdio: ["ignore", "pipe", "pipe"],
      });
      p.stdout.on("data", () => {});
      p.on("exit", resolve);
    });
    // Snapshot the baseline
    let snap = await authed(port, "/api/identity/snapshot", { method: "POST", body: JSON.stringify({ name: "t1-baseline" }) });
    assert.equal(snap.status, 200, snap.json?.error);

    // Phase 2 — adopt cybersecurity
    await adopt("cybersecurity", ctx);

    // Phase 3 — adopt engineer
    await adopt("engineer", ctx);

    // Phase 4 — back to meteorologist
    await adopt("meteorologist", ctx);

    // Compute IPS against baseline
    let ipsResp = await authed(port, "/api/identity/score", { method: "POST", body: JSON.stringify({ baseline: "t1-baseline" }) });
    assert.equal(ipsResp.status, 200, ipsResp.json?.error);
    console.log("\nT1 IPS:");
    console.log(JSON.stringify(ipsResp.json, null, 2));

    assert.ok(ipsResp.json.ips.ips > 0, "IPS must be > 0");
    assert.equal(ipsResp.json.ips.components.skillRetention, 100, "All 3 baseline meteorology skills must be retained");
    assert.ok(ipsResp.json.ips.components.masteryRetention > 0, "Mastery retention must be > 0");
  } finally {
    await handle.close();
  }
});

test("T1b: recall returns real past decisions from usage_history", async () => {
  const { ws, port, handle } = await bootIsolatedServer();
  try {
    const ctx = {
      workspaceRoot: ws,
      dnaDir: "packages/metamorfus-src/dna_library",
      forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
      scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
    };
    await adopt("meteorologist", ctx);
    // Invoke the skill so usage_history is populated
    const { spawn } = await import("node:child_process");
    const py = path.join(ws, "packages", "metamorfus-src", "dna_library", "analyze_pressure_gradient_protocol.py");
    await new Promise((resolve) => {
      const p = spawn("python3", [py], { cwd: ws, env: { ...process.env, METAMORFUS_CONTEXT: JSON.stringify({ stations: [] }) }, stdio: ["ignore", "pipe", "pipe"] });
      p.stdout.on("data", () => {});
      p.on("exit", resolve);
    });
    let recall = await authed(port, "/api/recall/analyze_pressure_gradient_protocol");
    assert.equal(recall.status, 200, recall.json?.error);
    console.log("\nRecall:");
    console.log(JSON.stringify(recall.json, null, 2));
    assert.ok(recall.json.recall);
    assert.equal(recall.json.recall.key, "analyze_pressure_gradient_protocol");
  } finally {
    await handle.close();
  }
});

test("T1c: suggest returns skills ordered by memory relevance", async () => {
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
    await adopt("meteorologist", ctx);
    let sug = await authed(port, "/api/recall/suggest", { method: "POST", body: JSON.stringify({ query: "pressure gradient analysis" }) });
    assert.equal(sug.status, 200, sug.json?.error);
    console.log("\nSuggest:");
    console.log(JSON.stringify(sug.json, null, 2));
    assert.ok(Array.isArray(sug.json.suggestions));
    assert.ok(sug.json.suggestions.length > 0, "must suggest at least one skill");
    const top = sug.json.suggestions[0];
    assert.equal(top.profession, "meteorologist");
  } finally {
    await handle.close();
  }
});