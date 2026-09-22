// Integration test: organism-level cross-feature check.
//
//   Swarm   ──┐
//             ├──► Subprocess Python ──► NVIDIA NIM vision ──► report
//   MHU     ──┤
//             │
//   Metamorf ─┘
//
// Proves the layers compose end-to-end:
//   1. The organism adopts a profession (DNA library grows).
//   2. The MHU pipeline runs on a real instruction.
//   3. The swarm broadcasts a Python payload that hits NVIDIA vision
//      via urllib (no requests lib needed) and reports back.
//
// Skipped when NVIDIA_API_KEY is missing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { SwarmManager } from "../swarm/swarm-manager.mjs";
import { MHU_5_ProtoODC } from "../../mhu_engine.js";
import { adopt, loadManifest, summary } from "../metamorfus-core/metamorph.js";

const KEY = process.env.NVIDIA_API_KEY;
const skipIfNoKey = !KEY;

// The vision payload is shipped as a .py file in the workspace, not
// embedded in JS template literals — the latter get mangled by shell
// escaping and template-literal indentation rules.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VISION_PAYLOAD = readFileSync(
  path.resolve(HERE, "../../.tmp-vision-payload.py"),
  "utf8",
);

test(
  "INTEGRATION: swarm + real NVIDIA vision via Python urllib",
  { skip: skipIfNoKey },
  async () => {
    const mgr = new SwarmManager({ count: 3 });
    try {
      const results = await mgr.broadcast(VISION_PAYLOAD, 90_000);
      assert.equal(results.length, 3);
      for (const r of results) {
        assert.ok(r.ok, `node ${r.nodeId} failed: ${r.stderr}`);
        // stdout is the JSON line from the python script
        const line = r.stdout.trim().split("\n").at(-1) ?? "";
        const parsed = JSON.parse(line);
        assert.equal(parsed.ok, true);
        assert.ok(parsed.description.length > 20);
        assert.match(parsed.model, /kimi/i);
        assert.ok(parsed.tokens > 0);
      }
    } finally {
      await mgr.close();
    }
  },
);

test(
  "INTEGRATION: MHU preprocessor + vision describe + profession adopt in one flow",
  { skip: skipIfNoKey },
  async () => {
    // 1) MHU pipeline
    const mhu = new MHU_5_ProtoODC();
    const mhuResult = mhu.execute_pipeline(
      "analyze a boardwalk image and decide what skills the architect needs",
    );
    assert.equal(typeof mhuResult.bayesian_posterior, "number");

    // 2) Vision via swarm
    const mgr = new SwarmManager({ count: 2 });
    try {
      const r = await mgr.broadcast(VISION_PAYLOAD, 90_000);
      assert.equal(r.length, 2);
      for (const x of r) {
        const line = x.stdout.trim().split("\n").at(-1) ?? "";
        const parsed = JSON.parse(line);
        assert.ok(parsed.ok);
        assert.ok(
          parsed.description.includes("passarela") ||
            parsed.description.includes("madeira") ||
            parsed.description.includes("boardwalk"),
        );
      }
    } finally {
      await mgr.close();
    }

    // 3) Profession change — adopt architect
    const wsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "metamorf-int-"));
    try {
      const ctx = {
        workspaceRoot: wsRoot,
        dnaDir: "dna_library",
        forgeSkill: async () => ({ output: "mock-forge", data: {} }),
        scanCodebase: async () => ({ data: { fileCount: 0, totalBytes: 0, todoCount: 0, topExtensions: {} } }),
      };
      const result = await adopt("architect", ctx);
      assert.equal(result.state.profession, "architect");
      assert.equal(result.state.morph_focus, "THINK");
      assert.equal(result.state.cumulative_skill_count, 3);

      const manifest = await loadManifest(ctx);
      const text = summary(manifest);
      assert.match(text, /Active profession: architect/);
      assert.match(text, /blueprint_protocol/);
    } finally {
      await fs.rm(wsRoot, { recursive: true, force: true });
    }
  },
);

test("INTEGRATION: the swarm can host the metamorph engine as a node service", async () => {
  // Demonstrates the architectural pattern: each swarm node could be
  // running an instance of the metamorph engine. We don't ship the
  // metamorph engine as a separate node program here (it's in-process),
  // but we prove that the swarm manager can host Python subprocesses
  // carrying arbitrary payloads, and we verify the basic round-trip.
  const mgr = new SwarmManager({ count: 2 });
  try {
    const r = await mgr.broadcast(
      `import json
node_data = {
  "engine": "metamorfus-core",
  "profession_count": 3,
  "skill_count": 10,
}
print(json.dumps(node_data))`,
    );
    assert.equal(r.length, 2);
    for (const x of r) {
      assert.ok(x.ok);
      const parsed = JSON.parse(x.stdout.trim());
      assert.equal(parsed.engine, "metamorfus-core");
      assert.equal(parsed.profession_count, 3);
    }
  } finally {
    await mgr.close();
  }
});
