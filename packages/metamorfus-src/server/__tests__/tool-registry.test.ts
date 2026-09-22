/**
 * Tests for the OpenCode tool registry (Option B).
 *
 *   • vision_describe   — wraps NVIDIA NIM kimi-k3 (already covered in
 *                         vision-tool.test.ts; here we re-exercise the
 *                         registry glue).
 *   • scan_codebase     — filesystem walker + extension histogram + TODO
 *                         detector. Stubs fs so the test is hermetic.
 *   • forge_skill       — validates skillKey + python source shape, writes
 *                         to a real temp directory (no network).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

import {
  listTools,
  getTool,
  executeTool,
  type ToolContext,
} from "../opencode-tools/registry.js";

const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({
  workspaceRoot: "/tmp",
  env: {},
  ...extra,
});

// ----------------------------------------------------------------------------
// listTools / getTool
// ----------------------------------------------------------------------------

test("listTools: includes the three declared tools", () => {
  const tools = listTools();
  const names = tools.map((t) => t.name);
  assert.deepEqual(
    names.sort(),
    ["forge_skill", "scan_codebase", "vision_describe"],
  );
});

test("listTools: every entry has a non-empty description", () => {
  for (const t of listTools()) {
    assert.ok(t.description.length > 20, `description too short for ${t.name}`);
  }
});

test("getTool: returns undefined for unknown names", () => {
  assert.equal(getTool("nope"), undefined);
});

test("getTool: returns the right tool by name", () => {
  const t = getTool("scan_codebase");
  assert.ok(t, "scan_codebase missing");
  assert.equal(t!.name, "scan_codebase");
});

// ----------------------------------------------------------------------------
// executeTool — unknown name
// ----------------------------------------------------------------------------

test("executeTool: throws clearly when the name is unknown", async () => {
  await assert.rejects(
    () => executeTool("not_a_tool", {}, ctx()),
    /unknown tool/,
  );
});

// ----------------------------------------------------------------------------
// scan_codebase — by writing a real temp dir
// ----------------------------------------------------------------------------

const VALID_PY_SKILL = `
def skill(organism, context):
    return {"action": "SCOUT", "intensity": 0.5, "required_attributes": {"agility": 10}, "version": 1}
`.trim();

test("scan_codebase: returns file counts, extension histogram and TODOs", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "scan-"));
  try {
    await fs.writeFile(path.join(tmp, "a.ts"), "const x = 1;\n// TODO: refactor");
    await fs.writeFile(path.join(tmp, "b.py"), "# FIXME: handle None\n");
    await fs.mkdir(path.join(tmp, "src"));
    await fs.writeFile(path.join(tmp, "src", "c.tsx"), "export const Y=2;\n");
    await fs.mkdir(path.join(tmp, "node_modules"));
    await fs.writeFile(path.join(tmp, "node_modules", "ignore.js"), "ignore me\n");

    const tool = getTool("scan_codebase")!;
    const result = await tool.execute({}, { workspaceRoot: tmp, env: {} });
    assert.ok(result.data, "data should be set");
    const data = result.data as any;
    assert.equal(data.fileCount, 3, "excludes node_modules");
    assert.equal(data.todoCount, 2);
    assert.ok(data.topExtensions[".ts"] >= 1);
    assert.ok(data.topExtensions[".tsx"] >= 1);
    assert.ok(data.topExtensions[".py"] >= 1);
    assert.equal(data.lineCounts["a.ts"], 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("scan_codebase: throws when root does not exist", async () => {
  const tool = getTool("scan_codebase")!;
  await assert.rejects(
    () => tool.execute({ root: "definitely/not/here" }, { workspaceRoot: "/tmp", env: {} }),
    /root not found/,
  );
});

// ----------------------------------------------------------------------------
// forge_skill — validation + dry-run + real write
// ----------------------------------------------------------------------------

test("forge_skill: rejects keys not ending with _protocol", async () => {
  const tool = getTool("forge_skill")!;
  await assert.rejects(
    () => tool.execute({ skillKey: "broken", pythonSource: VALID_PY_SKILL }, ctx()),
    /must end with _protocol/,
  );
});

test("forge_skill: rejects protected built-in skills", async () => {
  const tool = getTool("forge_skill")!;
  await assert.rejects(
    () =>
      tool.execute(
        { skillKey: "mine_protocol", pythonSource: VALID_PY_SKILL },
        ctx(),
      ),
    /protected built-in/,
  );
});

test("forge_skill: rejects empty pythonSource", async () => {
  const tool = getTool("forge_skill")!;
  await assert.rejects(
    () => tool.execute({ skillKey: "ok_protocol", pythonSource: "" }, ctx()),
    /looks empty|empty source/i,
  );
});

test("forge_skill: rejects source that does not define skill(organism, context)", async () => {
  const tool = getTool("forge_skill")!;
  await assert.rejects(
    () =>
      tool.execute(
        { skillKey: "ok_protocol", pythonSource: "def wrong():\n    pass" },
        ctx(),
      ),
    /def skill\(organism, context\)/,
  );
});

test("forge_skill: rejects source missing action in returned dict", async () => {
  const tool = getTool("forge_skill")!;
  const source = `
def skill(organism, context):
    return {"intensity": 0.5}
`.trim();
  await assert.rejects(
    () =>
      tool.execute(
        { skillKey: "no_action_protocol", pythonSource: source },
        ctx(),
      ),
    /action/,
  );
});

test("forge_skill: dry run reports planned path without writing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "forge-"));
  try {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-"));
    // The tool writes to <workspaceRoot>/packages/metamorfus-src/dna_library
    await fs.mkdir(
      path.join(projectRoot, "packages", "metamorfus-src"),
      { recursive: true },
    );
    const tool = getTool("forge_skill")!;
    const result = await tool.execute(
      {
        skillKey: "scout_protocol",
        pythonSource: VALID_PY_SKILL,
        dryRun: true,
      },
      { workspaceRoot: projectRoot, env: {} },
    );
    assert.match(result.output, /Would write/);
    assert.equal((result.data as any).dryRun, true);
    const target = path.join(
      projectRoot,
      "packages",
      "metamorfus-src",
      "dna_library",
      "scout_protocol.py",
    );
    await assert.rejects(fs.access(target));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("forge_skill: writes the file when not a dry run", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-write-"));
  try {
    await fs.mkdir(
      path.join(projectRoot, "packages", "metamorfus-src"),
      { recursive: true },
    );
    const tool = getTool("forge_skill")!;
    const result = await tool.execute(
      {
        skillKey: "scout_protocol",
        pythonSource: VALID_PY_SKILL,
      },
      { workspaceRoot: projectRoot, env: {} },
    );
    assert.match(result.output, /Wrote scout_protocol/);
    const target = path.join(
      projectRoot,
      "packages",
      "metamorfus-src",
      "dna_library",
      "scout_protocol.py",
    );
    const written = await fs.readFile(target, "utf8");
    assert.equal(written, VALID_PY_SKILL);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});
