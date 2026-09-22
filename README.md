# Metamorfus × OpenCode — Unified Monorepo

> **Cognitive organism + AI coding tool.** A single workspace that fuses the
> **Metamorfus ODC** metacognitive engine with the **OpenCode** AI development
> platform.

---

## 🎯 What is this?

This monorepo hosts the fusion of two independent systems:

| Project | What it brings |
| --- | --- |
| **[Metamorfus ODC](./packages/metamorfus-src/)** | The MHU 5.0 cognitive engine — causal graphs, metacognition, Bayesian inference, counterfactual simulation, swarm broadcast, and an executive planner. 12 cognitive engines orchestrated as a single liquid organism. |
| **[OpenCode](./packages/opencode-src/)** | An AI-powered development tool with a code editor, agent runtime, terminal UI, and an extensible tool/plugin model. The execution substrate for synthesized tools and runtime mutations. |

The fusion produces a system where the **cognitive engine drives tool
synthesis, swarm coordination, and self-repair inside an AI coding tool's
runtime** — the organism plans, the tool executes, the organism reflects.

---

## 📁 Repository Layout

```
metamorfus-opencode/
├── package.json                 # Root workspaces (bun)
├── tsconfig.base.json           # Strict TypeScript baseline
├── docs/
│   └── design.md                # ⭐ THE shared contract for mhu-core & mhu-bridge
├── packages/
│   ├── opencode-src/            # 🔌 OpenCode snapshot (frozen source of truth)
│   ├── metamorfus-src/          # 🧠 Metamorfus ODC snapshot (frozen source of truth)
│   ├── mhu-core/                # ⚙️  Re-implementation of the 12 engines (new, strict)
│   ├── mhu-bridge/              # 🌉 Glue between mhu-core and OpenCode's runtime
│   ├── web-ui/                  # 🖥️  Web frontend (placeholder, phase 1+)
│   └── server/                  # 🚀 Backend (placeholder, phase 1+)
```

The `-src` packages are **read-only snapshots** of the upstream projects. They
are kept as references and as fallback behavior; **new development happens in
`mhu-core`, `mhu-bridge`, `web-ui`, and `server`**.

---

## 🏗️ Architecture at a Glance

```
┌────────────────────────────────────────────────────────────────────┐
│                          web-ui  (React)                           │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP / WS
┌──────────────────────────────▼─────────────────────────────────────┐
│                          server  (Express)                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                       mhu-bridge                             │  │
│  │   translates cognitive plans → OpenCode tool invocations     │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
│                                 │                                  │
│  ┌──────────────────────────────▼───────────────────────────────┐  │
│  │                       mhu-core                               │  │
│  │   12 engines, execute_pipeline(), strict TypeScript contract │  │
│  └──────────────────────────────┬───────────────────────────────┘  │
│                                 │                                  │
│  ┌──────────────────────────────▼───────────────────────────────┐  │
│  │                  opencode runtime                            │  │
│  │   tools, agent loop, terminal UI, LLM provider registry      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

The contract between `mhu-core`, `mhu-bridge`, and the OpenCode runtime is
**frozen in [`docs/design.md`](./docs/design.md)**. Any engine, tool, or bridge
change must update that file first.

---

## 🚀 Quick Start (dev)

```bash
# 1. Install bun (one-time)
curl -fsSL https://bun.sh/install | bash

# 2. Install all workspaces from the repo root
cd metamorfus-opencode
bun install

# 3. Type-check everything
bun run typecheck

# 4. (Phase 1+) Run the dev server
bun run dev
```

> **Heads up:** `bun install` is intentionally not run as part of the
> monorepo setup. It is a per-developer step because it pulls native binaries
> (pty, sqlite, etc.) that depend on the host OS.

---

## 🧠 The 12 Cognitive Engines

`mhu-core` re-implements the engine set first prototyped in
`packages/metamorfus-src/mhu_engine.ts`, this time with a strict TypeScript
contract:

1. **HiveMemory** — LRU + `retrieve_recent`
2. **CausalGraphEngine** — DAG + `analyze`
3. **MetacognitionEngine** — `self_reflect`
4. **EmotionalLayer** — `update(state)`
5. **CounterfactualEngine** — `generate(query)`
6. **BayesianInference** — `update(prior, evidence)`
7. **ToolSynthesisEngine** — `synthesize(objective)`
8. **SelfRepairEngine** — `repair(diagnostics)`
9. **MultiAgentCouncil** — `deliberate(query)` (3+ perspectives)
10. **SwarmInterface** — `broadcast` / `receive`
11. **WorldModel** — `simulate(query)`
12. **ExecutivePlanner** — `generate_plan(state)`

See [`docs/design.md`](./docs/design.md) for the full TypeScript contract,
shared types, and the `execute_pipeline()` semantics.

---

## 📚 Documentation

- [`docs/design.md`](./docs/design.md) — Shared contract for `mhu-core` and
  `mhu-bridge`. **Start here.**
- [`packages/metamorfus-src/README.md`](./packages/metamorfus-src/README.md) —
  The original Metamorfus ODC handbook.
- [`packages/opencode-src/AGENTS.md`](./packages/opencode-src/AGENTS.md) —
  OpenCode's agent-development guide.

---

## 📜 License

This monorepo is private. Sub-project licenses are inherited from
`packages/*-src/`.
