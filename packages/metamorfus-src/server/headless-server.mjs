// Headless server — runs the Metamorfus ODC API surface WITHOUT Vite
// or a browser. Useful for integration tests, CLI usage, and headless
// deployment.
//
// Mounts the SAME Express routes as server.ts (chat, vision, tools,
// admin) but skips the React dev server and the static SPA bundle.
//
// This file does NOT modify server.ts. It imports the same modules
// (mhu_engine, vision-tool, odc-opencode-bridge) and wires them up
// independently.
//
// Usage:
//   node server/headless-server.mjs
//   PORT=8080 node server/headless-server.mjs
//
// Or programmatically:
//   import { startHeadlessServer } from "./headless-server.mjs";
//   const ctx = await startHeadlessServer({ port: 0 });
//   // ... fetch http://localhost:<ctx.port>/api/chat ...
//   await ctx.close();

import express from "express";
import cors from "cors";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Pull the same TypeScript modules the real server uses. We re-export
// the runtime instances we need.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const require = createRequire(import.meta.url);

/**
 * @typedef {Object} HeadlessServerContext
 * @property {number} port            Port the server is listening on
 * @property {() => Promise<void>} close   Tear-down function
 */

/**
 * @param {{port?: number|undefined, mhuEngine?: any, opencodeComplete?: any, opencodePing?: any, describeImage?: any, FALLBACK_TOOLS?: any, executeBridgeTool?: any}} [opts]
 * @returns {Promise<HeadlessServerContext>}
 */
