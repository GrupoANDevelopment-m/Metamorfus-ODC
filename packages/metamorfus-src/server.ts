import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { MHU_5_ProtoODC } from "./mhu_engine.js";
import {
  complete as opencodeComplete,
  ping as opencodePing,
  executeBridgeTool,
  FALLBACK_TOOLS,
} from "./server/odc-opencode-bridge.js";
import { describeImage, VISION_SKILL_KEY } from "./server/vision-tool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mhuEngine = new MHU_5_ProtoODC();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Admin route: report OpenCode reachability + last usage.
  // (Cost control / kill-switch is delegated to the OpenCode sidecar.)
  app.get("/api/admin/system_status", async (_req, res) => {
    const reachable = await opencodePing();
    res.json({
      backend: "opencode",
      reachable,
      url: process.env.OPENCODE_URL ?? "http://localhost:4096",
      agent: process.env.OPENCODE_AGENT ?? "cortex",
      killSwitchEngaged: false, // delegated to OpenCode
    });
  });

  // Admin route: best-effort reset. With OpenCode, this just clears the
  // in-process MHU engine (the OpenCode sidecar has its own session/state).
  app.post("/api/admin/reset", (_req, res) => {
    res.json({ status: "Reset requested", note: "OpenCode sessions are managed by the sidecar." });
  });

  // -------------------------------------------------------------------------
  // Vision skill: organism's `vision_describe_protocol`.
  // POST /api/vision { imageUrl, prompt? } -> { description, reasoning, ... }
  // This is the HTTP surface for the vision capability. The Cortex agent can
  // also call it indirectly via OpenCode tools (see Option B).
  // -------------------------------------------------------------------------
  app.post("/api/vision", async (req, res) => {
    try {
      const { imageUrl, prompt, model, maxTokens } = req.body ?? {};
      if (typeof imageUrl !== "string" || imageUrl.length === 0) {
        return res.status(400).json({
          skill: VISION_SKILL_KEY,
          error: "imageUrl is required",
        });
      }
      const result = await describeImage({
        imageUrl,
        ...(typeof prompt === "string" ? { prompt } : {}),
        ...(typeof model === "string" ? { model } : {}),
        ...(typeof maxTokens === "number" ? { maxTokens } : {}),
      });
      return res.json({
        skill: VISION_SKILL_KEY,
        ...result,
      });
    } catch (e: any) {
      console.error("VISION ERROR:", e?.message ?? e);
      return res.status(502).json({
        skill: VISION_SKILL_KEY,
        error: e?.message ?? "Unknown vision error",
      });
    }
  });

  // -------------------------------------------------------------------------
  // OpenCode tool bridge (Option B).
  // GET  /api/tools                     -> list of registered tools
  // POST /api/tools/:name { ...args }   -> invoke a tool in-process.
  //
  // Same code path that an OpenCode agent invokes when the sidecar
  // dispatches a tool call. Useful for testing, for the ChatPanel to call
  // tools without going through an LLM, and for the React UI to render
  // capability listings.
  // -------------------------------------------------------------------------
  app.get("/api/tools", (_req, res) => {
    res.json({ tools: FALLBACK_TOOLS });
  });

  app.post("/api/tools/:name", async (req, res) => {
    const { name } = req.params;
    try {
      const result = await executeBridgeTool(name, req.body ?? {});
      return res.json({ name, ...result });
    } catch (e: any) {
      console.error(`TOOL ${name} ERROR:`, e?.message ?? e);
      return res.status(400).json({ name, error: e?.message ?? "unknown" });
    }
  });

  app.post("/api/chat", async (req, res) => {
    try {
      // 0) Verify OpenCode is reachable. Fail fast with a clear 503 instead
      //    of letting the user think the model is broken.
      if (!(await opencodePing())) {
        return res.status(503).json({
          error:
            "OpenCode server not reachable. Start it with `opencode serve` " +
            "(default http://localhost:4096) or set OPENCODE_URL in .env.",
        });
      }

      // 1) Inject MHU Pipeline Execution — UNCHANGED from the original.
      //    The MHU preprocessor shapes the LLM's context; the actual LLM
      //    call now flows through OpenCode.
      if (req.body && req.body.messages && req.body.messages.length > 0) {
        const lastMessage = req.body.messages[req.body.messages.length - 1];
        if (lastMessage.role === "user") {
          try {
            const mhuResult = mhuEngine.execute_pipeline(lastMessage.content);
            const mhuContext = `[MHU 5.0 COGNITIVE ORCHESTRATION]
- Causal Analysis: ${JSON.stringify(mhuResult.causal_analysis)}
- Universal Laws Applied: ${mhuResult.universal_laws.join(", ")}
- Strategic Plan: ${JSON.stringify(mhuResult.strategic_plan)}
- Recommendations: ${mhuResult.recommendations.join(", ")}
- Counterfactuals: ${JSON.stringify(mhuResult.counterfactuals)}`;

            req.body.messages.unshift({
                role: "system",
                content: "You are enhanced by the MHU 5.0 Cognitive Framework. Integrate the following analysis into your thinking:\n" + mhuContext
            });
          } catch (mhuErr: any) {
            console.error("MHU Execution Error:", mhuErr);
          }
        }
      }

      // 2) Single call to OpenCode. The previous 3-provider fallback chain
      //    (NVIDIA → Kimi → Mistral) is replaced: OpenCode routes to the
      //    configured provider, with its own multi-provider, multi-agent,
      //    tool, and cost-control capabilities.
      const reqModel: string | undefined =
        typeof req.body?.model === "string" && req.body.model.length > 0
          ? req.body.model
          : undefined;

      const result = await opencodeComplete({
        messages: req.body.messages,
        ...(reqModel ? { model: reqModel } : {}),
        temperature: typeof req.body?.temperature === "number" ? req.body.temperature : 0.7,
        maxTokens: typeof req.body?.max_tokens === "number" ? req.body.max_tokens : 4096,
      });

      // 3) Return in the OpenAI-compatible shape the React UI already speaks.
      //    ChatPanel.tsx reads `data.choices[0]?.message?.content` — that
      //    contract is preserved.
      return res.json({
        choices: [
          {
            message: { role: "assistant", content: result.content },
            finish_reason: "stop",
            index: 0,
          },
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
    } catch (e: any) {
      console.error("PROXY ERROR:", e);
      return res.status(500).json({ error: e?.message ?? "Unknown proxy error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`[MHU] Backend: ${process.env.OPENCODE_URL ?? "http://localhost:4096"} (agent=${process.env.OPENCODE_AGENT ?? "cortex"})`);
  });
}

startServer().catch(console.error);
