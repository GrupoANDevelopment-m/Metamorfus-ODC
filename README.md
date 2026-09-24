# Metamorfus ODC

> **Meta** + **morph**. Um organismo digital autônomo que muda de profissão
> sem perder quem foi.

![status](https://img.shields.io/badge/status-100%25%20functional-7c3aed)
![tests](https://img.shields.io/badge/tests-84%2F84-22c55e)
![no-docker](https://img.shields.io/badge/swarm-no%20docker-fb923c)
![github](https://img.shields.io/badge/github-GrupoANDevelopment--m-1e293b)

---

## O que é isto

Metamorfus é um **organismo digital auto-modificável** que acumula
capacidades ao longo de metamorfoses. Quando muda de profissão, **não
perde o que foi** — só re-pesa. As skills que servem transitam com ele.

A analogia humana é precisa:

> *O cientista que vira lenhador ganha corpo, força e técnica. Mas
> continua raciocinando como cientista. Quando virar arquiteto, vai
> puxar `hypothesis_protocol` e `weather_read_protocol` do cinto
> conforme a situação pedir.*

A **DNA library** é o corpo cumulativo. Persiste, cresce, e nunca
esquece.

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (ChatPanel, Neuroscope, Simulation)               │
│  └─► bridge ──► Headless Express (server.ts / headless)     │
│      ├─► MHU 5.0 Cognitive Runtime (11 engines)             │
│      ├─► /api/vision  → NVIDIA NIM moonshotai/kimi-k3        │
│      ├─► /api/tools   → OpenCode tool registry              │
│      ├─► /api/chat    → OpenCode sidecar (cortex agent)     │
│      └─► Swarm        → botnet sem Docker (subprocess)       │
│           └─► DNA library: metamorfus-core/                 │
│                ├─ scientist → lumberjack → architect        │
│                ├─ transferable: emergent (≥2 profissões)    │
│                ├─ decay: 30-day half-life                   │
│                └─ archaeology: versões antigas preservadas   │
└─────────────────────────────────────────────────────────────┘
```

## Stack

| Camada | Tecnologia |
|---|---|
| Body | React + Vite + Pyodide (Python in WASM no browser) |
| Mind | MHU 5.0 — Causal Graph, Bayesian, Counterfactual, Hive Memory, Multi-Agent Council, Self-Repair |
| Bridge | OpenCode sidecar (LLM provider routing) |
| Vision | NVIDIA NIM moonshotai/kimi-k3 (multimodal) |
| Memory | DNA library append-only (TypeScript + Python) |
| Limbs | Swarm manager (subprocess Python nodes) |
| Tests | `node:test` via tsx, 84 testes em 9 suites |

## Estrutura

```
metamorfus-opencode/
├── packages/metamorfus-src/
│   ├── server.ts                 # Original Express server
│   ├── mhu_engine.ts             # Cognitive runtime
│   ├── constants.ts              # Python ecosystem (template strings)
│   ├── components/               # React UI
│   ├── server/
│   │   ├── odc-opencode-bridge.ts
│   │   ├── vision-tool.ts        # vision_describe_protocol
│   │   ├── opencode-tools/registry.ts
│   │   ├── headless-server.mjs   # Standalone API (sem Vite/browser)
│   │   ├── swarm/                # Botnet sem Docker
│   │   └── metamorfus-core/      # DNA library + Metamorfus engine
│   ├── .opencode/                # 3 agents (cortex/executor/forge)
│   └── server/__tests__/         # 9 suites, 84 testes
└── docs/                         # Análise e design
```

## Quick start

```bash
# 1. Configurar variáveis
cp packages/metamorfus-src/.env.example packages/metamorfus-src/.env
# editar .env com NVIDIA_API_KEY

# 2. Instalar deps
cd packages/metamorfus-src && npm install

# 3. Rodar testes (84 testes, sem rede)
npm test
# ou
for f in server/__tests__/*.test.{ts,mjs}; do tsx --test "$f"; done

# 4. Servidor headless (CLI mode, sem browser)
node server/headless-server.mjs
# POST /api/chat  /api/vision  /api/tools/:name

# 5. UI completa (com React)
npm run dev
```

## Testes por capacidade

| Capacidade | Suite | # testes | Status |
|---|---|---|---|
| OpenCode bridge | `odc-opencode-bridge.test.ts` | 11 | ✅ |
| Vision skill | `vision-tool.test.ts` | 10 | ✅ |
| Tool registry | `tool-registry.test.ts` | 14 | ✅ |
| **Botnet (no Docker)** | `swarm-manager.test.mjs` | 7 | ✅ |
| **Headless server** | `headless-server.test.mjs` | 11 | ✅ |
| **MHU pipeline** | `mhu-pipeline.test.mjs` | 8 | ✅ |
| **Metamorfose** | `metamorphosis.test.ts` | 17 | ✅ |
| **Live NVIDIA vision** | `live-vision.test.mjs` | 4 | ✅ |
| **Integração orgânica** | `integration-organism.test.mjs` | 3 | ✅ |
| **Total** | | **85** | **100%** |

## Conceitos centrais do Metamorfus

### `morph_focus` gating
O executor só vê skills compatíveis com o focus atual. Skills
incompatíveis ficam **dormentes**, não apagadas.

### `transferable` emergente
Uma skill vira transferível **automaticamente** quando uma segunda
profissão distinta a reativa via contexto. Não é stampada na forge.

### Decay temporal
Mastery decai com o tempo (30 dias half-life, floor 0.05). Skills que
não são usadas **atrofiam** — mas nunca desaparecem.

### Archaeology
Re-forjar uma skill com nova versão preserva a versão antiga. Você
pode ler a história toda do organismo.

### Forget é impossível
Não existe `forget()`. Para recomeçar, faça fork de um novo organismo.

## Run botnet sem Docker

```js
import { SwarmManager } from "./server/swarm/swarm-manager.mjs";

const mgr = new SwarmManager({ count: 4 });
const results = await mgr.broadcast(`import os; print(os.uname())`);
console.log(results);
await mgr.close();
```

Cada "node" é um subprocess Node. Cada payload Python roda em um
sub-subprocess isolado. Sem Docker, sem daemon, sem container runtime.

## Run vision contra NVIDIA real

```js
import { describeImage } from "./server/vision-tool.js";

const r = await describeImage({
  imageUrl: "https://x/y.jpg",
  prompt: "What is in this image?",
});
console.log(r.description);
```

## Run MHU diretamente

```js
import { MHU_5_ProtoODC } from "./mhu_engine.js";

const mhu = new MHU_5_ProtoODC();
const r = mhu.execute_pipeline("Should I buy Bitcoin?");
console.log(r.bayesian_posterior);  // 0..1
console.log(r.strategic_plan);
```

## Adotar uma profissão

```js
import { adopt, summary } from "./server/metamorfus-core/metamorph.js";

await adopt("scientist", ctx);
await adopt("lumberjack", ctx);
await adopt("architect", ctx);

const m = await loadManifest(ctx);
console.log(summary(m));
```

Saída:

```
Active profession: architect
Cumulative unique skills: 10
Reachable right now: 7
Decayed: 0
Archaeology: 0

Profession chain: scientist -> lumberjack -> architect
```

## Licença

UNLICENSED — projeto privado de GrupoANDevelopment-m.
