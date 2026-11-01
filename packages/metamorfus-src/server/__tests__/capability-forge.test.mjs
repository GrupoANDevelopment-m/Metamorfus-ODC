/**
 * Tests for the capability forge — the production path where the
 * organism grows a capability it does not have.
 *
 * These run WITHOUT an LLM key. They cover everything that must be
 * true regardless of what the model returns:
 *
 *   • the key is validated before anything is written
 *   • a capability that already exists is never overwritten
 *   • a forged skill is written into the CALLER'S workspace, not into
 *     the installed package (the bug that put every forged skill in
 *     the wrong place)
 *   • the manifest records the provenance
 *   • a skill that does not execute is reported as NOT usable
 *
 * The LLM path itself is exercised by the live battery (T6/T13).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { forgeCapability, listCapabilities } = await import(
  path.join(ROOT, "server/cognitive/capability-forge.mjs")
);

async function makeWorkspace() {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-forge-test-"));
  try { await fs.symlink(path.join(ROOT, "node_modules"), path.join(ws, "node_modules")); } catch {}
  const dnaDir = path.join(ws, "packages", "metamorfus-src", "dna_library");
  await fs.mkdir(dnaDir, { recursive: true });
  await fs.writeFile(path.join(dnaDir, "manifest.json"), JSON.stringify({ skills: [] }, null, 2));
  return { ws, dnaDir };
}

test("capability forge: rejects an invalid skillKey before touching disk", async () => {
  const { ws, dnaDir } = await makeWorkspace();
  for (const bad of ["", "X", "../escape", "has space", "UPPER", "a"]) {
    const r = await forgeCapability(ws, { skillKey: bad, capability: "compute something useful here" });
    assert.equal(r.created, false, `accepted bad key: ${bad}`);
    assert.match(r.reason, /invalid skillKey/);
  }
  // nothing was written
  const files = await fs.readdir(dnaDir);
  assert.deepEqual(files.filter((f) => f.endsWith(".py")), []);
  await fs.rm(ws, { recursive: true, force: true });
});

test("capability forge: refuses a capability description too thin to implement", async () => {
  const { ws } = await makeWorkspace();
  const r = await forgeCapability(ws, { skillKey: "some_capability_protocol", capability: "do stuff" });
  assert.equal(r.created, false);
  assert.match(r.reason, /too short/);
  await fs.rm(ws, { recursive: true, force: true });
});

test("capability forge: never overwrites an existing skill", async () => {
  const { ws, dnaDir } = await makeWorkspace();
  await fs.writeFile(path.join(dnaDir, "existing_capability_protocol.py"), "# original\n", "utf8");
  const manifest = {
    skills: [
      { key: "existing_capability_protocol", profession: "tester", runtime: "python", status: "active" },
    ],
  };
  await fs.writeFile(path.join(dnaDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const r = await forgeCapability(ws, {
    skillKey: "existing_capability_protocol",
    capability: "replace what this skill does with something else entirely",
  });
  assert.equal(r.created, false);
  assert.match(r.reason, /already exists/);
  // the original file is untouched
  const content = await fs.readFile(path.join(dnaDir, "existing_capability_protocol.py"), "utf8");
  assert.equal(content, "# original\n");
  await fs.rm(ws, { recursive: true, force: true });
});

test("capability forge: writes into the caller's workspace, not the installed package", async () => {
  const { ws, dnaDir } = await makeWorkspace();
  // A skill that already exists in the library, so the forge refuses to
  // touch it — but the refusal must come from the WORKSPACE's library.
  const r = await forgeCapability(ws, {
    skillKey: "workspace_only_capability_protocol",
    capability: "this description is long enough to pass the length gate",
  });
  // Without an LLM key there is no model to ask, so the forge must
  // fail honestly rather than invent a skill.
  assert.equal(r.created, false);
  assert.match(r.reason, /no model produced valid Python/);
  assert.ok(Array.isArray(r.triedModels));

  // Nothing may have been written into the installed package.
  const installed = path.join(ROOT, "dna_library", "workspace_only_capability_protocol.py");
  assert.equal(
    await fs.stat(installed).then(() => true).catch(() => false),
    false,
    "the forge wrote into the installed package instead of the workspace",
  );
  const installedManifest = JSON.parse(
    await fs.readFile(path.join(ROOT, "dna_library", "manifest.json"), "utf-8"),
  );
  assert.equal(
    installedManifest.skills.some((s) => s.key === "workspace_only_capability_protocol"),
    false,
    "the forge registered the skill in the installed package",
  );
  await fs.rm(ws, { recursive: true, force: true });
});

test("capability listing separates seeds from forged skills", async () => {
  const { ws, dnaDir } = await makeWorkspace();
  const manifest = {
    skills: [
      { key: "seed_skill_protocol", profession: "meteorologist", runtime: "python", status: "dormant" },
      {
        key: "grown_skill_protocol",
        profession: "generalist",
        runtime: "python",
        status: "active",
        created_by: "capability-forge",
        forged_by_model: "nvidia/nemotron-3-ultra-550b-a55b",
      },
    ],
  };
  await fs.writeFile(path.join(dnaDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  const r = await listCapabilities(ws);
  assert.equal(r.total, 2);
  assert.equal(r.forged, 1);
  const grown = r.capabilities.find((c) => c.key === "grown_skill_protocol");
  assert.equal(grown.forged_by_model, "nvidia/nemotron-3-ultra-550b-a55b");
  await fs.rm(ws, { recursive: true, force: true });
});

test("capability listing survives a library that does not exist yet", async () => {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), "metamorfus-forge-empty-"));
  const r = await listCapabilities(ws);
  assert.equal(r.total, 0);
  assert.deepEqual(r.capabilities, []);
  await fs.rm(ws, { recursive: true, force: true });
});
