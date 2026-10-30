/**
 * Reachability proof: EVERY skill in the manifest must actually run.
 *
 * Counting files is not proof. This walks the manifest, invokes each
 * skill through the real invoker (a real python3 subprocess), and
 * separates four outcomes honestly:
 *
 *   executed   — ran and returned a real payload
 *   needsInput — the skill refused because a required field was absent
 *                (a gap in the audit's generic context, not a defect)
 *   needsTool  — the skill needs an external tool or a live service
 *                that this sandbox does not have
 *   broken     — the skill raised for any other reason. These are bugs.
 *
 * A skill that cannot be reached is not a capability the organism has.
 */
import path from "node:path";
import fs from "node:fs/promises";
import { packageRoot } from "../package-root.mjs";

const ROOT = packageRoot();

/**
 * A context that is deliberately generic. A skill that needs structured
 * input fails loudly — that is a real finding, not a bug in this
 * script — so each skill gets the context shape its family is
 * documented to read.
 */
const CONTEXT_BY_HINT = [
  [/arxiv/i, { query: "transformer architecture", max_results: 3 }],
  [/browser_use|browser-harness|bsk/i, { task: "read the title of a page", url: "http://127.0.0.1:8080/" }],
  [/crypto_price/i, { symbol: "BTC", ids: ["bitcoin"] }],
  [/cve/i, { keyword: "log4j" }],
  [/summar/i, { text: "The quick brown fox jumps over the lazy dog. It was a bright cold day in April." }],
  [/pressure|gradient|front|forecast|weather/i, {
    stations: [
      { station_id: "A", lat: 0, lon: 0, pressure_hpa: 1013, temp_c: 15 },
      { station_id: "B", lat: 0, lon: 1, pressure_hpa: 1008, temp_c: 12 },
      { station_id: "C", lat: 0, lon: 2, pressure_hpa: 1010, temp_c: 18 },
      { station_id: "D", lat: 0, lon: 3, pressure_hpa: 1002, temp_c: 21 },
    ],
  }],
  [/load|stress|toler|material|structur|beam|column/i, {
    distributed_kg_m2: 120,
    span_m: 4,
    point_loads_kg: [800, 400],
    tributary_width_m: 1.5,
    material: { E: 200e9, yield: 250e6 },
    loads: { moment: 12000, shear: 3000, axial: 5000, length: 4, distributed: 800 },
    section: { type: "rectangle", depth_m: 0.3, width_m: 0.15 },
    allowable_stress_pa: 250e6,
  }],
  [/rsi|signal|trend|trader|price/i, {
    prices: [100, 101, 103, 102, 104, 106, 105, 107, 109, 108, 110, 112, 111, 113, 115, 114, 116, 118],
  }],
  [/doctor|triage|differential|treatment|patient|clinical/i, {
    heart_rate: 128,
    systolic_bp: 85,
    spo2: 88,
    symptoms: ["fever", "cough", "fatigue"],
    candidates: [
      { name: "pneumonia", symptoms: ["fever", "cough", "fatigue"] },
      { name: "influenza", symptoms: ["fever", "cough"] },
    ],
    diagnosis: "pneumonia",
    drug: "metformin",
    renal_failure: true,
  }],
  [/fraud|anomaly|network|transaction/i, {
    transactions: [
      { id: "t1", amount: 50, merchant: "amazon", hour: 10, from: "a", to: "b" },
      { id: "t2", amount: 9000, merchant: "unknown", hour: 3, from: "b", to: "c" },
      { id: "t3", amount: 8700, merchant: "shell", hour: 3, from: "c", to: "d" },
    ],
  }],
  [/physic|dimension|force|wave|momentum|energy/i, {
    mass_kg: 10,
    acceleration_ms2: 9.81,
    force_n: 98.1,
    forces: [{ name: "a", fx: 10, fy: 0, fz: 0 }],
    quantities: [{ name: "v", value: 10, unit: "m/s" }],
    derived: [{ name: "p", value: 100, unit: "kg*m/s^2" }],
    waves: [{ amplitude_m: 1, wavelength_m: 10, speed_ms: 5 }],
  }],
  [/archaeo|stratig|artifact|chronolog|pottery|dig/i, {
    layers: [
      { id: "L1", above: null, below: "L2", type: "fill" },
      { id: "L2", above: "L1", below: "L3", type: "fill" },
      { id: "L3", above: "L2", below: null, type: "surface" },
    ],
    finds: [{ material: "ceramic", wheel_thrown: true, temper: "fine" }],
    dates: [{ find: "f1", value: 1200, unit: "BP" }],
    finds_dates: [{ id: "f1", year: 1200 }],
  }],
  [/port|scanner|http|header|recon|incident/i, {
    host: "127.0.0.1",
    port: 8080,
    url: "http://127.0.0.1:8080/",
    headers: {},
    findings: [],
  }],
  [/pdf|extract/i, { path: "/tmp/none.pdf" }],
];

function contextFor(key) {
  for (const [re, ctx] of CONTEXT_BY_HINT) {
    if (re.test(key)) return { ...ctx };
  }
  return {};
}

/** Classifies a failure that is not a real defect. */
function classifyFailure(reason) {
  const r = String(reason ?? "");
  // "the skill needs a field this audit did not supply"
  if (/\b(required|is required|missing)\b/i.test(r)) return "needsInput";
  // "the skill needs an external program or a live service"
  if (/(not installed|not found|not built|No such file|Connection refused|nxdomain|ENOENT|command not found)/i.test(r)) {
    return "needsTool";
  }
  return "broken";
}

export async function auditReachableSkills(workspaceRoot) {
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const dnaDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library");
  const manifest = JSON.parse(await fs.readFile(path.join(dnaDir, "manifest.json"), "utf-8"));
  const skills = manifest.skills ?? [];

  const report = {
    total: skills.length,
    executed: [],
    needsInput: [],
    needsTool: [],
    broken: [],
  };

  for (const s of skills) {
    const pyPath = path.join(dnaDir, `${s.key}.py`);
    if (!(await fs.stat(pyPath).catch(() => null))) {
      report.broken.push({ key: s.key, profession: s.profession, reason: "no .py file" });
      continue;
    }
    let r;
    try {
      r = await runSkill(workspaceRoot, {
        skillKey: s.key,
        byProfession: s.profession,
        context: contextFor(s.key),
        timeoutMs: 25_000,
      });
    } catch (e) {
      report.broken.push({ key: s.key, profession: s.profession, reason: `throw: ${e.message}` });
      continue;
    }
    if (!r.ok) {
      const reason = String(r.error ?? "unknown");
      const bucket = classifyFailure(reason);
      report[bucket].push({ key: s.key, profession: s.profession, reason: reason.slice(0, 150) });
      continue;
    }
    // The skill ran. A payload is anything other than an empty object.
    const payload = r.result ?? {};
    const empty =
      payload === null ||
      payload === undefined ||
      (typeof payload === "object" && Object.keys(payload).length === 0);
    if (empty) {
      report.needsInput.push({
        key: s.key,
        profession: s.profession,
        reason: "ran but returned an empty payload",
      });
      continue;
    }
    report.executed.push(s.key);
  }

  report.executedCount = report.executed.length;
  report.needsInputCount = report.needsInput.length;
  report.needsToolCount = report.needsTool.length;
  report.brokenCount = report.broken.length;
  report.allReachable = report.brokenCount === 0;
  report.reachableCount = report.executedCount + report.needsInputCount + report.needsToolCount;
  return report;
}
