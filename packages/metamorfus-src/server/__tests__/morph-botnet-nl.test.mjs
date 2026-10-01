// Tests for the metamorphose engine, botnet library, and NL intent
// parser/action router. These cover the gaps that were missing before:
//   • /api/metamorphose actually executing the plan
//   • /api/botnet/models CRUD + lineage
//   • /api/botnet/runs spawn + broadcast + kill
//   • /api/nl/dispatch parse + dispatch
//
// Tests use an in-process stub LLM (not the real NVIDIA endpoint) so
// they're hermetic.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";

import { BotnetLibrary } from "../botnet/library.mjs";
import { MetamorphoseOrchestrator, readMetamorphosisLog } from "../metamorfose/orchestrator.mjs";
import { PromptPlanner } from "../metamorfose/prompt-planner.mjs";
import { IntentParser } from "../nl/intent.mjs";
import { ActionRouter } from "../nl/router.mjs";
import { LlmLibraryStore } from "../llm-library/store.mjs";
import { LlmRouter } from "../llm-library/router.mjs";

async function tmpDir(prefix) {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function makeStubServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

// ─── BotnetLibrary ──────────────────────────────────────────────────

test("botnet library: create → list → get round-trip persists to disk", async () => {
  const dir = await tmpDir("botnet-lib-");
  const lib = new BotnetLibrary(dir);
  await lib.load();
  const m = await lib.create({ name: "vision-cluster-v1", kind: "vision" });
  assert.equal(m.kind, "vision");
  assert.ok(Array.isArray(m.skills) && m.skills.length > 0, "preset should fill skills");
  assert.equal(m.dna.fitness, 0.5);
  // Reload from disk.
  const lib2 = new BotnetLibrary(dir);
  await lib2.load();
  const back = lib2.get(m.id);
  assert.equal(back.name, "vision-cluster-v1");
});

test("botnet library: mutate creates a new generation, preserves parent", async () => {
  const dir = await tmpDir("botnet-lib-");
  const lib = new BotnetLibrary(dir);
  await lib.load();
  const parent = await lib.create({ name: "scraper-v1", kind: "scraping" });
  const child = await lib.mutate(parent.id, {
    skills: ["http_fetch_protocol", "rate_limit_protocol", "captcha_solver_protocol"],
    specialization: "Cloudflare-aware scraper",
  });
  assert.equal(child.generation, 2);
  assert.equal(child.parent, parent.id);
  assert.deepEqual(child.skills, ["http_fetch_protocol", "rate_limit_protocol", "captcha_solver_protocol"]);
  assert.equal(child.dna.specialization, "Cloudflare-aware scraper");
  assert.ok(lib.get(parent.id), "parent should still exist");
});

test("botnet library: recordTask updates stats + fitness via EMA", async () => {
  const dir = await tmpDir("botnet-lib-");
  const lib = new BotnetLibrary(dir);
  await lib.load();
  const m = await lib.create({ name: "x", kind: "generic" });
  await lib.recordTask(m.id, { success: true, latencyMs: 100 });
  await lib.recordTask(m.id, { success: true, latencyMs: 100 });
  await lib.recordTask(m.id, { success: true, latencyMs: 100 });
  const after = lib.get(m.id);
  assert.equal(after.stats.successCount, 3);
  assert.equal(after.stats.failureCount, 0);
  assert.equal(after.dna.fitness, 1.0);
});

test("botnet library: lineage returns root → children tree", async () => {
  const dir = await tmpDir("botnet-lib-");
  const lib = new BotnetLibrary(dir);
  await lib.load();
  const a = await lib.create({ name: "a", kind: "generic" });
  const b = await lib.mutate(a.id, {});
  const c = await lib.mutate(b.id, {});
  const lineage = lib.lineage();
  // Root + 2 children.
  assert.equal(lineage.length, 3);
  assert.equal(lineage[0].id, a.id);
  assert.equal(lineage[0].generation, 1);
  assert.equal(lineage[2].generation, 3);
});

test("botnet library: fitness floors at 0.05 — botnet is never fully forgotten", async () => {
  const dir = await tmpDir("botnet-lib-");
  const lib = new BotnetLibrary(dir);
  await lib.load();
  const m = await lib.create({ name: "x", kind: "generic" });
  for (let i = 0; i < 10; i++) await lib.recordTask(m.id, { success: false, latencyMs: 100 });
  assert.ok(lib.get(m.id).dna.fitness >= 0.05);
});

// ─── PromptPlanner (with stub LLM) ──────────────────────────────────

test("planner: parses system prompt into a structured plan via stub LLM", async () => {
  const { server, port } = await makeStubServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const plan = {
        id: "morph-test",
        domain: "research",
        rationale: "Tornar o organismo um assistente de pesquisa científica.",
        capabilities: ["search papers", "extract pdfs", "summarize"],
        plan: {
          steps: [
            { stepId: "step-1", kind: "forge_skill", skillKey: "arxiv_search_protocol", pythonSource: "def skill(organism, context):\n    return {'action':'SEARCH'}", rationale: "buscar papers no arxiv" },
            { stepId: "step-2", kind: "forge_skill", skillKey: "pdf_extract_protocol",  pythonSource: "def skill(organism, context):\n    return {'action':'EXTRACT'}",  rationale: "extrair texto de PDFs" },
            { stepId: "step-3", kind: "record_metamorphose", rationale: "registrar transformação" },
          ],
        },
        estimatedTime: "30s",
      };
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(plan) } }] }));
    });
  });
  try {
    const file = await tmpDir("llm-").then((d) => path.join(d, "lib.json"));
    const store = new LlmLibraryStore(file);
    await store.load();
    const cfg = await store.add({
      name: "stub",
      provider: "openai-compatible",
      category: "reasoning",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "stub",
    });
    const router = new LlmRouter(store);
    const planner = new PromptPlanner(router, "reasoning");
    const plan = await planner.plan("Se um sistema de pesquisa de papers de IA");
    assert.equal(plan.plan.domain, "research");
    assert.equal(plan.plan.plan.steps.length, 3);
    assert.equal(plan.plan.plan.steps[0].skillKey, "arxiv_search_protocol");
  } finally {
    server.close();
  }
});

