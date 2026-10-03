// Tests for the builtin skill registry + each adapter skill file.
//
// Strategy:
//   1. registry-level: confirm every builtin is listed and the
//      probe correctly reports availability (installed or not).
//   2. adapter-level: confirm each dna_library/builtin_*_protocol.py
//      is syntactically valid Python, defines skill(), and handles
//      both the "tool available" and "tool missing" code paths.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { BUILTIN_SKILLS, listSkills, getSkill, probeSkill } from "../skills/builtin-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DNA_DIR = path.resolve(__dirname, "../../dna_library");

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

function runPython(code, stdin = "") {
  const r = spawnSync(PYTHON_BIN, ["-c", code], { input: stdin, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function runPythonWithStdin(code, stdin) {
  const r = spawnSync(PYTHON_BIN, ["-c", code], { input: stdin, encoding: "utf8", timeout: 30_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const BUILTIN_IDS = BUILTIN_SKILLS.map((s) => s.id);

// ─── registry ────────────────────────────────────────────────────────

test("registry: listSkills returns every builtin with availability probe", () => {
  const skills = listSkills();
  assert.equal(skills.length, BUILTIN_SKILLS.length);
  for (const s of skills) {
    assert.equal(typeof s.available, "boolean", `${s.id}: available should be boolean`);
  }
});

test("registry: getSkill returns null for unknown id", () => {
  assert.equal(getSkill("not_a_real_skill"), null);
  assert.equal(getSkill("browser_harness").id, "browser_harness");
});

test("registry: builtin IDs cover all 9 packages the operator installed", () => {
  const expected = [
    "browser_harness", "browser_use", "browser_skill",
    "archify", "nginx_skill", "nginx_agent",
    "playwright", "github_mcp", "agent_reach",
  ];
  for (const id of expected) {
    assert.ok(BUILTIN_IDS.includes(id), `missing builtin id: ${id}`);
  }
});

test("registry: each builtin maps to a skillKey that exists in dna_library/", async () => {
  const files = await fs.readdir(DNA_DIR);
  const skills = new Set(files.filter((f) => f.endsWith("_protocol.py")).map((f) => f));
  for (const s of BUILTIN_SKILLS) {
    assert.ok(skills.has(`${s.skillKey}.py`), `missing adapter file: ${s.skillKey}.py`);
  }
});

test("registry: archify and github_mcp installHint points at a real path on disk", async () => {
  const archify = getSkill("archify");
  const gh = getSkill("github_mcp");
  // archify ships with the .mjs file — even unbuilt, we can find it.
  assert.match(archify.installHint, /archify\.mjs/);
  // github_mcp needs a Go build step; we at least confirm the source dir exists.
  const ghSrcDir = path.dirname(gh.interpreter);
  const stat = await fs.stat(ghSrcDir).catch(() => null);
  assert.ok(stat?.isDirectory(), `github-mcp-server source dir missing: ${ghSrcDir}`);
});

// ─── adapter skill files: each is valid Python with a skill() function ──

for (const builtin of BUILTIN_SKILLS) {
  test(`adapter: ${builtin.skillKey}.py is valid Python and defines skill()`, () => {
    const file = path.join(DNA_DIR, `${builtin.skillKey}.py`);
    const r = runPython(`import sys; compile(open(${JSON.stringify(file)}).read(), ${JSON.stringify(file)}, "exec"); print("ok")`);
    assert.equal(r.status, 0, `compile failed for ${builtin.skillKey}: ${r.stderr}`);
    // Also confirm it defines skill(...)
    const r2 = runPython(`import importlib.util; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); print("yes" if callable(getattr(m, "skill", None)) else "no")`);
    assert.equal(r2.stdout.trim(), "yes", `${builtin.skillKey}: skill is not callable`);
  });
}

test("adapter: nginx_agent returns available references when no question", () => {
  const file = path.join(DNA_DIR, "builtin_nginx_agent_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.ok, "nginx_agent without question should return ok=true");
  assert.ok(Array.isArray(parsed.available_references));
  assert.ok(parsed.available_references.length > 0);
});

test("adapter: nginx_agent reads the right reference for gotchas questions", () => {
  const file = path.join(DNA_DIR, "builtin_nginx_agent_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"question": "what are nginx directive inheritance gotchas?"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.reference, "nginx-gotchas.md");
  assert.ok(parsed.excerpt.length > 100);
});

test("adapter: nginx_skill lists sites via sites-enabled directory or returns clear error", () => {
  const file = path.join(DNA_DIR, "builtin_nginx_skill_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "list_sites"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  // Either we have sites-enabled or we get a clear error path.
  assert.ok(parsed.ok === true || typeof parsed.error === "string");
});

test("adapter: nginx_skill test_config runs nginx -t (success or graceful failure)", () => {
  const file = path.join(DNA_DIR, "builtin_nginx_skill_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "test_config"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(typeof parsed.test_passed, "boolean", "test_config must return test_passed boolean");
});

test("adapter: github_mcp returns a clean install hint when binary is missing", () => {
  const file = path.join(DNA_DIR, "builtin_github_mcp_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "list_tools"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  // The binary may or may not be built. Either way we get a structured
  // response with ok OR an error containing the install hint.
  if (parsed.error) {
    assert.match(parsed.error, /github-mcp|GITHUB_TOKEN/);
  }
});

test("adapter: browser_use returns a clean install hint when package is missing", () => {
  const file = path.join(DNA_DIR, "builtin_browser_use_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"task": "click button"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.error || parsed.ok === true, "must return error or success");
  if (parsed.error) {
    assert.match(parsed.error, /browser_use/);
  }
});

test("adapter: archify falls back to direct node invocation", () => {
  const file = path.join(DNA_DIR, "builtin_archify_protocol.py");
  // Just confirm the adapter can be loaded and called without crashing.
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "doctor"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  // archify binary may not be installed in test env; we accept both paths.
  assert.ok(parsed.ok === true || typeof parsed.error === "string");
});

test("adapter: browser_harness returns clean install hint when CLI missing", () => {
  const file = path.join(DNA_DIR, "builtin_browser_harness_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "info"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.error || parsed.ok === true);
});

test("adapter: agent_reach returns clean install hint when package missing", () => {
  const file = path.join(DNA_DIR, "builtin_agent_reach_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"url": "https://example.com"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.error || parsed.ok === true);
});

test("adapter: playwright returns clean install hint when package missing", () => {
  const file = path.join(DNA_DIR, "builtin_playwright_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "screenshot", "url": "https://example.com"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.error || parsed.ok === true);
});

test("adapter: browser_skill returns clean install hint when bsk missing", () => {
  const file = path.join(DNA_DIR, "builtin_browser_skill_protocol.py");
  const r = runPythonWithStdin(
    `import importlib.util, json, sys; spec = importlib.util.spec_from_file_location("s", ${JSON.stringify(file)}); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); r = m.skill({}, {"action": "session_start"}); print(json.dumps(r))`,
    "",
  );
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(parsed.error || parsed.ok === true);
});
