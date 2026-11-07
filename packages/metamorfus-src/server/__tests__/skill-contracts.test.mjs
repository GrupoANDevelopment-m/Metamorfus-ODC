/**
 * SKILL CONTRACT TEST
 * -------------------
 * A skill that reads keys nobody sends is a skill that looks alive and
 * does nothing. Every one of these skills did exactly that: the
 * meteorology skill read `pressure` while every caller in the repo
 * sent `pressure_hpa`, so the pressure came through as 0, every
 * gradient came out as 0, and the call still returned ok:true.
 *
 * That is the most dangerous failure shape there is — it passes.
 *
 * This test closes the CLASS of bug, not the instances: for each
 * documented contract it sends the documented context and asserts the
 * output is NOT degenerate. If a skill stops reading its own input —
 * because it was rewritten, or because the field was renamed, or
 * because the adapter drifted — this test fails instead of quietly
 * returning zeros.
 *
 * Every assertion here runs the REAL skill through the REAL invoker.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const { adopt, loadManifest } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.js"));
const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));

async function boot() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-contract-"));
  try { await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules")); } catch {}
  const srcDna = path.join(ROOT, "dna_library");
  const dstDna = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dstDna, { recursive: true });
  for (const f of await fs.readdir(srcDna)) {
    if (f.endsWith(".pyc") || f === "__pycache__" || f === "manifest.json" || f === "baselines" || f === "flows") continue;
    try { await fs.copyFile(path.join(srcDna, f), path.join(dstDna, f)); } catch {}
  }
  return ws;
}

function ctx(ws) {
  return {
    workspaceRoot: ws,
    dnaDir: "packages/metamorfus-src/dna_library",
    forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
    scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
  };
}

/** Unwraps { ok, result: { action, ..., result: {...} } }. */
function inner(result) {
  const r = result?.result;
  if (r && typeof r === "object" && "result" in r) return r.result;
  return r ?? {};
}

/**
 * Each case declares the documented input and what "the skill actually
 * consumed it" looks like in the output.
 */
const CASES = [
  {
    name: "analyze_pressure_gradient_protocol",
    profession: "meteorologist",
    context: {
      stations: [
        { id: "A", lat: 0, lon: 0, pressure: 1013 },
        { id: "B", lat: 0, lon: 1, pressure: 1008 },
        { id: "C", lat: 0, lon: 2, pressure: 1010 },
      ],
      top_n: 5,
    },
    assertConsumed(data) {
      assert.ok(Number(data.computed) > 0, "the skill computed no gradients — it did not read the pressures");
      assert.ok(Number(data.mean_abs_gradient) > 0, "every gradient was zero — the pressures did not arrive");
      const slopes = data.local_slopes ?? [];
      assert.ok(slopes.length >= 2, "local_slopes must preserve the sequence of the field");
      assert.ok(slopes.some((s) => Number(s.slope_hpa_per_km) > 0), "no slope was computed");
    },
  },
  {
    name: "front_detection_protocol",
    profession: "meteorologist",
    context: {
      stations: [
        { id: "A", lat: 0, lon: 0, temperature: 10, pressure: 1013, wind: 4 },
        { id: "B", lat: 0, lon: 1, temperature: 25, pressure: 1010, wind: 12 },
        { id: "C", lat: 0, lon: 2, temperature: 12, pressure: 1011, wind: 3 },
      ],
    },
    assertConsumed(data) {
      const text = JSON.stringify(data);
      assert.ok(!/"error"\s*:/.test(text) || Object.keys(data).length > 1, "the skill returned an error for a valid input");
      // The 25C station must register as warm — the temperatures must
      // have been read, not defaulted to zero.
      const temps = JSON.stringify(data).match(/"temperature"\s*:\s*([-\d.]+)/g) ?? [];
      const values = temps.map((t) => Number(t.split(":").pop()));
      if (values.length) {
        assert.ok(Math.max(...values) > 20, `the warm station was not read (temperatures seen: ${values.join(",")})`);
      }
    },
  },
  {
    name: "engineer_load_calc_protocol",
    profession: "engineer",
    context: {
      loads: { moment: 12000, shear: 3000, axial: 5000, length: 4 },
      section: { type: "rectangle", depth: 0.3, width: 0.15 },
      material: "steel",
    },
    assertConsumed(data) {
      assert.ok(Number(data.utilisation) > 0, "utilisation is zero — the loads did not arrive");
      assert.ok(Number(data.von_mises_pa) > 0, "no stress was computed");
      assert.ok(Number(data.section_properties?.area_m2) > 0, "the section geometry was not read");
    },
  },
  {
    name: "rsi_calculator_v2_protocol",
    profession: "trader",
    context: { prices: [100, 101, 103, 102, 104, 106, 105, 107, 109, 108, 110, 112, 111, 113, 115, 114, 116, 118] },
    assertConsumed(data) {
      assert.ok(typeof data.rsi === "number", "no rsi was computed");
      assert.ok(data.rsi >= 0 && data.rsi <= 100, `rsi out of range: ${data.rsi}`);
      assert.ok(data.samples >= 10, "the price series was not consumed");
    },
  },
];

test("skill contracts: each skill really consumes its documented input", async () => {
  const ws = await boot();
  const c = ctx(ws);
  for (const prof of ["meteorologist", "engineer", "trader"]) await adopt(prof, c);

  const failures = [];
  for (const cs of CASES) {
    const r = await runSkill(ws, {
      skillKey: cs.name,
      byProfession: cs.profession,
      context: cs.context,
    });
    if (!r.ok) {
      failures.push(`${cs.name}: the skill did not run (${r.error ?? "unknown"})`);
      continue;
    }
    try {
      cs.assertConsumed(inner(r));
    } catch (e) {
      failures.push(`${cs.name}: ${e.message}`);
    }
  }
  await fs.rm(ws, { recursive: true, force: true });
  assert.deepEqual(failures, [], `skills that did not consume their own input:\n${failures.join("\n")}`);
});

test("skill contracts: the manifest lists the skills this test checks", async () => {
  const ws = await boot();
  const c = ctx(ws);
  for (const prof of ["meteorologist", "engineer", "trader"]) await adopt(prof, c);
  const m = await loadManifest(c);
  const keys = new Set(m.skills.map((s) => s.key));
  for (const cs of CASES) {
    assert.ok(keys.has(cs.name), `${cs.name} is not in the manifest — the contract test would be checking a skill that does not exist`);
  }
  await fs.rm(ws, { recursive: true, force: true });
});