// ─── MetamorphoseOrchestrator ────────────────────────────────────────

test("orchestrator: runs forge_skill steps and writes a record_metamorphose entry", async () => {
  const dir = await tmpDir("dna-");
  const forgedSkills = [];
  const orch = new MetamorphoseOrchestrator({
    forgeSkill: async ({ skillKey, pythonSource }) => {
      forgedSkills.push(skillKey);
      return { ok: true, output: `forged ${skillKey}`, path: `/fake/${skillKey}.py` };
    },
    dnaDir: dir,
    onLog: () => {},
  });
  const report = await orch.run({
    id: "morph-1",
    systemPrompt: "becoming a scraper",
    plan: {
      steps: [
        { kind: "forge_skill", skillKey: "fetch_protocol", pythonSource: "def skill(o,c): return {action:'FETCH'}" },
        { kind: "forge_skill", skillKey: "parse_protocol", pythonSource: "def skill(o,c): return {action:'PARSE'}" },
        { kind: "record_metamorphose", rationale: "scraper born" },
      ],
    },
  });
  assert.equal(report.status, "done");
  assert.deepEqual(forgedSkills, ["fetch_protocol", "parse_protocol"]);
  const log = await readMetamorphosisLog(dir);
  assert.equal(log.length, 1);
  assert.equal(log[0].systemPrompt, "becoming a scraper");
});

