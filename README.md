# Metamorfus ODC

> **Meta** + **morph**. Um organismo digital autônomo que muda de profissão sem perder quem foi.

[![status](https://img.shields.io/badge/status-active%20development-7c3aed)](.)
[![tests](https://img.shields.io/badge/tests-124%2F124-22c55e)](.)
[![security](https://img.shields.io/badge/threat%20model-documented-1e293b)](docs/SECURITY.md)
[![architecture](https://img.shields.io/badge/architecture-documented-0ea5e9)](docs/ARCHITECTURE.md)

---

## O que é isto

Metamorfus é um **organismo digital auto-modificável** que se metamorfoseia em sistemas de **qualquer domínio** — segurança, trading, design, biologia, finanças, scientific research, o que for.

Não é framework de agente. É **organismo**.

- **Domain-agnostic**: 12 cognitive engines (Bayesian, Causal, Counterfactual, Multi-Agent Council, World Model, etc.) que processam QUALQUER input sem assumir o que é
- **Metamorfose**: muda de profissão preservando memória (DNA library) — esquecer é fisicamente impossível
- **Polyglot**: skills podem ser Python, JavaScript, Shell, WASM, ou spec (referência)
- **Swarm distribuído**: cada "node" é subprocess isolado (sem Docker)

A analogia é precisa:

> *O cientista que vira lenhador ganha corpo, força e técnica. Mas continua raciocinando como cientista. Quando virar arquiteto, vai puxar `hypothesis_protocol` e `weather_read_protocol` do cinto conforme a situação pedir.*

A **DNA library** é o corpo cumulativo. Persiste, cresce, nunca esquece.

## Quickstart

```bash
# 1. Variáveis de ambiente
cp packages/metamorfus-src/.env.example packages/metamorfus-src/.env
# editar .env com NVIDIA_API_KEY

# 2. Dependências
cd packages/metamorfus-src && npm install

# 3. Testes (124 passing)
npx tsx --test server/__tests__/*.test.mjs server/__tests__/*.test.ts

# 4. Servidor headless
node server/headless-server.mjs
# POST /api/chat  /api/vision  /api/tools/:name

# 5. UI completa
npm run dev
```

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (ChatPanel, Neuroscope, Simulation)               │
│  └─► bridge ──► Headless Express (server.ts / headless)     │
│      ├─► MHU 5.0 Cognitive Runtime (12 engines)             │
│      ├─► /api/vision  → NVIDIA NIM moonshotai/kimi-k3        │
│      ├─► /api/tools   → OpenCode tool registry              │
│      ├─► /api/chat    → OpenCode sidecar (cortex agent)     │
│      └─► Swarm        → polyglot subprocess (no Docker)     │
│           └─► DNA library: metamorfus-core/                 │
│                ├─ scientist → lumberjack → architect        │
│                ├─ transferable: emergent (≥2 profissões)    │
│                ├─ decay: configurable por profissão         │
│                └─ archaeology: versões antigas preservadas   │
└─────────────────────────────────────────────────────────────┘
```

Detalhamento completo em **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Stack

| Camada | Tecnologia |
|---|---|
| Body | React + Vite + Pyodide (Python in WASM no browser) |
| Mind | MHU 5.0 — Causal Graph, Bayesian, Counterfactual, Hive Memory, Multi-Agent Council, Self-Repair (12 engines, todos domain-agnostic) |
| Bridge | OpenCode sidecar (LLM provider routing) |
| Vision | NVIDIA NIM moonshotai/kimi-k2-instruct (multimodal) |
| Memory | DNA library append-only (TypeScript + Python) |
| Limbs | Swarm manager (polyglot subprocess: python / javascript / shell / wasm / spec) |
| Tests | `node:test` via tsx, 124 testes em 9 suites |

## Estrutura

```
metamorfus/
├── packages/
│   ├── metamorfus-src/           # Source of truth (dashboard + server)
│   │   ├── mhu_engine.ts         # 12 cognitive engines (domain-agnostic)
│   │   ├── server/               # Headless server + modules
│   │   │   ├── metamorfus-core/  # DNA library + decay + types
│   │   │   ├── metamorfose/      # Orchestrator + prompt planner
│   │   │   ├── llm-library/      # Multi-provider LLM config
│   │   │   ├── swarm/            # Polyglot subprocess manager
│   │   │   ├── botnet/           # Botnet fleet library
│   │   │   ├── nl/               # Intent parser + action router
│   │   │   ├── sync/             # DNA-git-sync
│   │   │   └── auth/             # Multi-tenant auth
│   │   ├── components/           # React UI components
│   │   ├── pages/                # React Router pages
│   │   └── server.ts             # Server entry
│   ├── server/                   # Standalone server entry
│   └── web-ui/                   # Standalone web UI entry
├── docs/
│   ├── ARCHITECTURE.md           # Architecture deep-dive
│   ├── SECURITY.md               # Threat model + checklist
│   ├── ANALYSIS.md
│   ├── ADAPTER_DESIGN.md
│   └── design.md
├── .github/workflows/test.yml   # CI: tests + security scan
└── README.md
```

## Conceitos centrais

### `morph_focus` gating
O executor só vê skills compatíveis com o focus atual. Skills incompatíveis ficam **dormentes**, não apagadas.

### `transferable` emergente
Uma skill vira transferível **automaticamente** quando uma segunda profissão distinta a reativa via contexto. Não é stampada na forge.

### Decay temporal
Mastery decai com o tempo. **Configurável por profissão** (lumberjack: 14 dias, scientist: 90 dias). Skills que não são usadas **atrofiam** — mas nunca desaparecem.

### Archaeology
Re-forjar uma skill com nova versão preserva a versão antiga. Você pode ler a história toda do organismo.

### Forget é impossível
Não existe `forget()`. Para recomeçar, faça fork de um novo organismo.

### Metamorfose reversível
`restore(profession)` volta para uma profissão anterior preservando tudo. Composição A→B→C→A preserva skills ganhas em cada estágio.

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
| **DNA git sync** | `dna-git-sync.test.mjs` | ? | ✅ |
| **Tenant auth** | `tenant-auth.test.mjs` | ? | ✅ |
| **Integração orgânica** | `integration-organism.test.mjs` | 3 | ✅ |
| **Morfeu botnet NL** | `morph-botnet-nl.test.mjs` | ? | ✅ |
| **LLM library** | `llm-library.test.mjs` | ? | ✅ |
| **Total** | | **124+** | **100%** |

15 testes LIVE (NVIDIA vision) pulam sem `NVIDIA_API_KEY` no env.

## Run botnet sem Docker

```js
import { SwarmManager } from "./server/swarm/swarm-manager.mjs";

const mgr = new SwarmManager({ count: 4 });
const results = await mgr.broadcast(`import os; print(os.uname())`);
console.log(results);
await mgr.close();
```

Cada "node" é um subprocess Node. Cada payload Python roda em um sub-subprocess isolado. Sem Docker, sem daemon, sem container runtime.

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
// String or Domain object — both work.
const r = mhu.execute_pipeline("Should I buy Bitcoin?");
console.log(r.bayesian_posterior);  // 0..1
console.log(r.strategic_plan);      // priority array
console.log(r.council);            // { analytical, creative, skeptical, ... }
```

Ou com Domain explícito:

```js
const r = mhu.execute_pipeline({
  query: "Should we approve this loan?",
  events: [
    { actor: "applicant", income: 0.7, debt_ratio: 0.4 },
    { actor: "market", volatility: 0.6 },
  ],
  hypotheses: [
    { id: "approve", label: "Approve", prior: 0.5 },
    { id: "deny", label: "Deny", prior: 0.5 },
  ],
  options: [
    { id: "approve", label: "Approve" },
    { id: "deny", label: "Deny" },
    { id: "review", label: "Manual review" },
  ],
  tags: ["finance", "lending"],
});
```

## Adotar uma profissão

```js
import { adopt, restore, professionHistory } from "./server/metamorfus-core/metamorph.js";

await adopt("scientist", ctx);
await adopt("lumberjack", ctx);
await adopt("architect", ctx);

// Reversibility
await restore("scientist", ctx);  // volta pra scientist, mantém tudo

// History
const chain = await professionHistory(ctx);
console.log(chain);  // ["scientist", "lumberjack", "architect"]
```

## Segurança

**Threat model e checklist de deployment** estão em **[docs/SECURITY.md](docs/SECURITY.md)**. Resumo:

- ✅ Multi-tenant auth (bearer tokens)
- ✅ Polyglot sandboxing (subprocess per skill)
- ✅ Shell runtime tem deny-list (rm, sudo, curl, etc.)
- ✅ Per-tenant DNA library (isolamento por diretório)
- ✅ LLM library com health checks + cooldown
- ⏳ WASM runtime é placeholder (precisa de `wasmer-js` ou `wasmtime-js`)
- ⏳ Sem rate limiting (TODO)
- ⏳ DNA-git-sync sem signing (TODO)

## Licença

UNLICENSED — projeto privado de GrupoANDevelopment-m.

**Glossário** (resumo; veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para mais):
- **ODC**: Organismo Digital Consciente
- **MHU**: Meta-Heuristic Unit (cognitive runtime)
- **PQC**: Post-Quantum Cryptography
- **Decay**: time-based mastery atrophy
- **Archaeology**: archived older versions of re-forged skills
- **Transferable**: cross-profession skill, earned by 2nd profession's reactivation
- **morph_focus**: current profession's gating lens on the DNA library
- **Swarm**: subprocess fleet, no Docker
- **Botnet**: a swarm template (model) that can be spawned
- **Domain**: a generic input shape (query + events + hypotheses + options + tags)
