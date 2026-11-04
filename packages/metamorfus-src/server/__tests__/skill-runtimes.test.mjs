/**
 * The runner must honour the runtime a skill declares.
 *
 * The organism's seeds carry four runtimes: python, shell, javascript
 * and spec. The runner used to look for `<key>.py` no matter what, so
 * in a fresh workspace — where adopt() materialises the seed's own
 * runtime — a `shell` skill was written as `<key>.sh` and then invoked
 * as `<key>.py`. It could not run at all.
 *
 * These tests run the real runner against real files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));

async function workspaceWith(skills) {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-runtime-"));
  try { await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules")); } catch {}
  const dnaDir = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dnaDir, { recursive: true });
  for (const s of skills) {
    if (s.file) await fs.writeFile(path.join(dnaDir, s.file), s.content, "utf8");
  }
  await fs.writeFile(
    path.join(dnaDir, "manifest.json"),
    JSON.stringify({ skills: skills.map((s) => ({ key: s.key, profession: "tester", runtime: s.runtime, status: "active", usage_history: [] })) }, null, 2),
    "utf8",
  );
  return { ws, dnaDir };
}

test("runner: a python skill still runs through the invoker", async () => {
  const { ws } = await workspaceWith([
    {
      key: "py_skill_protocol",
      runtime: "python",
      file: "py_skill_protocol.py",
      content:
        "def skill(organism, context):\n" +
        "    return {'action': 'PY_OK', 'intensity': 0.5, 'version': 1,\n" +
        "            'result': {'echo': context.get('v')}}\n",
    },
  ]);
  const r = await runSkill(ws, { skillKey: "py_skill_protocol", byProfession: "tester", context: { v: 42 } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.runtime, "python");
  assert.equal(r.result.action, "PY_OK");
  assert.equal(r.result.result.echo, 42);
  await fs.rm(ws, { recursive: true, force: true });
});

test("runner: a shell skill is executed with bash, not looked up as .py", async () => {
  const { ws } = await workspaceWith([
    {
      key: "sh_skill_protocol",
      runtime: "shell",
      file: "sh_skill_protocol.sh",
      // The context is echoed base64-encoded so the JSON stays valid.
      content:
        '#!/usr/bin/env bash\nset -euo pipefail\n' +
        'echo "{\\"action\\":\\"SH_OK\\",\\"intensity\\":0.4,\\"version\\":1,' +
        '\\"result\\":{\\"echo\\":\\"$(printf %s \\"$METAMORFUS_CONTEXT\\" | base64 -w0)\\"}}"\n',
    },
  ]);
  const r = await runSkill(ws, { skillKey: "sh_skill_protocol", byProfession: "tester", context: { v: 7 } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.runtime, "shell");
  assert.equal(r.result.action, "SH_OK");
  const echoed = Buffer.from(String(r.result.result.echo), "base64").toString("utf8");
  assert.ok(echoed.includes("7"), `the shell skill did not receive the context: ${echoed}`);
  await fs.rm(ws, { recursive: true, force: true });
});

test("runner: a javascript skill is executed with node and its skill() is called", async () => {
  const { ws } = await workspaceWith([
    {
      key: "js_skill_protocol",
      runtime: "javascript",
      file: "js_skill_protocol.js",
      content:
        "function skill(organism, context) {\n" +
        "  return { action: 'JS_OK', intensity: 0.5, version: 1,\n" +
        "           result: { doubled: (context.get('n') || 0) * 2 } };\n" +
        "}\n",
    },
  ]);
  const r = await runSkill(ws, { skillKey: "js_skill_protocol", byProfession: "tester", context: { n: 21 } });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.runtime, "javascript");
  assert.equal(r.result.action, "JS_OK");
  assert.equal(r.result.result.doubled, 42);
  await fs.rm(ws, { recursive: true, force: true });
});

test("runner: a spec skill returns its reference document, not an error", async () => {
  const { ws } = await workspaceWith([
    {
      key: "spec_skill_protocol",
      runtime: "spec",
      file: "spec_skill_protocol.spec.json",
      content: JSON.stringify({ title: "spec_skill_protocol", type: "reference", rules: ["rule one"] }, null, 2),
    },
  ]);
  const r = await runSkill(ws, { skillKey: "spec_skill_protocol", byProfession: "tester", context: {} });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.runtime, "spec");
  assert.equal(r.result.action, "SPEC_REFERENCE");
  assert.equal(r.result.result.rules[0], "rule one");
  await fs.rm(ws, { recursive: true, force: true });
});

test("runner: a skill whose runtime file is missing falls back to .py", async () => {
  const { ws } = await workspaceWith([
    {
      key: "fallback_skill_protocol",
      runtime: "shell",
      file: "fallback_skill_protocol.py",
      content:
        "def skill(organism, context):\n" +
        "    return {'action': 'FALLBACK_OK', 'intensity': 0.5, 'version': 1, 'result': {}}\n",
    },
  ]);
  const r = await runSkill(ws, { skillKey: "fallback_skill_protocol", byProfession: "tester", context: {} });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.action, "FALLBACK_OK");
  await fs.rm(ws, { recursive: true, force: true });
});

test("runner: a missing skill is reported, not thrown", async () => {
  const { ws } = await workspaceWith([]);
  const r = await runSkill(ws, { skillKey: "nope_protocol", byProfession: "tester", context: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /not in manifest/);
  await fs.rm(ws, { recursive: true, force: true });
});
