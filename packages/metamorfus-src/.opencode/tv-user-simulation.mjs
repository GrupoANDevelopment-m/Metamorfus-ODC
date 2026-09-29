// TV-User Simulation — pretends to be an operator at the keyboard,
// typing natural-language messages into the chat panel and showing
// how the cortex classifies them, executes the right action, and
// responds.
//
// We run a tiny stub LLM server that classifies each user message
// into one of the supported intents and returns a short reply.
// The headless server's NL pipeline does the rest.
//
// Run with:
//   PORT=3457 ./node_modules/.bin/tsx server/headless-server.mjs &
//   ./node_modules/.bin/tsx .opencode/tv-user-simulation.mjs
//
// The script assumes the headless server is already running on the
// port given as argv[2] (default 3457). It also assumes there's an
// LLM library entry that points at the stub LLM.

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 3457);
const STUB_PORT = Number(process.argv[3] ?? 3458);
const AUTH = "Bearer dev-secret-local";

const log = (...args) => console.log(...args);
const banner = (text) => log(`\n\x1b[36m=== ${text} ===\x1b[0m`);

// ─── stub LLM ───────────────────────────────────────────────────────
const stubServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const sysMsg = parsed.messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = parsed.messages[parsed.messages.length - 1].content;
    const result = sysMsg.includes("MARKER:INTENT_CLASSIFIER")
      ? classifyIntent(userMsg)
      : makePlan(userMsg);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: "stub-1",
      model: "stub",
      choices: [{ index: 0, message: { role: "assistant", content: result } }],
      usage: { prompt_tokens: 10, completion_tokens: 200, total_tokens: 210 },
    }));
  });
});

function classifyIntent(userMsg) {
  const m = userMsg.toLowerCase();
  if (m.includes("seja um sistema") || m.includes("morph") || m.includes("transforme") || m.includes("vire um") || m.includes("vire o") || m.includes("se tornar") || m.includes("torna-se") || (m.includes("sistema") && m.includes("pesquisa"))) {
    return JSON.stringify({ intent: "metamorphose", args: { systemPrompt: userMsg }, reply: "Vou planejar a metamorfose e executar cada passo agora." });
  }
  if (m.includes("create a vision") || m.includes("crie um botnet") || m.includes("forje um botnet") || m.includes("forge_botnet_model") || (m.includes("botnet") && (m.includes("vision") || m.includes("visão")))) {
    return JSON.stringify({ intent: "forge_botnet_model", args: { name: "vision-cluster-v1", kind: "vision", specialization: "Processamento paralelo de imagens" }, reply: "Vou forjar um botnet de visão agora." });
  }
  if (m.includes("spawn") || ((m.includes("cria") || m.includes("inicia")) && m.includes("node"))) {
    return JSON.stringify({ intent: "spawn_botnet", args: { modelName: "vision-cluster-v1", count: 3 }, reply: "Spawnando 3 nodes do vision-cluster-v1..." });
  }
  if (m.includes("broadcast") || m.includes("execute") || m.includes("rode") || m.includes("roda") || m.includes("manda") || m.includes("envia") || m.includes("print")) {
    return JSON.stringify({ intent: "broadcast_botnet", args: { modelName: "vision-cluster-v1", pythonSource: "import platform, os, json\nprint(json.dumps({'node': os.uname().nodename, 'pid': os.getpid(), 'platform': platform.platform(), 'result': 2 + 2}))" }, reply: "Broadcasting Python to all vision-cluster nodes." });
  }
  if (m.includes("list") || m.includes("mostre") || (m.includes("quais") && !m.includes("status"))) {
    return JSON.stringify({ intent: "list_botnet_models", args: {}, reply: "Listando modelos de botnet..." });
  }
  if (m.includes("kill") || m.includes("mate") || m.includes("pare") || m.includes("encerra") || m.includes("para tudo")) {
    return JSON.stringify({ intent: "kill_botnet", args: { runId: "all" }, reply: "Killing all botnet runs..." });
  }
  if (m.includes("mutate") || m.includes("evolua") || m.includes("melhore") || m.includes("geração")) {
    return JSON.stringify({ intent: "mutate_botnet_model", args: { modelName: "vision-cluster-v1", specialization: "Generation 2 — agora com cache LRU e pipeline streaming" }, reply: "Mutando vision-cluster-v1 para geração 2." });
  }
  if (m.includes("status") || m.includes("saúde") || m.includes("health")) {
    return JSON.stringify({ intent: "system_status", args: {}, reply: "Checando o organismo inteiro." });
  }
  return JSON.stringify({ intent: "chat", args: {}, reply: "Recebido. Estou aqui. Me diga o que quer que o organismo faça — morfar, forjar botnets, ou rodar tarefas." });
}