export async function startHeadlessServer(opts = {}) {
  // Lazy-import the .ts modules via tsx loader if available.
  // The caller may pass already-instantiated deps to keep this file
  // framework-agnostic.
  const describeImage = opts.describeImage ?? (await loadDefault("describeImage", "./vision-tool.js"));
  const VISION_SKILL_KEY = opts.VISION_SKILL_KEY ?? "vision_describe_protocol";
  const opencodeComplete = opts.opencodeComplete ?? (await loadDefault("complete", "./odc-opencode-bridge.js"));
  const opencodePing = opts.opencodePing ?? (await loadDefault("ping", "./odc-opencode-bridge.js"));
  const executeBridgeTool = opts.executeBridgeTool ?? (await loadDefault("executeBridgeTool", "./odc-opencode-bridge.js"));
  const FALLBACK_TOOLS = opts.FALLBACK_TOOLS ?? (await loadDefault("FALLBACK_TOOLS", "./odc-opencode-bridge.js"));
  const MHU_5_ProtoODC = opts.MHU_5_ProtoODC ?? (await loadDefault("MHU_5_ProtoODC", "../mhu_engine.js"));
  const mhuEngine = opts.mhuEngine ?? new MHU_5_ProtoODC();
  // LLM API Library — operator's catalog of LLM providers, with
  // category-based auto-failover (text / reasoning / multimodal).
  const llmStore = opts.llmStore ?? new (await import("./llm-library/index.mjs")).LlmLibraryStore(
    path.resolve(opts.workspaceRoot ?? process.cwd(), "data/llm-library.json"),
  );
  await llmStore.load();
  const llmRouter = opts.llmRouter ?? new (await import("./llm-library/index.mjs")).LlmRouter(llmStore);
  // Optional periodic health sweep. Pings every enabled config, marks
  // any that 5xx/timeout as degraded so the next request skips them.
  const healthSweepTimer = setInterval(async () => {
    for (const c of llmStore.list({ enabledOnly: true })) {
      try { await llmRouter.ping(c); } catch { /* ignore */ }
    }
  }, 5 * 60 * 1000);
  healthSweepTimer.unref?.();
  // Auth + sync modules (pure JS).
  const { tenantAuth, reloadTenants, listTenants, getTenant } = await import("./auth/tenant-auth.mjs");
  const { pushDna, pullDna } = await import("./sync/dna-git-sync.mjs");
  // Botnet library + swarm manager (specialized botnet models + lifecycle).
  const { SwarmManager } = await import("./swarm/swarm-manager.mjs");
  const { BotnetLibrary } = await import("./botnet/library.mjs");
  const botnetLibrary = opts.botnetLibrary ?? new BotnetLibrary(
    path.resolve(opts.workspaceRoot ?? process.cwd(), "data/botnets"),
  );
  await botnetLibrary.load();
  const swarmManager = opts.swarmManager ?? new SwarmManager({
    count: 0,
    nodeScript: path.resolve(__dirname, "swarm/swarm-node.mjs"),
    defaultTimeoutMs: 30_000,
  });
  // Metamorphose orchestrator + planner (system prompt → plan → execute).
  const { MetamorphoseOrchestrator } = await import("./metamorfose/orchestrator.mjs");
  const { PromptPlanner } = await import("./metamorfose/prompt-planner.mjs");
  const orchestrator = new MetamorphoseOrchestrator({
    forgeSkill: async ({ skillKey, pythonSource }) =>
      executeBridgeTool("forge_skill", { skillKey, pythonSource }),
    dnaDir: path.resolve(opts.workspaceRoot ?? process.cwd(), "packages/metamorfus-src/dna_library"),
    pythonBin: process.env.PYTHON_BIN ?? "python3",
    onLog: (line) => console.log(line),
  });
  const planner = new PromptPlanner(llmRouter, "reasoning");
  // NL intent parser + action router — turns chat messages into real actions.
  const { IntentParser } = await import("./nl/intent.mjs");
  const { ActionRouter } = await import("./nl/router.mjs");
  const { invokeSkill } = await import("./skills/invoker.mjs");
  const { probeEnvironment } = await import("./skills/probe.mjs");
  const { BUILTIN_SKILLS, listSkills, getSkill, probeSkill } = await import("./skills/builtin-registry.mjs");
  const intentParser = new IntentParser(llmRouter, "reasoning");
  // Resolve the DNA library directory. The default lives at
  // packages/metamorfus-src/dna_library relative to the workspace
  // root (one level up from this file). Operators can override
  // via opts.dnaDir.
  const DNA_DIR = opts.dnaDir ?? path.resolve(__dirname, "../dna_library");
  const actionRouter = new ActionRouter({
    llmRouter,
    botnetLibrary,
    swarmManager,
    orchestrator,
    planner,
    forgeSkill: async ({ skillKey, pythonSource }) =>
      executeBridgeTool("forge_skill", { skillKey, pythonSource }),
    dnaDir: DNA_DIR,
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Public health check (no auth).
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", server: "headless", ts: new Date().toISOString() });
  });

  // Serve the operator's dashboard as static files BEFORE auth so
  // the browser can load the UI without sending a bearer token.
  // The dashboard itself sends the bearer token on /api/* fetches.
  const PUBLIC_DIR = path.resolve(__dirname, "../public");
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    express.static(PUBLIC_DIR)(req, res, (err) => {
      if (err) return next(err);
      // If static didn't end the request (file not found), fall
      // through to auth so /api/* keeps working.
      next();
    });
  });

  // Multi-tenant auth. Each request carries a bearer token; we attach
  // `req.tenant` so handlers can scope work to the right DNA library.
  // The auth module loads the tenant registry from TENANTS_JSON env
  // or tenants.json in the workspace root.
  await reloadTenants({ workspaceRoot: opts.workspaceRoot });
  app.use(tenantAuth());

  // ─── /api/admin/system_status ────────────────────────────────────
  // Cost control — track token usage across all chat completions in
  // this process. Same behavior as the original server.ts: when the
  // running total exceeds MAX_TOKENS_PER_SESSION, the kill-switch
  // engages and /api/chat starts returning 403.
  const MAX_TOKENS_PER_SESSION = Number(process.env.MAX_TOKENS_PER_SESSION ?? 500_000);
  let totalTokensUsed = 0;
  let killSwitchEngaged = false;
  app.get("/api/admin/system_status", async (_req, res) => {
    const reachable = await opencodePing();
    res.json({
      backend: "opencode",
      reachable,
      url: process.env.OPENCODE_URL ?? "http://localhost:4096",
      agent: process.env.OPENCODE_AGENT ?? "cortex",
      totalTokensUsed,
      maxTokens: MAX_TOKENS_PER_SESSION,
      killSwitchEngaged,
    });
  });

  // ─── /api/admin/reset ────────────────────────────────────────────
  app.post("/api/admin/reset", (_req, res) => {
    totalTokensUsed = 0;
    killSwitchEngaged = false;
    res.json({ status: "Reset requested", totalTokensUsed, killSwitchEngaged });
  });

  // ─── /api/vision ─────────────────────────────────────────────────
  // Vision uses the LLM Library's multimodal category — the router
  // picks a model that can handle images (NVIDIA kimi-k3 by default).
  // Falls back to the legacy describeImage helper for the in-process
  // tool path when no multimodal library entry is configured.
  app.post("/api/vision", async (req, res) => {
    try {
      const { imageUrl, prompt, model, maxTokens } = req.body ?? {};
      if (typeof imageUrl !== "string" || imageUrl.length === 0) {
        return res.status(400).json({ skill: VISION_SKILL_KEY, error: "imageUrl is required" });
      }
      if (llmRouter.availableCount("multimodal") > 0) {
        // Build a multimodal message — download the image, embed as
        // base64. Most OpenAI-compatible multimodal endpoints accept
        // either { type: "image_url", image_url: { url } } or a
        // data: URL. We use the URL form so we don't have to download
        // large assets in the server.
        const visionMessages = [
          ...(typeof prompt === "string" && prompt.length > 0
            ? [{ role: "system", content: "You are the vision cortex of the Metamorfos ODC organism." }]
            : []),
          {
            role: "user",
            content: [
              { type: "text", text: prompt ?? "Describe this image." },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ];
        const result = await llmRouter.complete("multimodal", {
          messages: visionMessages,
          ...(typeof model === "string" ? { model } : {}),
          ...(typeof maxTokens === "number" ? { maxTokens } : {}),
          temperature: 0.4,
        });
        return res.json({
          skill: VISION_SKILL_KEY,
          description: result.content,
          reasoning: result.reasoning,
          model: result.model,
          usage: {
            promptTokens: result.usage.promptTokens,
            completionTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          },
          routing: { category: "multimodal", usedConfig: result.usedConfig, attempts: result.attempts ?? [] },
        });
      }
      // Fallback: legacy in-process vision tool.
      const r = await describeImage({
        imageUrl,
        ...(typeof prompt === "string" ? { prompt } : {}),
        ...(typeof model === "string" ? { model } : {}),
        ...(typeof maxTokens === "number" ? { maxTokens } : {}),
      });
      return res.json({ skill: VISION_SKILL_KEY, ...r });
    } catch (e) {
      return res.status(502).json({ skill: VISION_SKILL_KEY, error: e?.message ?? "vision error", attempts: e.attempts });
    }
  });

  // ─── /api/tools and /api/tools/:name ──────────────────────────────
  app.get("/api/tools", (_req, res) => {
    res.json({ tools: FALLBACK_TOOLS });
  });
  app.post("/api/tools/:name", async (req, res) => {
    const { name } = req.params;
    try {
      const r = await executeBridgeTool(name, req.body ?? {});
      return res.json({ name, ...r });
    } catch (e) {
      return res.status(400).json({ name, error: e?.message ?? "tool error" });
    }
  });

  // ─── /api/chat — with MHU pipeline + real LLM (OpenCode or LLM Library router) ─
  app.post("/api/chat", async (req, res) => {
    try {
      // Kill-switch check (same behavior as the original server.ts).
      // If cumulative token usage has exceeded the session budget, the
      // chat endpoint returns 403 instead of consuming more.
      if (killSwitchEngaged) {
        return res.status(403).json({ error: "Kill-Switch Engaged: Token limit exceeded to prevent runaway costs." });
      }

      // Pick a category for routing. Operators can request a
      // reasoning model explicitly; otherwise default to "text".
      const requestedCategory = typeof req.body?.category === "string" ? req.body.category : "text";
      const category = ["text", "reasoning", "multimodal"].includes(requestedCategory) ? requestedCategory : "text";

      let messages = req.body?.messages ?? [];
      const reqModel = typeof req.body?.model === "string" ? req.body.model : undefined;

      // MHU preprocessor — same pipeline as the real server. The
      // injection is a system-prompt prepend; the LLM still sees the
      // full conversation and decides how to use the cognitive
      // analysis. We do NOT hardcode the organism's voice — that's
      // whatever the LLM chooses to say.
      if (Array.isArray(messages) && messages.length > 0) {
        const last = messages[messages.length - 1];
        if (last && last.role === "user") {
          try {
            const mhu = mhuEngine.execute_pipeline(last.content);
            const ctx = `[MHU 5.0 COGNITIVE ORCHESTRATION]
- Causal Analysis: ${JSON.stringify(mhu.causal_analysis)}
- Universal Laws Applied: ${mhu.universal_laws.join(", ")}
- Strategic Plan: ${JSON.stringify(mhu.strategic_plan)}
- Recommendations: ${mhu.recommendations.join(", ")}
- Counterfactuals: ${JSON.stringify(mhu.counterfactuals)}`;
            messages = [
              {
                role: "system",
                content: "You are enhanced by the MHU 5.0 Cognitive Framework. Integrate the following analysis into your thinking:\n" + ctx,
              },
              ...messages,
            ];
          } catch (e) {
            console.error("MHU error:", e?.message ?? e);
          }
        }
      }

      let result;
      let useOpencode = false;
      // Prefer OpenCode sidecar when reachable AND we have a text
      // request (OpenCode handles cortex/executor/forge multi-agent).
      // For explicit category requests we go straight to the LLM
      // Library router so the operator's category selection wins.
      if (category === "text" && (await opencodePing())) {
        try {
          result = await opencodeComplete({
            messages,
            ...(reqModel ? { model: reqModel } : {}),
            temperature: typeof req.body?.temperature === "number" ? req.body.temperature : 0.7,
            maxTokens: typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4096,
          });
          useOpencode = true;
        } catch {
          // OpenCode failed — fall through to LLM Library router.
          result = undefined;
        }
      }
      if (!result) {
        try {
          result = await llmRouter.complete(category, {
            messages,
            ...(reqModel ? { model: reqModel } : {}),
            temperature: typeof req.body?.temperature === "number" ? req.body.temperature : 0.7,
            maxTokens: typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4096,
          });
        } catch (llmErr) {
          // The LLM Library router already returns the structured
          // 401 from the upstream provider. Surface it as the chat
          // response so the operator sees which provider rejected
          // the key — same short-circuit as the original server.ts
          // (don't keep trying providers after an auth error).
          const attempts = llmErr?.attempts ?? [];
          const firstAuthFail = attempts.find((a) => a?.httpStatus === 401);
          if (firstAuthFail) {
            return res.status(401).json({
              error: "LLM provider auth failed",
              provider: firstAuthFail.provider,
              model: firstAuthFail.model,
              configId: firstAuthFail.configId,
            });
          }
          throw llmErr;
        }
      }

      // Token accounting — same as server.ts original. Engages the
      // kill-switch if cumulative usage exceeds the session budget.
      const tok = result?.usage?.totalTokens ?? 0;
      if (tok > 0) {
        totalTokensUsed += tok;
        if (totalTokensUsed > MAX_TOKENS_PER_SESSION) {
          killSwitchEngaged = true;
          console.warn(`[cost-control] kill-switch engaged at ${totalTokensUsed} tokens`);
        }
      }

      return res.json({
        choices: [
          { message: { role: "assistant", content: result.content }, finish_reason: "stop", index: 0 },
        ],
        model: result.model,
        provider: result.provider,
        session_id: result.sessionId,
        usage: {
          prompt_tokens: result.usage.promptTokens,
          completion_tokens: result.usage.completionTokens,
          total_tokens: result.usage.totalTokens,
        },
        routing: {
          backend: useOpencode ? "opencode" : "llm-library",
          category,
          usedConfig: result.usedConfig,
          failoverFrom: result.failoverFrom ?? null,
          attempts: result.attempts ?? [],
        },
      });
    } catch (e) {
      const msg = e?.message ?? "chat error";
      console.error("CHAT ERROR:", msg);
      // If upstream is rate-limited or down, propagate the right code
      // so callers (tests, real clients) can distinguish transient
      // outages from internal bugs.
      if (msg.includes("429") || msg.includes("rate")) {
        return res.status(429).json({ error: "rate limited", attempts: e.attempts });
      }
      if (msg.includes("503") || msg.includes("unavailable")) {
        return res.status(503).json({ error: "upstream unavailable", attempts: e.attempts });
      }
      return res.status(500).json({ error: msg, attempts: e.attempts });
    }
  });

  // ─── /api/health ─────────────────────────────────────────────────
  // Registered above (public, before auth middleware).

  // ─── /api/admin/tenants (list tenants; requires auth) ─────────────
  app.get("/api/admin/tenants", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const tenants = listTenants().map((t) => ({
      id: t.id,
      displayName: t.displayName,
      scopes: t.scopes,
      dnaDir: t.dnaDir,
    }));
    res.json({ tenants });
  });

  // ─── /api/admin/sync (push / pull the tenant's DNA library) ─────
  app.post("/api/admin/sync", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const action = String(req.body?.action ?? "pull");
    const remote = typeof req.body?.remote === "string" ? req.body.remote : undefined;
    const dnaDir = path.resolve(opts.workspaceRoot ?? process.cwd(), req.tenant.dnaDir);
    try {
      if (action === "push") {
        const r = await pushDna({ dnaDir, tenantId: req.tenant.id, ...(remote ? { remote } : {}) });
        return res.json(r);
      }
      if (action === "pull") {
        const r = await pullDna({ dnaDir, tenantId: req.tenant.id, ...(remote ? { remote } : {}) });
        return res.json(r);
      }
      return res.status(400).json({ error: `unknown action: ${action}` });
    } catch (e) {
      return res.status(500).json({ error: e?.message ?? "sync failed" });
    }
  });

  // ─── /api/llm-library ────────────────────────────────────────────
  // Operator's catalog of LLM providers. Used by the router for
  // category-based auto-failover. Keys never leave the server (the
  // public view masks them as `****xxxx`).
  const { PROVIDER_PRESETS } = await import("./llm-library/index.mjs");

  app.get("/api/llm-library", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const category = typeof req.query.category === "string" ? req.query.category : undefined;
    const out = llmStore.listPublic({ ...(category ? { category } : {}) });
    res.json({
      library: out,
      summary: {
        text:       { total: llmRouter.totalCount("text"),       available: llmRouter.availableCount("text") },
        reasoning:  { total: llmRouter.totalCount("reasoning"),  available: llmRouter.availableCount("reasoning") },
        multimodal: { total: llmRouter.totalCount("multimodal"), available: llmRouter.availableCount("multimodal") },
      },
      presets: PROVIDER_PRESETS,
      categories: ["text", "reasoning", "multimodal"],
    });
  });

  app.get("/api/llm-library/:id", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const c = llmStore.getPublic(req.params.id);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json({ config: c });
  });

  app.post("/api/llm-library", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const entry = await llmStore.add(req.body ?? {});
      res.json({ config: llmStore.getPublic(entry.id) });
    } catch (e) {
      res.status(400).json({ error: e.message ?? "invalid config" });
    }
  });

  app.patch("/api/llm-library/:id", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const updated = await llmStore.update(req.params.id, req.body ?? {});
      res.json({ config: llmStore.getPublic(updated.id) });
    } catch (e) {
      res.status(400).json({ error: e.message ?? "update failed" });
    }
  });

  app.delete("/api/llm-library/:id", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const removed = await llmStore.remove(req.params.id);
      res.json({ removed: llmStore.getPublic(removed.id) ?? { id: removed.id } });
    } catch (e) {
      res.status(400).json({ error: e.message ?? "delete failed" });
    }
  });

  app.post("/api/llm-library/:id/ping", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const config = llmStore.get(req.params.id);
    if (!config) return res.status(404).json({ error: "not found" });
    const result = await llmRouter.ping(config);
    res.json({ id: config.id, ...result, health: config.health });
  });

  // Manual failover — useful for tests + a "force refresh" UX.
  app.post("/api/llm-library/failover-test", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const category = typeof req.body?.category === "string" ? req.body.category : "text";
    try {
      const result = await llmRouter.complete(category, {
        messages: [{ role: "user", content: "ping" }],
        maxTokens: 4,
        temperature: 0,
      });
      res.json({
        ok: true,
        usedConfig: result.usedConfig,
        provider: result.provider,
        model: result.model,
        attempts: result.attempts ?? [],
      });
    } catch (e) {
      res.status(503).json({ ok: false, error: e.message, attempts: e.attempts });
    }
  });

  // ─── /api/metamorphose — execute a metamorphosis plan ─────────────
  // Takes a free-form system prompt, asks the cortex to plan, and
  // then EXECUTES the plan (forge_skill, pip_install, git_clone,
  // record_metamorphose). Each step's result is in the response.
  app.post("/api/metamorphose", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const systemPrompt = typeof req.body?.systemPrompt === "string" ? req.body.systemPrompt : "";
    if (systemPrompt.length === 0) {
      return res.status(400).json({ error: "systemPrompt is required" });
    }
    try {
      const planResult = await planner.plan(systemPrompt);
      const innerPlan = planResult.plan?.plan ?? planResult.plan;
      const report = await orchestrator.run({
        id: planResult.id,
        systemPrompt,
        plan: innerPlan,
      });
      res.json({ plan: planResult, report });
    } catch (e) {
      res.status(500).json({ error: e?.message ?? "metamorphose failed" });
    }
  });

  // ─── /api/metamorphose/plan — plan only, don't execute ───────────
  // The dashboard's "Profession" panel calls this to preview what
  // the cortex would do before committing.
  app.post("/api/metamorphose/plan", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const systemPrompt = typeof req.body?.systemPrompt === "string" ? req.body.systemPrompt : "";
    if (systemPrompt.length === 0) return res.status(400).json({ error: "systemPrompt is required" });
    try {
      const plan = await planner.plan(systemPrompt);
      res.json(plan);
    } catch (e) {
      res.status(500).json({ error: e?.message ?? "plan failed" });
    }
  });

  // ─── /api/metamorphose/history — read the log of past morphoses ──
  app.get("/api/metamorphose/history", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const { readMetamorphosisLog } = await import("./metamorfose/orchestrator.mjs");
    const dnaDir = path.resolve(opts.workspaceRoot ?? process.cwd(), "packages/metamorfus-src/dna_library");
    const log = await readMetamorphosisLog(dnaDir);
    res.json({ history: log });
  });

  // ─── /api/botnet/* — specialized botnet catalog + lifecycle ──────
  app.get("/api/botnet/models", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    res.json({ models: botnetLibrary.list(...(kind ? [{ kind }] : [])) });
  });

  app.post("/api/botnet/models", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const model = await botnetLibrary.create(req.body ?? {});
      res.json({ model });
    } catch (e) {
      res.status(400).json({ error: e?.message ?? "invalid model" });
    }
  });

  app.get("/api/botnet/models/:id", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const m = botnetLibrary.get(req.params.id);
    if (!m) return res.status(404).json({ error: "not found" });
    res.json({ model: m });
  });

  app.patch("/api/botnet/models/:id", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const child = await botnetLibrary.mutate(req.params.id, req.body ?? {});
      res.json({ model: child });
    } catch (e) {
      res.status(400).json({ error: e?.message ?? "mutate failed" });
    }
  });

  app.delete("/api/botnet/models/:id", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      await botnetLibrary.remove(req.params.id);
      res.json({ removed: req.params.id });
    } catch (e) {
      res.status(400).json({ error: e?.message ?? "delete failed" });
    }
  });

  app.get("/api/botnet/lineage", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    res.json({ lineage: botnetLibrary.lineage() });
  });

  // ─── /api/botnet/runs — live botnet instances ────────────────────
  app.get("/api/botnet/runs", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    res.json({ runs: actionRouter.listRuns() });
  });

  app.post("/api/botnet/runs", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const result = await actionRouter.dispatch("spawn_botnet", req.body ?? {});
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: e?.message ?? "spawn failed" });
    }
  });

  app.delete("/api/botnet/runs/:runId", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    try {
      const r = await actionRouter.dispatch("kill_botnet", { runId: req.params.runId });
      res.json(r);
    } catch (e) {
      res.status(400).json({ error: e?.message ?? "kill failed" });
    }
  });

  // ─── /api/swarm/* — direct swarm access (used by botnet runs) ────
  app.get("/api/swarm/status", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    res.json({
      live: swarmManager.list().map((n) => ({
        id: n.id, pid: n.info?.pid, alive: n.info?.alive, startedAt: n.info?.startedAt,
      })),
      totalSpawned: swarmManager.totalSpawned?.() ?? swarmManager.nodes?.length ?? 0,
    });
  });

  // ─── /api/nl/parse — direct intent parsing (used by tests + UI) ──
  app.post("/api/nl/parse", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    try {
      const r = await intentParser.parse(message, history);
      res.json(r);
    } catch (e) {
      res.status(500).json({ error: e?.message ?? "parse failed" });
    }
  });

  // ─── /api/nl/dispatch — parse AND execute (the full chat loop) ──
  app.post("/api/nl/dispatch", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const message = typeof req.body?.message === "string" ? req.body.message : "";
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!message) return res.status(400).json({ error: "message is required" });
    try {
      const intent = await intentParser.parse(message, history);
      let action = null;
      let actionError = null;
      if (intent.intent !== "chat") {
        try {
          action = await actionRouter.dispatch(intent.intent, intent.args);
        } catch (e) {
          actionError = e?.message ?? String(e);
        }
      }
      res.json({ intent, action, actionError });
    } catch (e) {
      res.status(500).json({ error: e?.message ?? "dispatch failed" });
    }
  });

  // ─── /api/skills/* — list and invoke real skills in the DNA library ─
  app.get("/api/skills", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    fs.readdir(DNA_DIR).then((files) => {
      const skills = files.filter((f) => f.endsWith("_protocol.py")).map((f) => f.replace(/\.py$/, ""));
      res.json({ skills });
    }).catch((e) => res.status(500).json({ error: e.message }));
  });

  app.post("/api/skills/:name/invoke", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const context = req.body?.context ?? req.body ?? {};
    try {
      const r = await invokeSkill({
        skillKey: req.params.name,
        context,
        dnaDir: DNA_DIR,
        pythonBin: process.env.PYTHON_BIN ?? "python3",
      });
      res.json(r);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ─── /api/skills/builtin — registry of pre-installed skill packages ─
  // Lists every builtin skill with availability probe results. The
  // skill adapters live in dna_library/builtin_*_protocol.py so they
  // share the same invoke pipeline as forged skills.
  app.get("/api/skills/builtin", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const skills = listSkills();
    res.json({ skills });
  });

  app.get("/api/skills/builtin/:id", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const skill = getSkill(req.params.id);
    if (!skill) return res.status(404).json({ error: "unknown builtin skill" });
    res.json({ skill: { ...skill, available: probeSkill(skill) } });
  });

  // Convenience: list which builtin skills are wired and which are
  // awaiting their underlying tool to be installed.
  app.get("/api/skills/builtin-summary", (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const skills = listSkills();
    const installed = skills.filter((s) => s.available).map((s) => s.id);
    const missing = skills.filter((s) => !s.available).map((s) => ({ id: s.id, installHint: s.installHint }));
    res.json({ total: skills.length, installed, missing });
  });

  // ─── /api/environment/probe — what tools does the organism have? ─
  // Self-expansion: the organism queries its own environment to find
  // out which Python packages and CLI tools are available. The
  // planner uses this to decide what to install during morph.
  app.get("/api/environment/probe", async (req, res) => {
    if (!req.tenant) return res.status(401).json({ error: "auth required" });
    const env = await probeEnvironment();
    res.json({ environment: env });
  });

  const origClose = async () => {
    clearInterval(healthSweepTimer);
    try { await swarmManager.shutdown?.(); } catch { /* */ }
    await new Promise((resolve) => server.close(() => resolve()));
  };

  const port = opts.port ?? Number(process.env.PORT ?? 3000);
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;

  return {
    port: actualPort,
    server,
    llmStore,
    llmRouter,
    botnetLibrary,
    swarmManager,
    actionRouter,
    orchestrator,
    planner,
    intentParser,
    close: origClose,
  };
}

