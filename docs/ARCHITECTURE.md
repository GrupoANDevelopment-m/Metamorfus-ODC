# Architecture

**Last updated:** Round 3 (post domain-agnostic refactor)

## High-level

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Operator / external systems                                            │
│  (chat messages, NL commands, API requests)                             │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTP / WebSocket
┌──────────────────────────────▼──────────────────────────────────────────┐
│  Headless Server (Express)                                              │
│  ┌──────────────────┐  ┌─────────────────┐  ┌─────────────────────┐    │
│  │  Tenant Auth      │  │  LLM Library     │  │  Action Router     │    │
│  │  (per-tenant key) │  │  (multi-provider)│  │  (NL intent → act) │    │
│  └────────┬──────────┘  └────────┬────────┘  └──────────┬──────────┘    │
│           │                      │                     │               │
│  ┌────────▼──────────────────────▼─────────────────────▼──────────┐    │
│  │  Orchestrator (Metamorph + Prompt Planner + LLM API router)        │    │
│  └────────┬──────────────────────────────────────────────────────────┘    │
│           │                                                               │
│  ┌────────▼──────────────────────────────────────────────────────────┐    │
│  │  Metamorph Engine (DNA library + decay + archaeology)              │    │
│  │  • adopt(profession) — forge skills, re-activate, decay, persist   │    │
│  │  • restore(profession) — reversibility through history              │    │
│  │  • branchPreview(profession) — in-memory fork                       │    │
│  └────────┬──────────────────────────────────────────────────────────┘    │
│           │ forge_skill (python / javascript / shell / wasm / spec)      │
│  ┌────────▼──────────────────────────────────────────────────────────┐    │
│  │  OpenCode Tool Registry                                             │    │
│  │  • forge_skill  • scan_codebase  • vision_describe                  │    │
│  └────────┬──────────────────────────────────────────────────────────┘    │
└───────────┼────────────────────────────────────────────────────────────────┘
            │
┌───────────▼────────────────────────────────────────────────────────────┐
│  MHU 5.0 — Domain-Agnostic Cognitive Runtime                            │
│  • BayesianInference  (BeliefNetwork)                                    │
│  • CausalGraphEngine  (events → graph → cycles + paths)                 │
│  • CounterfactualEngine (variables → scenarios)                        │
│  • MultiAgentCouncil  (analytical/creative/skeptical)                   │
│  • WorldModel         (graph + scenario → projected state)              │
│  • ExecutivePlanner   (state → priorities)                              │
│  • EmotionalLayer     (lexical cues → affect)                          │
│  • SelfRepairEngine   (drift detection)                                 │
│  • ToolSynthesisEngine (objective → tool SPEC)                          │
│  • HiveMemory, MetacognitionEngine                                       │
│  Pure composition: takes Domain → returns deliberation trace.            │
└───────────┬────────────────────────────────────────────────────────────┘
            │
┌───────────▼────────────────────────────────────────────────────────────┐
│  Swarm (subprocess Python / Node / Bash)                                │
│  • Each node runs in separate OS process                                │
│  • Polyglot payload dispatcher (registry-based)                          │
│  • Per-node timeout (default 30s)                                       │
│  • SWARM_DISABLE_RUNTIMES env for hardening                              │
│  • Bounded spawn cost (~30-80ms per node)                               │
└───────────┬────────────────────────────────────────────────────────────┘
            │