function makePlan(systemPrompt) {
  // The planner sees the system prompt and returns a structured plan
  // that the orchestrator can execute.
  return JSON.stringify({
    id: `morph-${Date.now().toString(36)}`,
    domain: "research",
    rationale: "Tornar o organismo um assistente de pesquisa de papers de machine learning.",
    capabilities: ["buscar papers", "extrair PDFs", "sumarizar", "formatar citações"],
    plan: {
      steps: [
        { stepId: "step-1", kind: "forge_skill", skillKey: "arxiv_search_protocol",
          pythonSource: [
            'def skill(organism, context):',
            '    """Search arxiv for papers matching the query."""',
            '    import urllib.request, urllib.parse, json',
            '    q = context.get("query", "")',
            '    return {"action": "ARXIV_SEARCH", "intensity": 0.6, "version": 1, "params": {"query": q}}',
          ].join("\n"),
          rationale: "buscar papers no arXiv" },
        { stepId: "step-2", kind: "forge_skill", skillKey: "pdf_extract_protocol",
          pythonSource: [
            'def skill(organism, context):',
            '    """Extract text from a PDF path."""',
            '    p = context.get("path", "")',
            '    return {"action": "PDF_EXTRACT", "intensity": 0.5, "version": 1, "params": {"path": p}}',
          ].join("\n"),
          rationale: "extrair texto de PDFs" },
        { stepId: "step-3", kind: "forge_skill", skillKey: "semantic_summarize_protocol",
          pythonSource: [
            'def skill(organism, context):',
            '    """Summarize text via simple truncation."""',
            '    text = context.get("text", "")',
            '    return {"action": "SEMANTIC_SUMMARIZE", "intensity": 0.4, "version": 1, "params": {"chars": len(text)}}',
          ].join("\n"),
          rationale: "sumarizar texto extraído" },
        { stepId: "step-4", kind: "record_metamorphose", rationale: "registrar transformação" },
      ],
    },
    estimatedTime: "30s",
  });
}

await new Promise((resolve) => stubServer.listen(STUB_PORT, "127.0.0.1", resolve));
log(`[stub-llm] listening on http://127.0.0.1:${STUB_PORT}`);

// ─── seed LLM library with the stub ────────────────────────────────
async function call(path, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    headers: { "Content-Type": "application/json", Authorization: AUTH, ...(opts.headers || {}) },
    ...opts,
  });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, body };
}

const seeded = await call("/api/llm-library", {
  method: "POST",
  body: JSON.stringify({
    name: "Stub LLM (simulation)",
    provider: "openai-compatible",
    category: "reasoning",
    endpoint: `http://127.0.0.1:${STUB_PORT}/v1/chat/completions`,
    apiKey: "stub",
    model: "stub",
    priority: 10,
  }),
});
log(`[seed] stub LLM library entry:`, seeded.ok ? "ok" : seeded.body?.error);

// Also a text entry pointing at the same stub (the chat intent path).
await call("/api/llm-library", {
  method: "POST",
  body: JSON.stringify({
    name: "Stub LLM text",
    provider: "openai-compatible",
    category: "text",
    endpoint: `http://127.0.0.1:${STUB_PORT}/v1/chat/completions`,
    apiKey: "stub",
    model: "stub",
    priority: 10,
  }),
});

