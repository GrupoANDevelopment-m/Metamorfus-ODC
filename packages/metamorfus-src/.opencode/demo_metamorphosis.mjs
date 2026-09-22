// Live metamorphosis demo — scientist → lumberjack → architect, run on
// the real workspace. Each profession changes the morph_focus and grows
// a new set of skills via forge_skill. Past skills stay in the DNA
// library.

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  adopt,
  loadManifest,
  recall,
  summary,
  DEFAULT_DNA_DIR,
} from "../server/metamorfus-core/metamorph.js";
import {
  executeBridgeTool,
} from "../server/odc-opencode-bridge.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..",  // .opencode -> metamorfus-src -> packages -> metamorfus-opencode
);

const banner = (label) =>
  console.log(`\n${"═".repeat(70)}\n  ${label}\n${"═".repeat(70)}\n`);

const ctx = {
  workspaceRoot: root,
  dnaDir: DEFAULT_DNA_DIR,
  forgeSkill: async (args) => {
    const result = await executeBridgeTool("forge_skill", args, {
      workspaceRoot: root,
      dnaDir: DEFAULT_DNA_DIR,
    });
    return { output: result.output, data: result.data };
  },
  scanCodebase: async (args = {}) => {
    const result = await executeBridgeTool(
      "scan_codebase",
      args,
      { workspaceRoot: root },
    );
    return result;
  },
};

// ─── ACT I: scientist ───────────────────────────────────────────────
banner("ACT I — Born as a SCIENTIST (THINK focus, 3 skills forged)");
await adopt("scientist", ctx);
let m = await loadManifest(ctx);
console.log(summary(m));

// ─── ACT II: lumberjack ─────────────────────────────────────────────
banner("ACT II — Metamorphoses into a LUMBERJACK (HUNT focus, 4 new skills)");
const r2 = await adopt("lumberjack", ctx);
console.log("Forged now:", r2.steps.filter((s) => s.status === "FORGED").map((s) => s.skillKey).join(", "));
console.log("Retained from scientist:", r2.state.retained_from_past_professions.join(", "));
m = await loadManifest(ctx);
console.log(summary(m));

// ─── ACT III: architect ─────────────────────────────────────────────
banner("ACT III — Metamorphoses into an ARCHITECT (THINK focus, 3 new skills)");
const r3 = await adopt("architect", ctx);
console.log("Forged now:", r3.steps.filter((s) => s.status === "FORGED").map((s) => s.skillKey).join(", "));
const inheritedScientist = recall(r3.report, "hypothesis_protocol");
const inheritedLumberjack = recall(r3.report, "weather_read_protocol");
console.log(`The architect RECALLS hypothesis_protocol (origin: ${inheritedScientist.profession}, transferable=${inheritedScientist.transferable}).`);
console.log(`The architect RECALLS weather_read_protocol (origin: ${inheritedLumberjack.profession}, transferable=${inheritedLumberjack.transferable}).`);
m = await loadManifest(ctx);
console.log(summary(m));

// ─── TRANSFER TEST ──────────────────────────────────────────────────
banner("TRANSFER TEST — what does the architect still remember?");
const allSkills = m.skills.map((s) => `${s.key}  [from ${s.profession}, transferable=${s.transferable}]`).sort();
for (const line of allSkills) console.log("  " + line);

// ─── DNA LIBRARY ON DISK ───────────────────────────────────────────
banner("DNA LIBRARY ON DISK");
const dnaPath = path.join(root, DEFAULT_DNA_DIR);
const fs = await import("node:fs/promises");
const files = (await fs.readdir(dnaPath)).sort();
console.log(`Directory: ${dnaPath}`);
console.log(`Files: ${files.length}`);
for (const f of files) {
  console.log("  -", f);
}

console.log(`\nFinal state: profession=${m.state.profession}, morph_focus=${m.state.morph_focus}, cumulative=${m.state.cumulative_skill_count}, reachable=${m.state.active_skill_keys.length}, decayed=${m.state.decayed_skills.length}`);
console.log(`Metamorphoses recorded: ${m.metamorphosis_log.length}`);
