import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { MHU_5_ProtoODC } from "./mhu_engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mhuEngine = new MHU_5_ProtoODC();

// Phase 1: Security & Cost Control
let totalTokensUsed = 0;
const MAX_TOKENS_PER_SESSION = 500000;
let isKillSwitchEngaged = false;

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Admin route to check or reset kill-switch
  app.get("/api/admin/system_status", (req, res) => {
    res.json({
      totalTokensUsed,
      maxTokens: MAX_TOKENS_PER_SESSION,
      killSwitchEngaged: isKillSwitchEngaged
    });
  });

  app.post("/api/admin/reset", (req, res) => {
    totalTokensUsed = 0;
    isKillSwitchEngaged = false;
    res.json({ status: "Reset successful", isKillSwitchEngaged });
  });

  app.post("/api/chat", async (req, res) => {
    if (isKillSwitchEngaged) {
      return res.status(403).json({ error: "Kill-Switch Engaged: Token limit exceeded to prevent runaway costs." });
    }

    try {
      const clientProvidedKey = req.headers["x-api-key"] as string;
      const isNvApiKey = clientProvidedKey && clientProvidedKey.startsWith("nvapi-");

      const apiConfigs = [
        { 
          name: "Nvidia", 
          url: "https://integrate.api.nvidia.com/v1/chat/completions", 
          key: isNvApiKey ? clientProvidedKey : (process.env.NVIDIA_API_KEY || clientProvidedKey),
          // Nvidia NIM requires model strings like 'meta/llama-3.1-70b-instruct', 'moonshotai/kimi-k2.6'
          supports: (m: string) => m.includes('/')
        },
        { 
          name: "Kimi", 
          url: "https://api.moonshot.cn/v1/chat/completions", 
          key: process.env.KIMI_API_KEY || (!isNvApiKey ? clientProvidedKey : undefined),
          // Kimi uses models like 'moonshot-v1-8k'
          supports: (m: string) => m.includes('moonshot') && (!m.includes('/'))
        },
        { 
          name: "Mistral", 
          url: "https://api.mistral.ai/v1/chat/completions", 
          key: process.env.MISTRAL_API_KEY || (!isNvApiKey ? clientProvidedKey : undefined),
          // Mistral native uses models like 'mistral-large-latest', 'mistral-medium'
          supports: (m: string) => m.includes('mistral') && (!m.includes('/'))
        }
      ];

      // Inject MHU Pipeline Execution
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

      let responseText = null;
      let responseStatus = 500;
      let success = false;
      const modelName = req.body?.model || "";

      // Smart Fallback Engine based on model requested
      for (const config of apiConfigs) {
        if (!config.key) {
           console.log(`[MHU Core] Skipping ${config.name} - No API Key available.`);
           continue; 
        }
        
        // Skip provider if we know it doesn't support this model structure
        // But only strict skip if we're sure. If modelName is empty, we try anyway.
        if (modelName && !config.supports(modelName)) {
           console.log(`[MHU Core] Skipping ${config.name} - Model '${modelName}' not supported by this native endpoint.`);
           continue;
        }
        
        console.log(`[MHU Core] Attempting API: ${config.name} with model: ${modelName}`);
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 120000); 

          const response = await fetch(config.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "Authorization": `Bearer ${config.key}`
            },
            body: JSON.stringify(req.body),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);

          responseText = await response.text();
          responseStatus = response.status;
          
          if (response.ok) {
            success = true;
            break; 
          } else {
            console.warn(`[MHU Core] ${config.name} API failed: ${responseStatus} ${responseText.substring(0, 100)}...`);
            // Stop falling back if we hit a 401 (Auth Error) and we were specifically targeting this provider
            if (responseStatus === 401) {
              break; 
            }
          }
        } catch (apiErr: any) {
          console.error(`[MHU Core] ${config.name} Network Error:`, apiErr.message || apiErr);
          // If it aborted, we shouldn't continue falling back, the client probably disconnected
          if (apiErr.name === 'AbortError' || apiErr.message?.includes('aborted')) {
            responseText = JSON.stringify({ error: "Request timed out or client aborted." });
            responseStatus = 504;
            break;
          }
        }
      }

      if (!success) {
        return res.status(responseStatus).send(responseText || '{"error": "All APIs in the fallback chain failed or missing API Keys."}');
      }
      
      // Attempt to parse token usage to update our cost control
      try {
        const parsed = JSON.parse(responseText as string);
        if (parsed.usage && parsed.usage.total_tokens) {
          totalTokensUsed += parsed.usage.total_tokens;
          if (totalTokensUsed > MAX_TOKENS_PER_SESSION) {
            isKillSwitchEngaged = true;
            console.log("CRITICAL: Kill-switch engaged. Token limit reached.");
          }
        }
      } catch (parseError) {
        // Ignore JSON parse errors if we got non-JSON format
      }

      res.status(responseStatus).send(responseText);
    } catch (e: any) {
      console.error("PROXY ERROR:", e);
      res.status(500).json({ error: e.message });
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
  });
}

startServer().catch(console.error);
