// Tests for the DNA library git sync.
//
// Strategy: spin up a local "remote" bare git repo, then use a
// normal clone as the "local" DNA library. pushDna / pullDna exercise
// the full round-trip with a real git binary.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pushDna, pullDna } from "../sync/dna-git-sync.mjs";

let workdir;

before(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), "dna-sync-"));
  await fs.mkdir(path.join(workdir, "remote"), { recursive: true });
  await fs.mkdir(path.join(workdir, "machine-a/dna_library"), { recursive: true });
  await fs.mkdir(path.join(workdir, "machine-b/dna_library"), { recursive: true });
  // Initialize a bare remote.
  await new Promise((r, e) => {
    const p = spawn("git", ["init", "--bare", "-q"], { cwd: path.join(workdir, "remote") });
    p.on("exit", (c) => (c === 0 ? r() : e(new Error("git init bare failed"))));
  });
  // Seed machine-a with a manifest.
  await fs.writeFile(
    path.join(workdir, "machine-a/dna_library/manifest.json"),
    JSON.stringify({ state: { profession: "scientist", cumulative_skill_count: 3 }, skills: [] }, null, 2),
  );
  // Seed a skill .py file too (shared with remote).
  await fs.writeFile(
    path.join(workdir, "machine-a/dna_library/hypothesis_protocol.py"),
    "def skill(organism, context): return {'action':'H', 'intensity':0.5, 'required_attributes':{}, 'version':1}",
  );
});

after(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

const remote = () => `file://${path.join(workdir, "remote")}`;

test("sync: machine-a pushes its DNA to origin/tenant-test", async () => {
  const r = await pushDna({
    dnaDir: path.join(workdir, "machine-a/dna_library"),
    tenantId: "test",
    remote: remote(),
    authorName: "Test Bot",
    authorEmail: "bot@test.local",
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "push");
  assert.equal(r.branch, "tenant-test");
  assert.ok(r.commitSha, "commit sha must be set");
});

test("sync: machine-b pulls the DNA from origin/tenant-test", async () => {
  const r = await pullDna({
    dnaDir: path.join(workdir, "machine-b/dna_library"),
    tenantId: "test",
    remote: remote(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.action, "pull");
  // Files must be on disk after pull.
  const manifest = await fs.readFile(
    path.join(workdir, "machine-b/dna_library/manifest.json"),
    "utf8",
  );
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.state.profession, "scientist");
  const skillFile = await fs.readFile(
    path.join(workdir, "machine-b/dna_library/hypothesis_protocol.py"),
    "utf8",
  );
  assert.match(skillFile, /def skill/);
});

test("sync: a noop push (no changes) returns action='noop' and is idempotent", async () => {
  const r = await pushDna({
    dnaDir: path.join(workdir, "machine-a/dna_library"),
    tenantId: "test",
    remote: remote(),
  });
  assert.equal(r.action, "noop");
  assert.ok(r.message);
});

test("sync: machine-b adds a new skill and pushes; machine-a pulls it back", async () => {
  const b = path.join(workdir, "machine-b/dna_library");
  await fs.writeFile(
    path.join(b, "weather_read_protocol.py"),
    "def skill(o,c): return {'action':'W','intensity':0.3,'required_attributes':{},'version':1}",
  );
  // Update machine-b's manifest to reflect the new skill.
  const manifestPath = path.join(b, "manifest.json");
  const m = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  m.state.profession = "lumberjack";
  m.state.cumulative_skill_count = 4;
  await fs.writeFile(manifestPath, JSON.stringify(m, null, 2));

  const pushed = await pushDna({
    dnaDir: b,
    tenantId: "test",
    remote: remote(),
  });
  assert.equal(pushed.action, "push");
  assert.ok(pushed.commitSha);

  const pulled = await pullDna({
    dnaDir: path.join(workdir, "machine-a/dna_library"),
    tenantId: "test",
    remote: remote(),
  });
  assert.equal(pulled.action, "pull");
  // machine-a's manifest now reflects the new profession.
  const aManifest = JSON.parse(
    await fs.readFile(
      path.join(workdir, "machine-a/dna_library/manifest.json"),
      "utf8",
    ),
  );
  assert.equal(aManifest.state.profession, "lumberjack");
  const w = await fs.readFile(
    path.join(workdir, "machine-a/dna_library/weather_read_protocol.py"),
    "utf8",
  );
  assert.match(w, /def skill/);
});

test("sync: push with no remote configured throws", async () => {
  await assert.rejects(
    () =>
      pushDna({
        dnaDir: path.join(workdir, "machine-a/dna_library"),
        tenantId: "test",
        // no remote
      }),
    /No remote configured/,
  );
});
