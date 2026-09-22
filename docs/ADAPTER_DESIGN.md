# ADAPTER DESIGN — Metamorfus × OpenCode Fusion

> **Status:** Aguardando aprovação do usuário antes de implementar.
> **Data:** 2026-09-09
> **Princípio:** Preservar TUDO do Metamorfus. Preservar TUDO do OpenCode. Bridge fina.

---

## 1. Filosofia

A integração é **aditiva e reversível**. Nada do que existe hoje precisa mudar de comportamento pra funcionar. Só o **caminho da chamada LLM** muda.

| Componente | Hoje | Depois | Por quê |
|---|---|---|---|
| React UI (Neuroscope, Simulation, ChatPanel, App, Settings) | intacta | **intacta** | Visual é a alma, não toca |
| `mhu_engine.ts` (preprocessor de prompt) | intacto | **intacto** | É a "voz" do organismo |
| `mhu_temp.py` (referência Python) | intacto | **intacto** | Contrato Python |
| `constants.ts` (Python embedded) | intacto | **intacto** | Ecossistema Python |
| `pyodide.worker.ts` (Web Worker) | intacto | **intacto** | Simulação browser |
| `server.ts` (proxy LLM) | fallback chain NVIDIA→Kimi→Mistral | **adapter que chama OpenCode** | Único ponto de mudança |
| `odc_server.py` (Reality Bridge, FastAPI) | intacto | **intacto** | RCE preservado |
| OpenCode (monorepo) | intacto | **intacto** | É a "máquina" que estamos plugando |
| **NOVO: `server/odc-opencode-bridge.ts`** | não existe | **adapter fino (~80 linhas)** | Conecta server.ts ao OpenCode HTTP API |

**Total: 2 arquivos modificados, 1 arquivo novo. ~150 linhas de diff.**

---

## 2. Arquitetura do adapter

```
┌─────────────────────────────────────────────────────────────┐
│  Metamorfus React UI                                         │
│  (Neuroscope, Simulation, ChatPanel — intocado)              │
└──────────────────────┬───────────────────────────────────────┘
                       │ fetch("/api/chat", ...)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  server.ts (MODIFICADO)                                      │
│  - Mesma rota POST /api/chat                                 │
│  - Mesmo handler                                             │
│  - Mesma injeção de MHU.execute_pipeline()                  │
│  - Mesma estrutura de mensagens                              │
│  - **MUDANÇA:** fetch(NVIDIA/Kimi/Mistral) →                │
│                   opencodeBridge.complete(messages)         │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  server/odc-opencode-bridge.ts (NOVO, ~80 linhas)            │
│  - Lê OPENCODE_URL do .env (default: http://localhost:4096) │
│  - Cria/reusa session OpenCode                               │
│  - Envia prompt + system (MHU-enriched)                     │
│  - Retorna { content, usage, model, provider }               │
│  - Se OpenCode offline → fallback graceful (mensagem clara) │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTP
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  opencode serve (sidecar, porta 4096)                        │
│  - Multi-provider (Anthropic, OpenAI, Google, etc.)          │
│  - Multi-agent (Cortex, Executor, Forge, Judge)              │
│  - Tool system (read, write, bash, glob, etc.)               │
│  - Session management, cost control, observability           │
└─────────────────────────────────────────────────────────────┘
```

**Em paralelo** (intocado):
```
React UI ↔ Pyodide Web Worker ↔ Python ecosystem (organismo, kernel, executor, soul_stone)
React UI (LOCAL mode) ↔ WebSocket ↔ odc_server.py (Reality Bridge RCE)
```

---

## 3. server/odc-opencode-bridge.ts (novo, contrato)

