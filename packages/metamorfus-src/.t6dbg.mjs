import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";
const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-t6-"));
try { await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules")); } catch {}
const dna = path.join(ws, "packages", "metamorfus-src", "dna_library");
await fs.mkdir(dna, { recursive: true });
const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
const { adopt } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.ts"));
const c = {
  workspaceRoot: ws, dnaDir: "packages/metamorfus-src/dna_library",
  forgeSkill: async (a) => { const r = await executeBridgeTool("forge_skill", a, { workspaceRoot: ws }); return { output: r.output, data: r.data }; },
  scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot: ws }),
};
await adopt("meteorologist", c);
const { measureSelfEvolution } = await import(ROOT + "/server/cognitive/evolve-skill.mjs");
const r = await measureSelfEvolution(ws, {
  failingTask: { skillKey: "analyze_pressure_gradient_protocol", profession: "meteorologist", context: { stations: "this is not a list", top_n: -1 } },
  maxAttempts: 3,
});
console.log(JSON.stringify(r, null, 1).slice(0, 1500));
await fs.rm(ws, { recursive: true, force: true });