// ─── the user simulation ───────────────────────────────────────────
async function userSay(message) {
  log(`\n\x1b[33m  tu>\x1b[0m ${message}`);
  const r = await call("/api/nl/dispatch", {
    method: "POST",
    body: JSON.stringify({ message, history: [] }),
  });
  if (!r.ok) {
    log(`\x1b[31m  cortex>\x1b[0m HTTP ${r.status}: ${r.body?.error}`);
    return;
  }
  const { intent, action, actionError } = r.body;
  log(`  [intent=${intent.intent} | model=${intent.model}]`);
  if (intent.reply) log(`\x1b[36m  cortex>\x1b[0m ${intent.reply}`);
  if (actionError) {
    log(`\x1b[31m  [action error] ${actionError}\x1b[0m`);
  } else if (action) {
    const summary = summarizeAction(action);
    log(`\x1b[32m  [action=${action.kind}]\x1b[0m ${summary}`);
  }
}

function summarizeAction(action) {
  switch (action.kind) {
    case "metamorphose": {
      const plan = action.payload.plan;
      const report = action.payload.report;
      // payload.plan is the planner result; payload.plan.plan is the LLM
      // response with plan.steps nested.
      const llmResponse = plan?.plan ?? {};
      const stepCount = llmResponse?.plan?.steps?.length ?? 0;
      const doneCount = report?.steps?.filter((s) => s.status === "done").length ?? 0;
      const domain = llmResponse?.domain ?? "?";
      const forged = report?.steps?.filter((s) => s.kind === "forge_skill" && s.status === "done").length ?? 0;
      return `domain=${domain} · ${doneCount}/${stepCount} steps done · ${forged} skill(s) forged · status=${report?.status}`;
    }
    case "forge_botnet_model":
      return `model=${action.payload.model.name} (${action.payload.model.id.slice(0,8)}) · kind=${action.payload.model.kind} · gen=${action.payload.model.generation}`;
    case "spawn_botnet": {
      const alive = action.payload.run.nodes.filter((n) => n.alive).length;
      return `runId=${action.payload.run.runId} · ${alive}/${action.payload.run.nodes.length} alive`;
    }
    case "broadcast_botnet":
      return `${action.payload.results.length} results · ok=${action.payload.results.filter((r) => r.ok).length}`;
    case "kill_botnet":
      return action.payload.killedAll
        ? `killed ${action.payload.runIds.length} run(s)`
        : `killed runId=${action.payload.runId}`;
    case "list_botnet_models":
      return `${action.payload.models.length} models`;
    case "list_botnet_runs":
      return `${action.payload.runs.length} live runs`;
    case "mutate_botnet_model":
      return `parent gen ${action.payload.model.generation - 1} → child gen ${action.payload.model.generation}`;
    case "system_status":
      return `models=${action.payload.models} · runs=${action.payload.runs} · liveNodes=${action.payload.liveNodes}`;
    default:
      return JSON.stringify(action.payload).slice(0, 120);
  }
}

banner("USER SIMULATION — talking to the organism via chat");

await userSay("oi, tô aqui. me dá um status");
await userSay("morph — vire um sistema de pesquisa de papers de IA");
await userSay("crie um botnet de visão");
await userSay("agora spawna 3 nodes dele");
await userSay("roda esse python nos nodes: print(2+2)");
await userSay("evolua esse botnet pra geração 2");
await userSay("liste todos os modelos");
await userSay("mate todos os runs");
await userSay("valeu, beleza");

banner("STATE AFTER SIMULATION");

const models = await call("/api/botnet/models");
const runs = await call("/api/botnet/runs");
log(`models: ${models.body.models.length}`);
for (const m of models.body.models) {
  log(`  · ${m.name} (${m.kind}) gen=${m.generation} fitness=${m.dna.fitness.toFixed(2)} stats=${JSON.stringify(m.stats)}`);
}
log(`runs: ${runs.body.runs.length}`);

const history = await call("/api/metamorphose/history");
log(`metamorphoses: ${history.body.history.length}`);
for (const h of history.body.history) {
  log(`  · ${h.ts} → ${h.systemPrompt?.slice(0, 60)}`);
}

stubServer.close();
process.exit(0);