```typescript
// packages/metamorfus-src/server/odc-opencode-bridge.ts

import { randomUUID } from "node:crypto";

export interface BridgeMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BridgeRequest {
  messages: BridgeMessage[];
  /** Provider override opcional (anthropic, openai, google, etc.). Default: default do OpenCode. */
  provider?: string;
  /** Model override opcional. Default: default do OpenCode. */
  model?: string;
  /** Temperature. Default: 0.7 (matches the Metamorfus existing default). */
  temperature?: number;
  /** Max tokens. Default: 4096 (matches Metamorfus). */
  maxTokens?: number;
}

export interface BridgeResponse {
  content: string;
  model: string;
  provider: string;
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://localhost:4096";
const METAMORFUS_AGENT = process.env.OPENCODE_AGENT ?? "cortex";

export async function complete(req: BridgeRequest): Promise<BridgeResponse> {
  // 1. Create or reuse session
  const sessionRes = await fetch(`${OPENCODE_URL}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!sessionRes.ok) throw new Error(`OpenCode session.create failed: ${sessionRes.status}`);
  const session = await sessionRes.json() as { id: string };

  // 2. Build parts (OpenCode's message format)
  const parts: Array<{ type: "text"; text: string }> = req.messages.map(m => ({
    type: "text",
    text: m.content,
  }));

  // 3. Send prompt (sync — waits for completion)
  const promptRes = await fetch(`${OPENCODE_URL}/session/${session.id}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent: METAMORFUS_AGENT,
      parts,
      ...(req.provider ? { provider: req.provider } : {}),
      ...(req.model ? { model: req.model } : {}),
      temperature: req.temperature ?? 0.7,
      maxTokens: req.maxTokens ?? 4096,
    }),
  });
  if (!promptRes.ok) {
    const errText = await promptRes.text();
    throw new Error(`OpenCode prompt failed: ${promptRes.status} ${errText}`);
  }
  const result = await promptRes.json() as {
    content: string;
    model?: string;
    provider?: string;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };

  return {
    content: result.content,
    model: result.model ?? req.model ?? "opencode-default",
    provider: result.provider ?? req.provider ?? "opencode-default",
    sessionId: session.id,
    usage: result.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

/** Check if OpenCode is reachable. */
export async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${OPENCODE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
```

**Por que ~80 linhas:**
- Não usa o SDK do OpenCode (que requer instalação). Usa `fetch` direto, igual o server.ts já faz com NVIDIA/Kimi/Mistral.
- Compatível com o modelo mental atual do server.ts (que já faz `fetch(url, { body: JSON.stringify(...) })`).
- Se o OpenCode mudar o shape da API, ajustamos aqui só.

---

## 4. server.ts — diff (modificações, ~80 linhas mudadas)

**O que MUDA no server.ts:**

```typescript
// SUBSTITUIR (linhas 47-69 do original):
//   const apiConfigs = [
//     { name: "Nvidia", url: "...", key: ..., supports: ... },
//     { name: "Kimi", url: "...", key: ..., supports: ... },
//     { name: "Mistral", url: "...", key: ..., supports: ... },
//   ];
//   for (const config of apiConfigs) { ... try { fetch ... } ... }

// POR:
import { complete as opencodeComplete, ping as opencodePing } from "./odc-opencode-bridge.js";

// Dentro do try do /api/chat:
if (!(await opencodePing())) {
  return res.status(503).json({
    error: "OpenCode server not reachable. Start it with `opencode serve` or set OPENCODE_URL."
  });
}

const lastMessage = req.body.messages[req.body.messages.length - 1];

// MANTÉM: mhuResult = mhuEngine.execute_pipeline(lastMessage.content)  (igual)
// MANTÉM: mhuContext = `[MHU 5.0 COGNITIVE ORCHESTRATION] ...`  (igual)
// MANTÉM: req.body.messages.unshift({role: "system", content: ...})  (igual)

// CHAMA:
try {
  const result = await opencodeComplete({
    messages: req.body.messages,
    temperature: 0.7,
    maxTokens: 4096,
  });
  // Retorna no mesmo formato OpenAI-compatible que o front espera
  return res.json({
    choices: [{ message: { role: "assistant", content: result.content } }],
    model: result.model,
    usage: result.usage,
  });
} catch (err) {
  return res.status(502).json({ error: `OpenCode call failed: ${err.message}` });
}

// REMOVER (linhas 12-14, 159-171 do original):
//   let totalTokensUsed = 0;
//   const MAX_TOKENS_PER_SESSION = 500000;
//   let isKillSwitchEngaged = false;
//   ... toda a lógica de token counting + kill switch
// PORQUÊ: OpenCode tem cost/rate control built-in. Delegamos.
// (o endpoint /api/admin/system_status vira proxy do OpenCode ou retorna 410 Gone)

// MANTER INTACTO:
//   - /api/admin/reset (agora reseta o estado do adapter)
//   - Vite middleware (modo dev)
//   - listen(3000)
```

**O que NÃO MUDA no server.ts:**
- A linha `mhuEngine.execute_pipeline(lastMessage.content)` (MHU preprocessor continua)
- A montagem do `mhuContext` (texto injetado)
- O `req.body.messages.unshift({role: "system", content: ...})` (injeção no prompt)
- O handler do `/api/admin/reset` (mas pode virar no-op ou proxy)
- A inicialização do `mhuEngine` no topo

**Linhas mudadas: ~80 de 199.**
**Comportamento externo (pra ChatPanel): idêntico** — ela ainda chama `/api/chat` e recebe `{choices: [{message: {content}}]}`. Zero mudança no ChatPanel.tsx.

---

## 5. O que NÃO MEXE (preservação total)

| Arquivo | Razão |
|---|---|
| `App.tsx` | Shell visual |
| `components/Neuroscope.tsx` | Visualização da mente (4 tabs: PLANNER, CORTEX, FORGE, DNA) |
| `components/Simulation.tsx` | Simulação do organismo (Pyodide, REALITY/LOCAL mode) |
| `components/ChatPanel.tsx` | Já fala com `/api/chat`, formato OpenAI-compatible — não precisa mudar |
| `components/CodeEditor.tsx`, `FileExplorer.tsx`, `SettingsModal.tsx` | UI |
| `components/pyodide.worker.ts` | Python driver, runtime loop |
| `mhu_engine.ts` | Preprocessor cognitivo |
| `mhu_temp.py` | Referência Python |
| `constants.ts` | Python embedded (7 módulos: SENSORIUM, ODC, MHU, CORTEX, EXECUTOR, MAIN, SERVER) |
| `types.ts` | Tipos |
| `test_py_*.py`, `test_metaprog.py`, `test_*.ts` | Testes existentes |
| `extract_py.js`, `extract_meta.js` | Scripts de extração |
| `metamorfus-src/.env.example` | (vou ATUALIZAR pra incluir OPENCODE_URL) |
| `index.html`, `index.tsx` | Entry points |
| `vite.config.ts` | Build config |
| `package.json` | (vou ATUALIZAR — adicionar type:module se precisar e nada mais) |
| `opencode-src/**/*` | INTOCADO |
| `odc_server.py` (Reality Bridge) | INTOCADO (FastAPI standalone, RCE preservado) |

---

## 6. Fluxo end-to-end (depois)

```
Usuário na ChatPanel: "Analisa o status do swarm"
   │
   ▼ fetch("/api/chat", { messages: [..., user] })
   │
server.ts (modificado)
   │
   ├─ mhuEngine.execute_pipeline(userMessage) → cognitive context (MESMO)
   ├─ Monta system prompt com MHU enrichment (MESMO)
   ├─ opencodePing() → verifica se OpenCode tá vivo
   │
   └─ opencodeComplete({ messages: [system+enriched, ..., user] })
         │
         ▼ fetch POST http://localhost:4096/session
         ▼ fetch POST http://localhost:4096/session/{id}/message
         │
         ▼ OpenCode roteia pro provider configurado
         │  (Anthropic, OpenAI, Google, Ollama local, etc.)
         │
         ▼ Resposta volta
   │
   ▼ res.json({ choices: [{ message: { role: "assistant", content } }] })
   │
ChatPanel renderiza resposta
```

**Em paralelo, intocado:**
```
Simulation.tsx (Pyodide)
  → Python ecosystem roda organism simulation
  → Cortex.analyze_task() chama LLM (mas AGORA pelo OpenCode, não mais NVIDIA direto)
  
  NOTA: o Cortex (Python) chama LLM via pyfetch pra self.api_proxy_url
  que aponta pro server.ts. Então automaticamente usa OpenCode via adapter!
  Zero mudança no Cortex.py.
```

---

## 7. O que OpenCode substitui (vs o que GANHA sem substituir)

| Capability | Antes | Depois (com OpenCode) |
|---|---|---|
| **LLM provider** | Fallback manual NVIDIA→Kimi→Mistral | **Substitui** (multi-provider built-in) |
| **Token counting** | Manual (counter + kill switch) | **Substitui** (OpenCode budget tracking) |
| **Kill switch** | Manual (`isKillSwitchEngaged`) | **Substitui** (rate limit config) |
| **Session management** | Nenhum (stateless) | **GANHA** (sessions persistem) |
| **Multi-agent debate** | Não tinha (1 LLM call) | **GANHA** (analyst/creative/skeptic como agents) |
| **Tool use** | Não tinha | **GANHA** (read, write, bash com aprovação) |
| **Observability** | Console.log | **GANHA** (eventos tipados) |
| **Provider switching** | 3 env vars | **MELHORA** (1 config central) |
| **GeneticForge** | Sim (Python) | **PRESERVADO** (roda dentro do Cortex) |
| **Reality Bridge RCE** | Sim (odc_server.py) | **PRESERVADO** (mesmo serviço, mesma API) |
| **Swarm Docker** | Sim (SwarmManager) | **PRESERVADO** (mesma implementação) |
| **MHU preprocessor** | Sim (mhu_engine.ts) | **PRESERVADO** (continua injetando contexto) |
| **Sensorium** | Sim (Python) | **PRESERVADO** |
| **SoulStone** | Sim (sqlite3) | **PRESERVADO** |
| **Kernel físico** | Sim (ODC Kernel) | **PRESERVADO** |

**Resumo: substitui 3 coisas (LLM provider, token count, kill switch). Ganha 4 (sessions, multi-agent, tools, observability). Preserva 9 (toda a simulação do organismo, o preprocessor, o reality bridge, etc).**

---

## 8. Plano de implementação (3 passos)

### Passo 1: Setup OpenCode sidecar (sem mexer no Metamorfus)
```bash
# 1. Instalar OpenCode (Bun)
curl -fsSL https://opencode.ai/install | bash

# 2. Configurar provider (escolhe 1: Anthropic, OpenAI, etc.)
opencode auth login

# 3. Rodar como sidecar
opencode serve --port 4096

# 4. Verificar
curl http://localhost:4096/health
```

### Passo 2: Criar o bridge module
- Criar `packages/metamorfus-src/server/odc-opencode-bridge.ts` (80 linhas, contrato acima)
- Atualizar `packages/metamorfus-src/.env.example` com `OPENCODE_URL=http://localhost:4096`

### Passo 3: Modificar server.ts
- Trocar a cadeia de fallback (3 providers) pela chamada ao `opencodeComplete()`
- Remover `totalTokensUsed` / `isKillSwitchEngaged` (delegado ao OpenCode)
- Atualizar `/api/admin/system_status` pra refletir o novo estado

### Passo 4: Teste manual
```bash
# Terminal 1: OpenCode sidecar
opencode serve --port 4096

# Terminal 2: Metamorfus
cd packages/metamorfus-src
npm install
npm run dev

# Browser: http://localhost:3000
# ChatPanel: envia mensagem
# Verifica nos logs do server.ts que chamou opencodeComplete
# Verifica no OpenCode que criou session e processou
```

---

## 9. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| OpenCode API shape muda entre versões | Adapter é o ÚNICO ponto de contato. Se quebrar, ajustamos 1 arquivo |
| Usuário não tem OpenCode instalado | `opencodePing()` retorna false → server.ts retorna 503 com mensagem clara ("rode `opencode serve`") |
| Latência maior (1 hop a mais) | OpenCode local = overhead mínimo. Se remoto, documentar trade-off |
| Provider do LLM escolhido tem rate limit | OpenCode gerencia. Usuário configura budget no `opencode.json` |
| Cortex.py (Python) chama `self.api_proxy_url` que aponta pro server.ts | OK — server.ts é o ÚNICO entry point. A mudança é transparente pro Cortex |
| Os prompts artesanais do Kimi (`chat_template_kwargs: {thinking: True}`) | **PERDEM** se não preservarmos. Mitigação: system prompt do agent `cortex` no OpenCode replica o que o Cortex.py tinha |

---

## 10. Decisões pra você tomar AGORA

1. **OK reverter?** Já deletei `mhu-core` e `mhu-bridge`. Confirmado.
2. **Bridge module = `server/odc-opencode-bridge.ts`?** Ou prefere outro nome/path?
3. **OpenCode sidecar na porta 4096?** (default do OpenCode, mas configurável via OPENCODE_URL)
4. **Agent name = "cortex"?** (vai virar o nome do agent no OpenCode config)
5. **System prompt do cortex = replica do que está em Cortex.py?** (preserva os truques do Kimi)
6. **Implementar passo-a-passo com diffs pequenos**, ou **ir direto e mostrar o resultado no fim**?

Responde essas 6 e eu implemento. 🚀