test("orchestrator: halts on step failure and reports which step failed", async () => {
  const dir = await tmpDir("dna-");
  const orch = new MetamorphoseOrchestrator({
    forgeSkill: async ({ skillKey }) => {
      if (skillKey === "bad_one") throw new Error("invalid python: indent error");
      return { ok: true };
    },
    dnaDir: dir,
    onLog: () => {},
  });
  const report = await orch.run({
    id: "morph-2",
    systemPrompt: "test",
    plan: {
      steps: [
        { kind: "forge_skill", skillKey: "ok_one",  pythonSource: "..." },
        { kind: "forge_skill", skillKey: "bad_one", pythonSource: "bad" },
        { kind: "forge_skill", skillKey: "unrun",   pythonSource: "..." },
      ],
    },
  });
  assert.equal(report.status, "failed");
  assert.equal(report.steps[0].status, "done");
  assert.equal(report.steps[1].status, "failed");
  assert.match(report.steps[1].error, /invalid python/);
  assert.equal(report.steps.length, 2, "halted at the failing step");
});

// ─── IntentParser (with stub LLM) ──────────────────────────────────

test("intent parser: classifies 'create a vision botnet' → forge_botnet_model", async () => {
  const { server, port } = await makeStubServer((_req, res) => {
    const intent = {
      intent: "forge_botnet_model",
      args: { name: "vision-cluster", kind: "vision" },
      reply: "Vou forjar um botnet de visão pra você.",
    };
    res.statusCode = 200;
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(intent) } }] }));
  });
  try {
    const file = await tmpDir("llm-").then((d) => path.join(d, "lib.json"));
    const store = new LlmLibraryStore(file);
    await store.load();
    await store.add({
      name: "stub",
      provider: "openai-compatible",
      category: "reasoning",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "stub",
    });
    const router = new LlmRouter(store);
    const parser = new IntentParser(router, "reasoning");
    const r = await parser.parse("create a vision botnet");
    assert.equal(r.intent, "forge_botnet_model");
    assert.equal(r.args.kind, "vision");
  } finally {
    server.close();
  }
});

test("intent parser: classifies 'just talking' → chat", async () => {
  const { server, port } = await makeStubServer((_req, res) => {
    res.statusCode = 200;
    res.end(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ intent: "chat", args: {}, reply: "Oi!" }) } }],
    }));
  });
  try {
    const file = await tmpDir("llm-").then((d) => path.join(d, "lib.json"));
    const store = new LlmLibraryStore(file);
    await store.load();
    await store.add({
      name: "stub",
      provider: "openai-compatible",
      category: "reasoning",
      endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
      apiKey: "k",
      model: "stub",
    });
    const router = new LlmRouter(store);
    const parser = new IntentParser(router, "reasoning");
    const r = await parser.parse("oi, como você tá?");
    assert.equal(r.intent, "chat");
  } finally {
    server.close();
  }
});

// ─── ActionRouter (with fake SwarmManager) ─────────────────────────

function fakeSwarmManager() {
  const nodes = [];
  return {
    nodes,
    spawnCalls: [],
    execCalls: [],
    killCalls: [],
    async spawn() {
      const id = `node-${nodes.length}-${Date.now().toString(36)}`;
      const info = { id, pid: 10000 + nodes.length, alive: true };
      nodes.push({ id, proc: { kill() {} }, info, buffer: "", pending: new Map(), requestSeq: 0 });
      this.spawnCalls.push(id);
      return info;
    },
    async execOnNode(nodeId, code, timeoutMs) {
      this.execCalls.push({ nodeId, code });
      return { nodeId, ok: true, stdout: "fake stdout", stderr: "", exitCode: 0, durationMs: 5 };
    },
    killNode(nodeId) {
      this.killCalls.push(nodeId);
      const n = nodes.find((x) => x.id === nodeId);
      if (n) n.info.alive = false;
      return true;
    },
  };
}

test("action router: forge_botnet_model creates a new model", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: fakeSwarmManager(),
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const r = await router.dispatch("forge_botnet_model", { name: "vision-cluster", kind: "vision" });
  assert.equal(r.kind, "forge_botnet_model");
  assert.equal(r.payload.model.kind, "vision");
  assert.equal(lib.list().length, 1);
});

