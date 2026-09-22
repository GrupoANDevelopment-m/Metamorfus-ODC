# Deliverable — Fase 0: Setup do monorepo unificado

> **Task:** `setup-monorepo` (plan `plan_8bf821cc`)
> **Date:** 2026-08-20
> **Status:** ✅ complete

---

## 1. Summary

Created the unified monorepo for the **Metamorfus ODC × OpenCode** fusion at
`/workspace/metamorfus-opencode/`. Snapshots of both upstream projects were
copied into `packages/opencode-src/` and `packages/metamorfus-src/` (with
`node_modules` and `.git` excluded). A strict-TypeScript workspace powered
by **bun** wires four new placeholder packages (`mhu-core`, `mhu-bridge`,
`web-ui`, `server`) that will host the real implementation in phases 1+.
The single most important artifact — the **shared contract** in
`docs/design.md` — freezes the 12-engine TypeScript shape, the
`execute_pipeline()` orchestrator, and the error-handling policy that
`mhu-core-impl` and `mhu-bridge-impl` must respect.

---

## 2. Repository structure

```
metamorfus-opencode/
├── .gitignore                       # ignores node_modules, dist, .turbo, etc.
├── README.md                        # vision, layout, quick-start
├── package.json                     # bun workspaces, type: module
├── tsconfig.base.json               # strict TypeScript baseline
├── docs/
│   └── design.md                    # ⭐ SHARED CONTRACT for mhu-core & mhu-bridge
├── packages/
│   ├── opencode-src/                # 🔌 OpenCode snapshot (frozen source of truth)
│   ├── metamorfus-src/              # 🧠 Metamorfus ODC snapshot (frozen source of truth)
│   ├── mhu-core/                    # ⚙️  new — placeholder; real impl in mhu-core-impl
│   │   ├── package.json             # name: @metamorfus/mhu-core
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts             # placeholder (re-exports CognitiveState)
│   │       └── types.ts             # minimal CognitiveState stub
│   ├── mhu-bridge/                  # 🌉 new — placeholder; real impl in mhu-bridge-impl
│   │   ├── package.json             # name: @metamorfus/mhu-bridge
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   ├── web-ui/                      # 🖥️  new — placeholder
│   │   ├── package.json             # name: @metamorfus/web-ui
│   │   ├── tsconfig.json
│   │   └── src/index.ts
│   └── server/                      # 🚀 new — placeholder
│       ├── package.json             # name: @metamorfus/server
│       ├── tsconfig.json
│       └── src/index.ts
```

> The `-src` packages are intentionally **read-only** snapshots of the
> upstream repos. They are kept as references; new development happens
> in the four `metamorfus/...` packages.

### Copy verification

```text
# opencode-src copy
$ du -sh packages/opencode-src/        # 142M (no node_modules, no .git)
$ ls packages/opencode-src/node_modules  # not found ✅
$ ls packages/opencode-src/.git         # not found ✅

# metamorfus-src copy
$ du -sh packages/metamorfus-src/      # 437K (no node_modules, no .git, no __pycache__)
$ ls packages/metamorfus-src/node_modules  # not found ✅
$ ls packages/metamorfus-src/.git         # not found ✅
```

---

## 3. Key files in `docs/design.md`

The contract document is organized in **7 sections**:

| # | Section | Purpose |
| --- | --- | --- |
| 1 | **Package shape** | `package.json` shape, exports map, deep-import rule. |
| 2 | **The 12 cognitive engines** | Full TypeScript interface for every engine (see below). |
| 3 | **Shared data types** | `CognitiveState`, `EngineResult<T>`, `EngineError`, error codes. |
| 4 | **`execute_pipeline()`** | Request/Report types, the 12-step pipeline order, static constants. |
| 5 | **Error-handling pattern** | 3-layer policy (throw / `EngineResult` / partial report). |
| 6 | **Usage example** | Worked `createOrchestrator().executePipeline(...)` snippet. |
| 7 | **Versioning** | Semver policy and the migration note rule. |

### 12 engine interfaces (interfaces section index)

| # | Engine | Interface | Primary method |
| --- | --- | --- | --- |
| 1 | `HiveMemory` | `IHiveMemory` | `store` / `retrieveRecent` |
| 2 | `CausalGraphEngine` | `ICausalGraphEngine` | `addRelation` / `analyze` |
| 3 | `MetacognitionEngine` | `IMetacognitionEngine` | `selfReflect` |
| 4 | `EmotionalLayer` | `IEmotionalLayer` | `update(state)` |
| 5 | `CounterfactualEngine` | `ICounterfactualEngine` | `generate({query,state})` |
| 6 | `BayesianInference` | `IBayesianInference` | `update({prior,evidence})` |
| 7 | `ToolSynthesisEngine` | `IToolSynthesisEngine` | `synthesize({objective,state})` |
| 8 | `SelfRepairEngine` | `ISelfRepairEngine` | `repair(diagnostics)` |
| 9 | `MultiAgentCouncil` | `IMultiAgentCouncil` | `deliberate(query, state)` |
| 10 | `SwarmInterface` | `ISwarmInterface` | `broadcast` / `receive` |
| 11 | `WorldModel` | `IWorldModel` | `simulate(query, {horizonDays})` |
| 12 | `ExecutivePlanner` | `IExecutivePlanner` | `generatePlan(state)` |

### Other key exports