┌───────────▼────────────────────────────────────────────────────────────┐
│  Storage                                                                │
│  • DNA Library (per-tenant dnaDir/manifest.json) — append-only         │
│  • DNA-Git-Sync — push/pull per-tenant branch                            │
│  • LLM Library (data/llm-library.json) — provider configs + health     │
│  • Decay log in state (state.profession_chain)                          │
└────────────────────────────────────────────────────────────────────────┘
```

## Modules

### `metamorfus-core/`
The heart of the organism. No I/O, no LLM, no swarm — pure data layer.

| File | Purpose |
|---|---|
| `types.ts` | Schema: `SkillManifest`, `MetamorphState`, `Profession`, `MorphFocus`. Open skill schema (runtime + payload). |
| `metamorph.ts` | Engine: `adopt()`, `restore()`, `branchPreview()`, `professionHistory()`. Manages DNA library, archaeology, decay. |
| `decay.ts` | Time-based mastery decay. Mastery = f(elapsed, half-life). Status computation. |
| `professions.ts` | Concrete professions (scientist / lumberjack / architect) — defaults, seeds, descriptions. |
| `seed-sources.ts` | Source code for each seed skill. Multi-runtime: python / javascript / shell / spec. |

### `metamorfose/`
The transformation layer. Translates high-level intent into concrete skill forging.

| File | Purpose |
|---|---|
| `orchestrator.mjs` | Executes a plan: forge_skill, pip_install, git_clone, record_metamorphose. Reports per-step status. |
| `prompt-planner.mjs` | Uses the LLM (cortex) to convert a free-form system prompt into a structured plan. |

### `llm-library/`
The provider layer. Manages multiple LLM providers, each tagged by category (text / reasoning / multimodal).

| File | Purpose |
|---|---|
| `store.mjs` | Persistent JSON store of provider configs + health state. |
| `router.mjs` | Picks the best available provider per category, with failover and cooldown. |
| `providers.mjs` | Per-provider HTTP client (NVIDIA NIM, OpenAI-compatible, Anthropic, etc). |
| `index.mjs` | Public re-exports. |

### `swarm/`
The execution layer. Spawns isolated subprocesses for any payload.

| File | Purpose |
|---|---|
| `swarm-manager.mjs` | Spawns N nodes, dispatches payloads, collects results. |
| `swarm-node.mjs` | Subprocess that runs in each node. Registry-based runtime dispatcher. |
| `swarm-protocol.mjs` | Line-delimited JSON over stdio. |

### `botnet/`
The fleet library. Templates for spawning specialised swarms.

| File | Purpose |
|---|---|
| `library.mjs` | CRUD for botnet models (vision / research / trading / scraping / security / generic). Mutation = `mutate_botnet_model`. |

### `nl/`
The natural-language layer. Routes chat to actions.

| File | Purpose |
|---|---|
| `intent.mjs` | LLM-based intent classifier. Output: `{ intent, args, reply }`. |
| `router.mjs` | ActionRouter — dispatches `intent` to handlers (forge_skill, spawn_botnet, etc). |

### `sync/`
The persistence layer.

| File | Purpose |
|---|---|
| `dna-git-sync.mjs` | Git push/pull of DNA library per tenant. |

### `auth/`
The access layer.

| File | Purpose |
|---|---|
| `tenant-auth.mjs` | Bearer token auth, per-tenant scope check, tenant resolution. |

### `mhu/`
The deliberation layer. Domain-agnostic cognitive engines.

| File | Purpose |
|---|---|
| `brain.py` | Python equivalent of `mhu_engine.ts`. LLM tool-calling harness. |
| `harness/` | LLM provider adapters. |
| `tools.py` | Tool registry for the LLM. |
| `mcp.py` | Model Context Protocol integration. |
| `memory.py`, `rag.py`, `multimodal.py` | Memory + RAG + multi-modal. |

### `packages/server` and `packages/web-ui`
The split-out entry points. `server` for headless-only deployments; `web-ui` for embedding the React dashboard in a host app.

## Data Flow: NL Chat → Skill Forged

```
1. Operator types: "turn the organism into a security analyst"
   ↓
2. Headless server POST /api/chat receives
   ↓
3. IntentParser calls LlmRouter.complete("reasoning", ...)
   ↓
4. LLM returns { intent: "metamorphose", args: { systemPrompt: "..." } }
   ↓
5. ActionRouter._metamorphose() called
   ↓
6. PromptPlanner.plan(systemPrompt) — LLM returns structured plan
   ↓
7. MetamorphoseOrchestrator.run(plan)
   ↓
8. For each step in plan.steps:
   - forge_skill → OpenCode tool registry → writes file to DNA library
   - pip_install → subprocess
   - git_clone → subprocess
   - record_metamorphose → persist manifest
   ↓
9. Adopter invoked if a profession was named
   ↓
10. Metamorph engine: adopt(profession)
   ↓
11. For each seed in profession:
   - forgeSkill({ runtime, payload }) — validated, written
   - reactivation_triggers match context? reactivate dormant skills
   - apply decay across the library
   - tag archaeology
   ↓
12. persistManifest(manifest) — atomic write to dnaDir/manifest.json
   ↓
13. Return updated state to operator
```

## State Lifecycle

```
unborn → adopt(scientist) → THINK focus
   ↓
adopt(lumberjack) → HUNT focus (scientist skills dormant, weather_read still active)
   ↓
restore(scientist) → THINK focus again (all skills preserved)
   ↓
adopt(architect) → THINK focus (architect-specific skills + reactivations)
```

State is **append-only** for the skill log; **replaced** only at the latest-version pointer. Forget is structurally impossible — to start over, fork a new organism.

## Concurrency Model

- **Headless server**: single Node.js process, async/await throughout
- **Swarm**: each node is a separate OS process, no shared memory
- **DNA library**: file-based (JSON), atomic writes (tmp + rename)
- **Locks**: `ReentrantLock` semantics in JS via `Map` + `Promise` chains (no real cross-process locking — gap)
- **Cross-tenant isolation**: per-tenant `dnaDir` enforced by auth middleware

## Round 3 Changes (this refactor)

| Area | Before | After |
|---|---|---|
| MHU engines | Hardcoded "Alta adoção / Restrição regulatória" | Domain-agnostic; takes a `Domain` object |
| Skill schema | `source: string` (Python only) | `runtime: "python" \| "javascript" \| "shell" \| "wasm" \| "spec"` + discriminated `payload` |
| Metamorphose | Linear adopt() only | `restore()` (reversibility) + `branchPreview()` (in-memory fork) + `professionHistory()` |
| Swarm | Python only | Polyglot: python, javascript, shell, wasm (placeholder), spec (data) |
| File layout | Duplicated `mhu_engine.ts` etc. in root and packages/ | Single source of truth: `packages/metamorfus-src/` |
| Tests | Hardcoded value assertions | 137 tests across 9 suites, 124 passing (LIVE tests skipped without NVIDIA_API_KEY) |