test("action router: spawn_botnet creates N nodes via swarm manager", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const swarm = fakeSwarmManager();
  const m = await lib.create({ name: "scraper", kind: "scraping" });
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: swarm,
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const r = await router.dispatch("spawn_botnet", { modelId: m.id, count: 3 });
  assert.equal(r.kind, "spawn_botnet");
  assert.equal(r.payload.run.nodes.length, 3);
  assert.equal(swarm.spawnCalls.length, 3);
});

test("action router: broadcast_botnet runs Python on every live node", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const swarm = fakeSwarmManager();
  const m = await lib.create({ name: "x", kind: "generic" });
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: swarm,
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  await router.dispatch("spawn_botnet", { modelId: m.id, count: 2 });
  const r = await router.dispatch("broadcast_botnet", {
    modelId: m.id,
    pythonSource: "print('hello from swarm')",
  });
  assert.equal(r.kind, "broadcast_botnet");
  assert.equal(r.payload.results.length, 2);
  assert.ok(r.payload.results.every((x) => x.ok));
  assert.equal(swarm.execCalls.length, 2);
});

test("action router: kill_botnet stops all nodes of a run", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const swarm = fakeSwarmManager();
  const m = await lib.create({ name: "x", kind: "generic" });
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: swarm,
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const spawned = await router.dispatch("spawn_botnet", { modelId: m.id, count: 4 });
  const runId = spawned.payload.run.runId;
  await router.dispatch("kill_botnet", { runId });
  assert.equal(swarm.killCalls.length, 4);
  assert.equal(router.listRuns().length, 0);
});

test("action router: mutate_botnet_model creates generation 2 from parent", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: fakeSwarmManager(),
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const parent = (await router.dispatch("forge_botnet_model", { name: "g1", kind: "scraping" })).payload.model;
  const child = (await router.dispatch("mutate_botnet_model", {
    parentId: parent.id,
    specialization: "G2 with stealth",
  })).payload.model;
  assert.equal(child.generation, 2);
  assert.equal(child.parent, parent.id);
  assert.equal(child.dna.specialization, "G2 with stealth");
});

test("action router: mutate_botnet_model accepts modelName when LLM forgets parentId", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: fakeSwarmManager(),
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  await router.dispatch("forge_botnet_model", { name: "scraper", kind: "scraping" });
  const child = (await router.dispatch("mutate_botnet_model", {
    modelName: "scraper",
    specialization: "G2 stealth mode",
  })).payload.model;
  assert.equal(child.generation, 2);
  assert.equal(child.dna.specialization, "G2 stealth mode");
});

test("action router: kill_botnet with runId='all' terminates every run", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const swarm = fakeSwarmManager();
  const m = await lib.create({ name: "x", kind: "generic" });
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: swarm,
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  await router.dispatch("spawn_botnet", { modelId: m.id, count: 2 });
  await router.dispatch("spawn_botnet", { modelId: m.id, count: 3 });
  assert.equal(router.listRuns().length, 2);
  const r = await router.dispatch("kill_botnet", { runId: "all" });
  assert.equal(r.payload.killedAll, true);
  assert.equal(r.payload.runIds.length, 2);
  assert.equal(router.listRuns().length, 0);
});

test("action router: unknown intent returns kind=unknown", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: fakeSwarmManager(),
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const r = await router.dispatch("totally_bogus_intent", {});
  assert.equal(r.kind, "unknown");
});

test("action router: resolveModelId looks up by name OR uuid", async () => {
  const lib = new BotnetLibrary(await tmpDir("botnet-"));
  await lib.load();
  const router = new ActionRouter({
    llmRouter: null, botnetLibrary: lib, swarmManager: fakeSwarmManager(),
    orchestrator: null, planner: null, forgeSkill: async () => ({}), dnaDir: "",
  });
  const m = await lib.create({ name: "vision-cluster", kind: "vision" });
  assert.equal(await router.resolveModelId(m.id), m.id);
  assert.equal(await router.resolveModelId({ modelName: "vision-cluster" }), m.id);
  await assert.rejects(router.resolveModelId({ modelName: "nope" }), /not found/);
});
