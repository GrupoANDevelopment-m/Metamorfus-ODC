// Live end-to-end test of the Option B tools against the real workspace.
//   1. scan_codebase → walks packages/metamorfus-src and prints the
//      top extensions + TODOs.
//   2. forge_skill  → dry-run for scout_protocol, then writes it for real.
//   3. re-scan       → confirms the new skill lands in the file list.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { executeBridgeTool } from "../server/odc-opencode-bridge.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..",  // packages/metamorfus-src/.opencode -> metamorfus-opencode/
);

const banner = (label) =>
  console.log(`\n${"═".repeat(70)}\n  ${label}\n${"═".repeat(70)}\n`);

banner("1) scan_codebase → packages/metamorfus-src");
const scan = await executeBridgeTool(
  "scan_codebase",
  {},
  { workspaceRoot: root },
);
console.log("OUTPUT:", scan.output);
const data = scan.data;
console.log("FILES:", data.fileCount);
console.log("BYTES:", data.totalBytes);
console.log("TODOs:", data.todoCount);
console.log("TOP EXTS:", data.topExtensions);
console.log("TOP LINE-COUNT FILES:", data.lineCounts);
console.log("SAMPLE TODOs:");
for (const t of data.topTodos.slice(0, 5)) {
  console.log(`  ${t.file}:${t.line}  ${t.text}`);
}

banner("2) forge_skill → scout_protocol (dry run)");
const dry = await executeBridgeTool(
  "forge_skill",
  {
    skillKey: "scout_protocol",
    pythonSource: `
def skill(organism, context):
    """Scout the local environment — emitted by the Cortex cycle demo."""
    target = context.get("target", ".")
    return {
        "action": "SCOUT",
        "intensity": 0.45,
        "required_attributes": {"agility": 20},
        "version": 1,
        "params": {"target": target}
    }
`.trim(),
    dryRun: true,
  },
  { workspaceRoot: root },
);
console.log("OUTPUT:", dry.output);

banner("3) forge_skill → scout_protocol (real write)");
const real = await executeBridgeTool(
  "forge_skill",
  {
    skillKey: "scout_protocol",
    pythonSource: `
def skill(organism, context):
    """Scout the local environment — emitted by the Cortex cycle demo."""
    target = context.get("target", ".")
    return {
        "action": "SCOUT",
        "intensity": 0.45,
        "required_attributes": {"agility": 20},
        "version": 1,
        "params": {"target": target}
    }
`.trim(),
  },
  { workspaceRoot: root },
);
console.log("OUTPUT:", real.output);

banner("4) re-scan → confirm the new skill landed");
const scan2 = await executeBridgeTool(
  "scan_codebase",
  {},
  { workspaceRoot: root },
);
console.log("FILES AFTER:", scan2.data.fileCount);
const found = scan2.data.lineCounts["dna_library/scout_protocol.py"];
console.log("scout_protocol.py line count:", found);
if (typeof found === "number") {
  console.log("✓ new skill present in dna_library");
} else {
  console.log("✗ skill not detected by scan");
}