/**
 * Helper: lazy-load a named export from a TS module via tsx-aware
 * dynamic import. Tries the path as-given, then swaps .js → .ts if
 * the .js sibling doesn't exist (this codebase ships .ts only).
 */
async function loadDefault(name, relPath) {
  const baseAbs = path.resolve(__dirname, relPath);
  const candidates = [baseAbs];
  // If caller passed .js and there's no .js file, try .ts
  if (baseAbs.endsWith(".js") && !existsSync(baseAbs)) {
    candidates.push(baseAbs.slice(0, -3) + ".ts");
  }
  let lastErr;
  for (const abs of candidates) {
    try {
      const url = pathToFileURL(abs);
      const mod = await import(url);
      if (name in mod) return mod[name];
      // The module loaded but doesn't export `name` — keep the result.
      return mod[name];
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`Failed to load ${name} from ${baseAbs}: ${lastErr?.message ?? lastErr}`);
}

function existsSync(p) {
  try {
    return require("node:fs").existsSync(p);
  } catch {
    return false;
  }
}

function pathToFileURL(p) {
  const url = new URL("file://" + (p.startsWith("/") ? p : "/" + p));
  return url.href;
}

// ─── CLI entry ──────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  startHeadlessServer().then((ctx) => {
    console.log(`Headless server on http://localhost:${ctx.port}`);
    console.log("  GET  /api/health");
    console.log("  GET  /api/admin/system_status");
    console.log("  POST /api/chat");
    console.log("  POST /api/vision");
    console.log("  GET  /api/tools");
    console.log("  POST /api/tools/:name");
    console.log("  GET  /api/llm-library          list operator's LLM configs");
    console.log("  POST /api/llm-library          add a new config");
    console.log("  PATCH /api/llm-library/:id     update a config");
    console.log("  DELETE /api/llm-library/:id    remove a config");
    console.log("  POST /api/llm-library/:id/ping test connectivity");
    console.log("  POST /api/llm-library/failover-test  exercise the failover router");
  });
}
