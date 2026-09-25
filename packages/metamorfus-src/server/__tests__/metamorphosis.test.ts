/**
 * Automated self-improvement test — the Metamorfus core loop, round 2.
 *
 * Storyline: an organism adopts three professions in sequence:
 *   1. scientist   (THINK focus)
 *   2. lumberjack  (HUNT focus)
 *   3. architect   (THINK focus again, with a richer DNA library)
 *
 * Round-2 assertions are about the CONCEPT, not just the structure:
 *
 *   • morph_focus actually GATES the executor — a lumberjack under
 *     HUNT focus does NOT see hypothesis_protocol just because it's
 *     reusable in principle.
 *   • Skills have MASTERY that decays with time.
 *   • Dormant skills WAKE UP when context matches reactivation_triggers.
 *   • TRANSFERABLE emerges after the SECOND distinct profession uses a
 *     skill — it's never stamped at forge time.
 *   • Re-forging with a new version keeps the OLD version as archaeology.
 *   • The organism CANNOT forget. There is no `forget()`.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import {
  adopt,
  loadManifest,
  recall,
  summary,
  useSkill,
  candidates,
  DEFAULT_DNA_DIR,
} from "../metamorfus-core/metamorph.js";
import { executeBridgeTool } from "../odc-opencode-bridge.js";
import {
  applyDecay,
  recordUse,
  decayMastery,
  MASTERY_FLOOR,
  DECAY_HALF_LIFE_SEC,
} from "../metamorfus-core/decay.js";

let workspaceRoot: string;

before(async () => {
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-"));
});

after(async () => {
  if (workspaceRoot) await fs.rm(workspaceRoot, { recursive: true, force: true });
});

const ctx = () => ({
  workspaceRoot,
  forgeSkill: async (args: any) => {
    // Real call into the in-process registry. Writes a real .py file
    // to disk under <workspaceRoot>/metamorfus-src/dna_library/.
    const result = await executeBridgeTool("forge_skill", args, {
      workspaceRoot,
      dnaDir: "metamorfus-src/dna_library",
    });
    return { output: result.output, data: result.data };
  },
  scanCodebase: async (args: any = {}) => {
    const result = await executeBridgeTool(
      "scan_codebase",
      args,
      { workspaceRoot },
    );
    return result as any;
  },
  dnaDir: "metamorfus-src/dna_library",
});

// ──────────────────────────────────────────────────────────────────────
// INITIAL STATE
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: initial state has no skills", async () => {
  const manifest = await loadManifest(ctx());
  assert.equal(manifest.skills.length, 0);
  assert.equal(manifest.state.profession, "(unborn)");
  assert.equal(manifest.state.cumulative_skill_count, 0);
  assert.deepEqual(manifest.state.active_skill_keys, []);
});

// ──────────────────────────────────────────────────────────────────────
// ADOPT SCIENTIST
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: adopt scientist forges 3 seeds, focus shifts to THINK", async () => {
  const r = await adopt("scientist", ctx());
  assert.equal(r.state.profession, "scientist");
  assert.equal(r.state.morph_focus, "THINK");
  assert.equal(r.state.cumulative_skill_count, 3);
  for (const step of r.steps) {
    assert.equal(step.status, "FORGED", `${step.skillKey} should be FORGED`);
  }
  // All 3 start at mastery 0.5 and dormant.
  for (const s of r.report.skills) {
    assert.equal(s.mastery, 0.5);
    assert.equal(s.status, "dormant");
    assert.equal(s.transferable, false);
    assert.equal(s.last_used_at, null);
  }
});

test("metamorphosis: re-adopting scientist with same versions is idempotent", async () => {
  const r = await adopt("scientist", ctx());
  for (const step of r.steps) {
    assert.equal(step.status, "SKIPPED");
  }
  // The skills remain; still no archaeology yet.
  const manifest = await loadManifest(ctx());
  const archiveCount = manifest.skills.filter((s) => s.status === "archaeology").length;
  assert.equal(archiveCount, 0);
});

// ──────────────────────────────────────────────────────────────────────
// MORPH FOCUS GATES THE CANDIDATE SET — the big conceptual fix
// ──────────────────────────────────────────────────────────────────────

test("concepts: under HUNT focus, scientist (THINK) skills are NOT candidates", async () => {
  // We're still a scientist — adopt lumberjack to get HUNT focus.
  await adopt("lumberjack", ctx());
  const manifest = await loadManifest(ctx());
  assert.equal(manifest.state.morph_focus, "HUNT");

  // Without context, candidates should be ONLY lumberjack HUNT skills
  // and the empty transferable set (nothing has been promoted yet).
  const list = candidates(manifest, { text: "" });
  const keys = list.map((s) => s.key).sort();
  // scientist THINK skills should NOT appear — focus mismatch.
  assert.ok(!keys.includes("hypothesis_protocol"));
  assert.ok(!keys.includes("experimental_design_protocol"));
  assert.ok(!keys.includes("peer_review_protocol"));
  // Lumberjack HUNT skills should appear.
  assert.ok(keys.includes("fell_tree_protocol"));
  assert.ok(keys.includes("weather_read_protocol"));
});

test("concepts: dormant scientist skill wakes on reactivation trigger word", async () => {
  const manifest = await loadManifest(ctx());
  // We're a lumberjack. Ask for candidates in a context mentioning
  // "anomaly" — should wake hypothesis_protocol via its triggers.
  const list = candidates(manifest, { text: "an anomaly in the wood density" });
  const keys = list.map((s) => s.key);
  assert.ok(
    keys.includes("hypothesis_protocol"),
    `hypothesis_protocol must wake on "anomaly". Got: ${keys.join(", ")}`,
  );
});

// ──────────────────────────────────────────────────────────────────────
// EMERGENT TRANSFERABLE — recordUse promotes after 2 distinct professions
// ──────────────────────────────────────────────────────────────────────

test("concepts: transferable is emergent after 2nd distinct profession uses a skill", async () => {
  const manifest0 = await loadManifest(ctx());
  const hp = recall(manifest0, "hypothesis_protocol");
  assert.ok(hp);
  assert.equal(hp!.transferable, false, "starts non-transferable");

  // First EXTERNAL use: lumberjack activates hypothesis_protocol.
  // That's the 1st external profession.
  const u1 = recordUse(hp!, "lumberjack", "tree fall surprise anomaly");
  assert.equal(
    u1.transferable,
    false,
    "still not transferable after 1 external profession",
  );
  assert.equal(u1.usage_history.length, 1);

  // Second EXTERNAL use: architect. Now {lumberjack, architect} = 2.
  const u2 = recordUse(u1, "architect", "structural anomaly surprise");
  assert.equal(
    u2.transferable,
    true,
    "transferable must promote after 2nd distinct external profession",
  );
  assert.equal(u2.usage_history.length, 2);
  assert.ok(u2.mastery > hp!.mastery, "mastery must rise with use");
});

test("concepts: internal use (by origin profession) does NOT promote transferable", async () => {
  const manifest0 = await loadManifest(ctx());
  const hp = recall(manifest0, "hypothesis_protocol")!;
  // scientist is the forge profession. Internal uses should never
  // promote transferable.
  const u = recordUse(hp, "scientist", "another experiment");
  assert.equal(
    u.transferable,
    false,
    "internal re-use must not promote transferable",
  );
});

test("concepts: real metamorphosis reactivation logs usage but needs 2 distinct external professions to promote", async () => {
  // Move to architect — adopt() will trigger reactivation of hypothesis_protocol
  // because "structural anomaly surprise" matches its triggers
  // (surprise, anomaly, why, unexpected).
  const r = await adopt("architect", ctx(), { text: "structural anomaly surprise" });
  assert.ok(
    r.reactivatedSkills.includes("hypothesis_protocol"),
    `expected hypothesis_protocol reactivated, got: ${r.reactivatedSkills.join(", ")}`,
  );
  let manifest = await loadManifest(ctx());
  let hp = recall(manifest, "hypothesis_protocol");
  assert.ok(hp);
  // After ONE external profession used it, transferable is still false.
  assert.equal(
    hp!.transferable,
    false,
    "needs 2 distinct external professions to promote",
  );
  assert.ok(
    hp!.usage_history.some((u) => u.by_profession === "architect"),
    "architect must appear in usage_history",
  );

  // Now have lumberjack adopt and trigger the same skill again via context.
  // lumberjack is also external to scientist, so it's the SECOND distinct.
  await adopt("lumberjack", ctx(), { text: "anomaly in the forest: a surprise storm" });
  manifest = await loadManifest(ctx());
  hp = recall(manifest, "hypothesis_protocol");
  assert.ok(hp);
  // {architect, lumberjack} = 2 distinct external → transferable=true.
  assert.equal(
    hp!.transferable,
    true,
    "transferable should promote after architect + lumberjack reactivations",
  );
  const users = new Set(
    hp!.usage_history
      .filter((u) => u.by_profession !== hp!.profession)
      .map((u) => u.by_profession),
  );
  assert.equal(users.size, 2, "exactly 2 distinct external professions in usage_history");
});

// ──────────────────────────────────────────────────────────────────────
// DECAY — mastery drops with time
// ──────────────────────────────────────────────────────────────────────

test("concepts: a forged skill decays after the half-life", () => {
  // Build the skill directly with mastery=0.8 (no recordUse boost).
  const skill: import("../metamorfus-core/types.js").SkillManifest = {
    key: "test",
    profession: "lab",
    version: 1,
    source: "def skill(organism, context): return {action:'X', intensity:1, required_attributes:{}, version:1}",
    foraged_by: "lab",
    morph_focus: "THINK",
    mastery: 0.8,
    last_used_at: "2020-01-01T00:00:00.000Z",
    usage_history: [],
    transferable: false,
    reactivation_triggers: [],
    forged_at: "2020-01-01T00:00:00.000Z",
    status: "active",
  };
  const decayed = decayMastery(
    skill,
    new Date("2020-01-01T00:00:00.000Z").getTime() + DECAY_HALF_LIFE_SEC * 1000,
  );
  // 0.5 ^ 1 = exactly 0.5; 0.8 * 0.5 = 0.4. Drift comes from ms rounding.
  assert.ok(
    Math.abs(decayed.mastery - 0.4) < 1e-3,
    `mastery should be ~0.4 after one half-life, got ${decayed.mastery}`,
  );
  assert.ok(decayed.mastery >= MASTERY_FLOOR);
});

test("concepts: applyDecay returns a copy with recomputed statuses", () => {
  const skill = {
    key: "x",
    profession: "lab",
    version: 1,
    source: "def s(o,c): return {action:'x', intensity:1, required_attributes:{}, version:1}",
    morph_focus: "THINK" as const,
    mastery: 0.5,
    last_used_at: null,
    usage_history: [],
    transferable: false,
    reactivation_triggers: [],
    forged_at: "2020-01-01T00:00:00.000Z",
    status: "dormant" as const,
  };
  // Fast-forward 5 years (way past half-life).
  const farFuture = new Date("2025-01-01T00:00:00.000Z").getTime();
  const [s] = applyDecay([skill], farFuture);
  assert.ok(s.mastery <= MASTERY_FLOOR + 1e-9, "decays to floor");
  assert.equal(s.status, "decayed");
});

// ──────────────────────────────────────────────────────────────────────
// NO DEDUP — older versions live as archaeology
// ──────────────────────────────────────────────────────────────────────

test("concepts: re-forging keeps the old version as archaeology", async () => {
  // Read disk, inject a v2 in-memory, write back via persist helper.
  const manifest = await loadManifest(ctx());
  const v1 = manifest.skills.find((s) => s.key === "hypothesis_protocol")!;
  const v2 = {
    ...v1,
    version: 2,
    forged_at: new Date().toISOString(),
  };
  manifest.skills.push(v2);

  // Persist directly so the engine reads the modified state on next load.
  const fs = await import("node:fs/promises");
  const targetDir = path.join(
    workspaceRoot,
    "metamorfus-src",
    "dna_library",
  );
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(
    path.join(targetDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  // Now trigger a no-op adopt to run tagArchaeology.
  await adopt("architect", ctx(), { text: "" });

  const after = await loadManifest(ctx());
  const versions = after.skills
    .filter((s) => s.key === "hypothesis_protocol")
    .sort((a, b) => a.version - b.version);
  assert.ok(versions.length >= 2, `must have both versions, got ${versions.length}`);
  // The OLDER (lower version) is archaeology.
  assert.equal(
    versions[0]!.status,
    "archaeology",
    `v${versions[0]!.version} should be archaeology`,
  );
  assert.notEqual(
    versions[versions.length - 1]!.status,
    "archaeology",
    `v${versions[versions.length - 1]!.version} must NOT be archaeology`,
  );
});

// ──────────────────────────────────────────────────────────────────────
// FORGET DOES NOT EXIST — by design
// ──────────────────────────────────────────────────────────────────────

test("concepts: there is no forget() function exported from metamorph", async () => {
  // Importing the module again and inspecting its exports.
  const mod = await import("../metamorfus-core/metamorph.js");
  const exportedNames = Object.keys(mod);
  assert.ok(
    !exportedNames.includes("forget"),
    `forget must not be exported. Found: ${exportedNames.join(", ")}`,
  );
});

// ──────────────────────────────────────────────────────────────────────
// SUMMARY OUTPUT — references the new concepts
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: summary() reports mastery + transferable + archaeology", async () => {
  const manifest = await loadManifest(ctx());
  const text = summary(manifest);
  assert.match(text, /Cumulative unique skills:/);
  assert.match(text, /Reachable right now/);
  assert.match(text, /mastery=/);
  assert.match(text, /scientist -> lumberjack -> architect/);
});

// ──────────────────────────────────────────────────────────────────────
// USE-SKILL ENTRY POINT
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: useSkill() bumps mastery and last_used_at", async () => {
  const manifest0 = await loadManifest(ctx());
  const hpBefore = recall(manifest0, "hypothesis_protocol")!;
  const masteryBefore = hpBefore.mastery;

  const used = useSkill(
    manifest0,
    "hypothesis_protocol",
    "architect",
    "designing new building",
  );
  const hpAfter = recall(used, "hypothesis_protocol")!;
  assert.ok(hpAfter.mastery > masteryBefore);
  assert.ok(hpAfter.last_used_at !== null);
  assert.ok(hpAfter.usage_history.length >= hpBefore.usage_history.length + 1);
});

// ──────────────────────────────────────────────────────────────────────
// UNKNOWN PROFESSION
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: adopting an unknown profession throws", async () => {
  await assert.rejects(() => adopt("astronaut", ctx()), /unknown profession/);
});

// ──────────────────────────────────────────────────────────────────────
// PERSISTENCE
// ──────────────────────────────────────────────────────────────────────

test("metamorphosis: manifest.json is on disk and parses back", async () => {
  const manifestPath = path.join(
    workspaceRoot,
    "metamorfus-src",
    "dna_library",
    "manifest.json",
  );
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.state.profession, "architect");
  assert.ok(parsed.skills.length >= 7);
  assert.ok(parsed.metamorphosis_log.length >= 3);
});

test("metamorphosis: DEFAULT_DNA_DIR points at packages/metamorfus-src/dna_library", () => {
  assert.equal(DEFAULT_DNA_DIR, "packages/metamorfus-src/dna_library");
});
