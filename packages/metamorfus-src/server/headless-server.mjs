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
  // Direct NVIDIA NIM adapter. Always available when NVIDIA_API_KEY
  // is set in env. Used as the fallback LLM backend when OpenCode
  // sidecar isn't reachable.
  const { nvidiaComplete, nvidiaAvailable, PROVIDER_NAME } = await import("./nvidia-direct.mjs");

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // ─── /api/admin/system_status ────────────────────────────────────
  app.get("/api/admin/system_status", async (_req, res) => {
    const reachable = await opencodePing();
    res.json({
      backend: "opencode",
      reachable,
      url: process.env.OPENCODE_URL ?? "http://localhost:4096",
      agent: process.env.OPENCODE_AGENT ?? "cortex",
      killSwitchEngaged: false,
    });
  });

  // ─── /api/admin/reset ────────────────────────────────────────────
  app.post("/api/admin/reset", (_req, res) => {
    res.json({ status: "Reset requested" });
  });

  // ─── /api/vision ─────────────────────────────────────────────────
  app.post("/api/vision", async (req, res) => {
    try {
      const { imageUrl, prompt, model, maxTokens } = req.body ?? {};
      if (typeof imageUrl !== "string" || imageUrl.length === 0) {
        return res.status(400).json({ skill: VISION_SKILL_KEY, error: "imageUrl is required" });
      }
      const r = await describeImage({
        imageUrl,
        ...(typeof prompt === "string" ? { prompt } : {}),
        ...(typeof model === "string" ? { model } : {}),
        ...(typeof maxTokens === "number" ? { maxTokens } : {}),
      });
      return res.json({ skill: VISION_SKILL_KEY, ...r });
    } catch (e) {
      return res.status(502).json({ skill: VISION_SKILL_KEY, error: e?.message ?? "vision error" });
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

  // ─── /api/chat — with MHU pipeline + real LLM (OpenCode or NVIDIA) ─
  app.post("/api/chat", async (req, res) => {
    try {
      // Pick a backend. Prefer OpenCode sidecar when reachable; fall
      // back to NVIDIA NIM direct. Both are real LLM backends — no
      // mocks, no fake responses.
      const ocReachable = await opencodePing();
      let useNvidia = !ocReachable;
      if (useNvidia && !nvidiaAvailable()) {
        return res.status(503).json({
          error:
            "No LLM backend reachable. Either start OpenCode " +
            "(`opencode serve`, default :4096) and set OPENCODE_URL, " +
            "or set NVIDIA_API_KEY for the direct NVIDIA NIM backend.",
        });
      }

      let messages = req.body?.messages ?? [];
      const reqModel = typeof req.body?.model === "string" ? req.body.model : undefined;

      // MHU preprocessor — same pipeline as the real server.
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

      const result = useNvidia
        ? await nvidiaComplete({
            messages,
            ...(reqModel ? { model: reqModel } : {}),
            temperature: typeof req.body?.temperature === "number" ? req.body.temperature : 0.7,
            maxTokens: typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4096,
          })
        : await opencodeComplete({
        messages,
        ...(reqModel ? { model: reqModel } : {}),
        temperature: typeof req.body?.temperature === "number" ? req.body.temperature : 0.7,
        maxTokens: typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4096,
      });

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
      });
    } catch (e) {
      const msg = e?.message ?? "chat error";
      console.error("CHAT ERROR:", msg);
      // If upstream is rate-limited or down, propagate the right code
      // so callers (tests, real clients) can distinguish transient
      // outages from internal bugs.
      if (msg.includes("429") || msg.includes("rate")) {
        return res.status(429).json({ error: "rate limited" });
      }
      if (msg.includes("503") || msg.includes("unavailable")) {
        return res.status(503).json({ error: "upstream unavailable" });
      }
      return res.status(500).json({ error: msg });
    }
  });

  // ─── /api/health ─────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", server: "headless", ts: new Date().toISOString() });
  });

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
    close: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
    },
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
  });
}