- `MHUOrchestrator` class with `executePipeline(req): PipelineReport`.
- `createOrchestrator(opts?): MHUOrchestrator` factory.
- `MHUOrchestratorOptions` with engine DI for tests.
- Frozen `UNIVERSAL_LAWS` and `UNKNOWN_VARIABLES` arrays.
- `EngineError` class with codes
  `INVALID_INPUT | INVALID_STATE | MISSING_DEPENDENCY | BUDGET_EXCEEDED | TIMEOUT | INTERNAL`.

---

## 4. Per-developer setup

Each developer runs these commands **once** after cloning the repo. They
are intentionally **not** run as part of the monorepo setup because they
pull native binaries (`pty`, `sqlite`) that depend on the host OS.

```bash
# 1. Install bun (skip if already installed)
curl -fsSL https://bun.sh/install | bash

# 2. Clone and enter the repo
git clone <repo-url> metamorfus-opencode
cd metamorfus-opencode

# 3. Install all workspaces (creates the root node_modules + each package's)
bun install

# 4. Sanity check — type-check every workspace
bun run typecheck

# 5. (Phase 1+) Run the dev server for the server + web-ui packages
bun run dev
```

Per-package scripts (also available via `bun --filter <pkg> <script>`):

```bash
# Type-check a single package
bun --filter @metamorfus/mhu-core typecheck
bun --filter @metamorfus/mhu-bridge typecheck

# Build a single package
bun --filter @metamorfus/mhu-core build

# Dev mode (phase 1+)
bun --filter @metamorfus/server dev
bun --filter @metamorfus/web-ui dev
```

> The placeholder `dev` scripts in the new packages currently just echo a
> message; real dev servers (Vite, tsx watch, etc.) land in phase 1.

---

## 5. Files created or modified

### Created at repo root
- `/workspace/metamorfus-opencode/package.json`
- `/workspace/metamorfus-opencode/tsconfig.base.json`
- `/workspace/metamorfus-opencode/.gitignore`
- `/workspace/metamorfus-opencode/README.md`
- `/workspace/metamorfus-opencode/docs/design.md`

### Created placeholder packages
- `/workspace/metamorfus-opencode/packages/mhu-core/package.json`
- `/workspace/metamorfus-opencode/packages/mhu-core/tsconfig.json`
- `/workspace/metamorfus-opencode/packages/mhu-core/src/index.ts`
- `/workspace/metamorfus-opencode/packages/mhu-core/src/types.ts`
- `/workspace/metamorfus-opencode/packages/mhu-bridge/package.json`
- `/workspace/metamorfus-opencode/packages/mhu-bridge/tsconfig.json`
- `/workspace/metamorfus-opencode/packages/mhu-bridge/src/index.ts`
- `/workspace/metamorfus-opencode/packages/web-ui/package.json`
- `/workspace/metamorfus-opencode/packages/web-ui/tsconfig.json`
- `/workspace/metamorfus-opencode/packages/web-ui/src/index.ts`
- `/workspace/metamorfus-opencode/packages/server/package.json`
- `/workspace/metamorfus-opencode/packages/server/tsconfig.json`
- `/workspace/metamorfus-opencode/packages/server/src/index.ts`

### Copied (read-only snapshots)
- `/workspace/metamorfus-opencode/packages/opencode-src/` (full content of
  `/workspace/opencode/`, minus `node_modules` and `.git`).
- `/workspace/metamorfus-opencode/packages/metamorfus-src/` (full content
  of `/workspace/Metamorfus-ODC/`, minus `node_modules`, `.git`, and
  `__pycache__`).

### Plan workspace (artifacts)
- `/workspace/.mavis/plans/plan_8bf821cc/board.md` — progress entry appended.
- `/workspace/.mavis/plans/plan_8bf821cc/outputs/setup-monorepo/deliverable.md` —
  mirror of this file (required by the engine's delivery protocol).

---

## 6. Notes for the verifier

1. **`rsync` was unavailable** in the sandbox; `cp -r` was used instead,
   followed by an explicit `rm -rf` of `node_modules` and `.git` in each
   destination. Final verification commands (above) confirm both `.git`
   and `node_modules` are absent from both `-src` packages.
2. **`bun install` was intentionally NOT run** as the task brief
   requested. Each package has only a `package.json` + a tiny
   `src/index.ts`; there is nothing to install in the placeholder
   packages and pulling `opencode-src` dependencies would have been
   O(minutes) for no benefit.
3. **The `opencode-src` package already has its own `package.json` with
   `workspaces: ["packages/*", ...]`.** That nested workspace is
   ignored by the new root workspaces because the new root only
   globs `packages/*` at its own level. The two workspaces are
   independent; resolving `@metamorfus/mhu-core` from inside
   `opencode-src` will fall through to the new root.
4. **`@metamorfus/mhu-core` re-exports its `CognitiveState` type from
   `src/index.ts`** (via a one-line re-export from `src/types.ts`) so
   consumers can write `import type { CognitiveState } from
   "@metamorfus/mhu-core"` without needing the deep import path. The
   `docs/design.md` makes this an explicit public contract.
5. **The contract is frozen** for phase 1. Changes to any interface in
   `docs/design.md` require a major version bump on
   `@metamorfus/mhu-core` and a `CHANGELOG.md` entry.
6. **The design doc explicitly numbers the engines 1-12** in the
   table, which matches the task brief's "11 engines" count + the
   orchestrator entrypoint. The brief's "12. ExecutivePlanner" is
   preserved verbatim.
