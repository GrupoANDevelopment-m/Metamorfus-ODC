# `mhu-core` — Shared Design Contract

> **Status:** frozen for Phase 1 (`mhu-core-impl` and `mhu-bridge-impl`).
> **Source of truth for:** every import from `@metamorfus/mhu-core`,
> every type the bridge consumes, and every shape the OpenCode runtime
> receives back.
>
> Any change here **must** be reflected in the implementation PRs.

This document defines:

1. The package shape and exports of `@metamorfus/mhu-core`.
2. The 12 cognitive engines and their TypeScript interfaces.
3. The shared data types (`CognitiveState`, `CounterfactualScenario`,
   `ToolMutation`, …).
4. The `execute_pipeline()` orchestrator contract.
5. The error-handling pattern every engine must follow.
6. A worked usage example.

The contract is the **frozen** TypeScript shape of
`packages/metamorfus-src/mhu_engine.ts` re-expressed in strict mode, with
generic bounds, named errors, and a `Result`-style return type where
appropriate.

---

## 1. Package shape

```jsonc
// packages/mhu-core/package.json (consumer-visible fields)
{
  "name": "@metamorfus/mhu-core",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".":             "./dist/index.js",
    "./types":       "./dist/types.js",
    "./pipeline":    "./dist/pipeline.js",
    "./engines/*":   "./dist/engines/*.js"
  }
}
```

### Public exports

| Path | Exports |
| --- | --- |
| `@metamorfus/mhu-core` | `MHUOrchestrator`, `createOrchestrator`, `MHU_CORE_VERSION` |
| `@metamorfus/mhu-core/types` | All shared types from §3 |
| `@metamorfus/mhu-core/pipeline` | `PipelineRunner`, `executePipeline`, `PipelineStep` |
| `@metamorfus/mhu-core/engines/hive-memory` | `HiveMemory`, `IHiveMemory` |
| `@metamorfus/mhu-core/engines/causal-graph` | `CausalGraphEngine`, `ICausalGraphEngine` |
| `@metamorfus/mhu-core/engines/metacognition` | `MetacognitionEngine`, `IMetacognitionEngine` |
| `@metamorfus/mhu-core/engines/emotional` | `EmotionalLayer`, `IEmotionalLayer` |
| `@metamorfus/mhu-core/engines/counterfactual` | `CounterfactualEngine`, `ICounterfactualEngine` |
| `@metamorfus/mhu-core/engines/bayesian` | `BayesianInference`, `IBayesianInference` |
| `@metamorfus/mhu-core/engines/tool-synthesis` | `ToolSynthesisEngine`, `IToolSynthesisEngine` |
| `@metamorfus/mhu-core/engines/self-repair` | `SelfRepairEngine`, `ISelfRepairEngine` |
| `@metamorfus/mhu-core/engines/multi-agent` | `MultiAgentCouncil`, `IMultiAgentCouncil` |
| `@metamorfus/mhu-core/engines/swarm` | `SwarmInterface`, `ISwarmInterface` |
| `@metamorfus/mhu-core/engines/world-model` | `WorldModel`, `IWorldModel` |
| `@metamorfus/mhu-core/engines/executive-planner` | `ExecutivePlanner`, `IExecutivePlanner` |

> **Rule:** consumers should depend on the deep imports, not on the
> barrel. The barrel re-exports the orchestrator only.

---

## 2. The 12 cognitive engines

Every engine implements an interface that begins with `I` and a class that
begins with its domain name. The interface is the **contract**; the class
is the **reference implementation** that lives in `mhu-core-impl`.

All engines are **stateless and pure unless explicitly stated otherwise**.
Engines that maintain state (`HiveMemory`, `CausalGraphEngine`,
`SwarmInterface`) are constructed per-orchestrator and never share state
across orchestrators.

### 2.1 `HiveMemory` — LRU + `retrieve_recent`

Append-only knowledge store with bounded size. Default capacity **256**
items; oldest evicted on overflow.

```ts
export interface MemoryItem {
  readonly id: string;
  readonly timestamp: number;       // epoch ms
  readonly kind: MemoryKind;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type MemoryKind =
  | "observation"
  | "deliberation"
  | "tool_call"
  | "counterfactual"
  | "meta_report"
  | "swarm_message";

export interface IHiveMemory {
  /** Insert an item. Evicts the oldest if over capacity. */
  store(item: MemoryItem): void;
  /** Last `n` items, newest first. `n` is clamped to [1, capacity]. */
  retrieveRecent(n?: number): ReadonlyArray<MemoryItem>;
  /** Number of items currently stored. */
  readonly size: number;
  /** Drop everything. Used in tests and on session reset. */
  clear(): void;
}
```

### 2.2 `CausalGraphEngine` — DAG + `analyze`

A directed acyclic graph of cause→effect relations with edge weights in
`[0, 1]`. Self-edges are rejected.

```ts
export interface CausalEdge {
  readonly source: string;
  readonly target: string;
  readonly weight: number;          // [0, 1]
}

export interface CausalAnalysis {
  readonly nodes: number;
  readonly edges: number;
  readonly causalDensity: number;   // edges / max(nodes, 1), 3-decimal
  readonly cyclesDetected: boolean; // false for a strict DAG
}

export interface ICausalGraphEngine {
  addRelation(source: string, target: string, weight: number): void;
  analyze(): CausalAnalysis;
  /** Returns the immediate ancestors and descendants of `node`. */
  neighbors(node: string): { ancestors: string[]; descendants: string[] };
  /** Replace the whole graph. Used for snapshot/restore. */
  load(edges: ReadonlyArray<CausalEdge>): void;
}
```

### 2.3 `MetacognitionEngine` — `self_reflect`

Observes a `CognitiveState` and reports on its internal coherence.
**Pure** — never mutates input.

```ts
export interface MetaReport {
  readonly confidence: number;       // mirrored from state.confidence
  readonly goalAlignment: number;    // active_goals.length
  readonly attentionTargets: number; // attention_focus.length
  readonly metaObservation: string;  // human-readable one-liner
  readonly coherenceScore: number;   // [0, 1] — derived heuristic
}

export interface IMetacognitionEngine {
  selfReflect(state: Readonly<CognitiveState>): MetaReport;
}
```

### 2.4 `EmotionalLayer` — `update(state)`

Mutates `state.emotional_state` in place. Returns the previous values for
diffing.

```ts
export type EmotionalVector = Readonly<Record<string, number>>;

export interface EmotionalDelta {
  readonly previous: EmotionalVector;
  readonly current: EmotionalVector;
}

export interface IEmotionalLayer {
  update(state: CognitiveState): EmotionalDelta;
}
```

The layer is allowed to clamp every value to `[0, 1]`.

### 2.5 `CounterfactualEngine` — `generate(query)`

Returns ranked hypothetical scenarios for a query.

```ts
export interface CounterfactualScenario {
  readonly scenario: string;        // short label
  readonly probability: number;     // [0, 1]
  readonly projectedOutcome: string;
  readonly rationale: string;       // why this scenario was generated
}

export interface CounterfactualInput {
  readonly query: string;
  readonly state: Readonly<CognitiveState>;
  readonly maxResults?: number;     // default 5, hard cap 16
}

export interface ICounterfactualEngine {
  generate(input: CounterfactualInput): ReadonlyArray<CounterfactualScenario>;
}
```

### 2.6 `BayesianInference` — `update(prior, evidence)`

Standard beta-binomial update with edge-case guards.

```ts
export interface BayesianUpdateInput {
  readonly prior: number;     // [0, 1]
  readonly evidence: number;  // [0, 1] — likelihood of evidence given hypothesis
}

export interface BayesianUpdateResult {
  readonly prior: number;
  readonly evidence: number;
  readonly posterior: number; // [0, 1], 4-decimal
  readonly shiftedBy: number; // posterior - prior, signed
}

export interface IBayesianInference {
  update(input: BayesianUpdateInput): BayesianUpdateResult;
}
```

The implementation MUST guard against the `denominator == 0` case (returned
posterior equals prior) and clamp inputs to `[0, 1]` before computing.

### 2.7 `ToolSynthesisEngine` — `synthesize(objective)`

Produces a `ToolMutation` that downstream code can hand to the OpenCode
runtime to register a new tool.

```ts
export interface ToolMutation {
  readonly toolName: string;
  readonly mutationType:
    | "runtime_generation"
    | "parameter_injection"
    | "schema_extension"
    | "policy_override";
  readonly impactScore: number;     // [0, 1]
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolSynthesisInput {
  readonly objective: string;
  readonly state: Readonly<CognitiveState>;
  readonly budget?: number;         // [0, 1] — max impact, default 1.0
}

export interface IToolSynthesisEngine {
  synthesize(input: ToolSynthesisInput): ToolMutation;
}
```

### 2.8 `SelfRepairEngine` — `repair(diagnostics)`

Takes the output of the previous pipeline step and emits a repair plan.

```ts
export type RepairStatus = "repaired" | "partial" | "unrecoverable";

export interface RepairIssue {
  readonly code: string;            // machine-readable, e.g. "inconsistent_belief"
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly detail: string;
}

export interface RepairReport {
  readonly status: RepairStatus;
  readonly issuesDetected: ReadonlyArray<RepairIssue>;
  readonly actions: ReadonlyArray<string>;
  readonly stabilityRestored: boolean;
}

export interface ISelfRepairEngine {
  repair(diagnostics: ReadonlyArray<RepairIssue>): RepairReport;
}
```

### 2.9 `MultiAgentCouncil` — `deliberate(query)`

Three **named** perspectives, each with a stable role. The output is
deterministic per input (no random tie-breaking).

```ts
export type CouncilPerspective = "analytical" | "creative" | "skeptical";

export interface CouncilOpinion {
  readonly perspective: CouncilPerspective;
  readonly summary: string;
  readonly confidence: number;     // [0, 1]
  readonly dissent?: string;       // present only if this opinion disagrees
}

export interface CouncilDeliberation {
  readonly query: string;
  readonly opinions: ReadonlyArray<CouncilOpinion>;  // length >= 3
  readonly consensusScore: number; // [0, 1]
  readonly decidedAt: number;      // epoch ms
}

export interface IMultiAgentCouncil {
  deliberate(query: string, state: Readonly<CognitiveState>): CouncilDeliberation;
}
```

### 2.10 `SwarmInterface` — `broadcast` / `receive`

Stateless outbound channel + idempotent inbound drain. Implementations
MUST be safe to call before any peer is connected (no-ops).

```ts
export interface SwarmMessage {
  readonly id: string;              // uuid v4
  readonly origin: string;          // session_id of sender
  readonly topic: string;           // e.g. "bayes.posterior"
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sentAt: number;          // epoch ms
}

export interface SwarmPeerInfo {
  readonly peerId: string;
  readonly topics: ReadonlyArray<string>;
  readonly lastSeen: number;
}

export interface ISwarmInterface {
  broadcast(message: SwarmMessage): void;
  receive(): ReadonlyArray<SwarmMessage>;
  peers(): ReadonlyArray<SwarmPeerInfo>;
  /** For testability. Drops queued messages and peer state. */
  reset(): void;
}
```

### 2.11 `WorldModel` — `simulate(query)`

Projects environmental pressures for a query. Output is a structured
vector plus a free-text summary.

```ts
export interface WorldState {
  readonly economicPressure: number;   // [0, 1]
  readonly climateInstability: number; // [0, 1]
  readonly regulatoryRisk: number;     // [0, 1]
  readonly technologyShift: number;    // [0, 1]
  readonly socialVolatility: number;   // [0, 1]
}

export interface WorldSimulation {
  readonly query: string;
  readonly state: WorldState;
  readonly summary: string;
  readonly horizonDays: number;       // 1, 7, or 30
}

export interface IWorldModel {
  simulate(query: string, opts?: { horizonDays?: 1 | 7 | 30 }): WorldSimulation;
}
```

### 2.12 `ExecutivePlanner` — `generate_plan(state)`

Produces an ordered, prioritized plan.

```ts
export interface PlanItem {
  readonly id: string;
  readonly priority: number;        // 1 = highest
  readonly title: string;
  readonly rationale: string;
  readonly dependsOn: ReadonlyArray<string>; // other PlanItem.id
  readonly estimatedImpact: number; // [0, 1]
}

export interface ExecutivePlan {
  readonly items: ReadonlyArray<PlanItem>;
  readonly generatedAt: number;
  readonly confidence: number;      // [0, 1]
}

export interface IExecutivePlanner {
  generatePlan(state: Readonly<CognitiveState>): ExecutivePlan;
}
```

---

## 3. Shared data types

```ts
/** A snapshot of the organism's cognitive state. */
export interface CognitiveState {
  readonly session_id: string;             // uuid v4
  readonly active_goals: ReadonlyArray<string>;
  readonly belief_state: Readonly<Record<string, number>>; // [0, 1]
  readonly emotional_state: Readonly<Record<string, number>>; // [0, 1]
  readonly memory_context: ReadonlyArray<string>;
  readonly attention_focus: ReadonlyArray<string>;
  readonly confidence: number;             // [0, 1]
}

/** Standard engine return for fallible operations. */
export type EngineResult<T> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: EngineError };

/** All engines throw `EngineError` on programmer mistakes and
 *  return `EngineResult` for runtime/operational failures. */
export class EngineError extends Error {
  constructor(
    message: string,
    public readonly code: EngineErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export type EngineErrorCode =
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "MISSING_DEPENDENCY"
  | "BUDGET_EXCEEDED"
  | "TIMEOUT"
  | "INTERNAL";
```

`CognitiveState` is `readonly` end-to-end except for the one method that
is allowed to mutate it: `IEmotionalLayer.update`. That method must
return the previous values via `EmotionalDelta`.

---

## 4. `execute_pipeline()`

The orchestrator wires the 12 engines into a single call. **The
ordering is part of the contract.**

```ts
export interface PipelineRequest {
  readonly query: string;
  readonly state?: Partial<CognitiveState>;   // merged into a fresh state
  readonly horizonDays?: 1 | 7 | 30;          // for WorldModel
  readonly counterfactualLimit?: number;     // 1..16
}

export interface PipelineReport {
  readonly session_id: string;
  readonly causal_analysis: WorldSimulation;       // step 1
  readonly universal_laws: ReadonlyArray<string>;  // step 2 (static list)
  readonly graph_analysis: CausalAnalysis;         // step 3
  readonly debate: CouncilDeliberation;            // step 5
  readonly tool_synthesis: ToolMutation;           // step 6
  readonly bayesian_update: BayesianUpdateResult;  // step 7
  readonly counterfactuals: ReadonlyArray<CounterfactualScenario>; // step 8
  readonly unknown_variables: ReadonlyArray<string>;// step 9
  readonly strategic_plan: ExecutivePlan;          // step 10
  readonly recommendations: ReadonlyArray<string>; // step 11
  readonly emotional_delta: EmotionalDelta;        // step 12
  readonly meta_report: MetaReport;                // step 12
  readonly runtime_ms: number;                     // wall-clock
}
```

### Pipeline order

1. `WorldModel.simulate(query, { horizonDays })` → `causal_analysis`
2. Static `UNIVERSAL_LAWS` list → `universal_laws`
3. Seed `CausalGraphEngine` with two canonical relations and `analyze()` → `graph_analysis`
4. Populate `state.active_goals` from request or defaults
5. `MultiAgentCouncil.deliberate(query, state)` → `debate`
6. `ToolSynthesisEngine.synthesize({ objective: query, state })` → `tool_synthesis`
7. `BayesianInference.update({ prior: 0.5, evidence: 0.78 })` → `bayesian_update`
8. `CounterfactualEngine.generate({ query, state, maxResults })` → `counterfactuals`
9. Static `UNKNOWN_VARIABLES` list → `unknown_variables`
10. `ExecutivePlanner.generatePlan(state)` → `strategic_plan`
11. Derive `recommendations` from `strategic_plan.items` (top 3 by priority)
12. `EmotionalLayer.update(state)` → `emotional_delta`, then
    `MetacognitionEngine.selfReflect(state)` → `meta_report`

`HiveMemory` and `SwarmInterface` are called **after** the report is
built, so their results do not appear in `PipelineReport` directly:

- `HiveMemory.store(...)` is called with the `PipelineReport` snapshot.
- `SwarmInterface.broadcast(...)` is called with `{ session_id, posterior,
  recommendations, plan_items: strategic_plan.items.map(i => i.id) }`.

### Static constants (frozen)

```ts
export const UNIVERSAL_LAWS: ReadonlyArray<string> = Object.freeze([
  "Causa-Efeito",
  "Entropia",
  "Emergência",
  "Adaptação",
  "Feedback",
  "Probabilidade",
]);

export const UNKNOWN_VARIABLES: ReadonlyArray<string> = Object.freeze([
  "disrupção tecnológica",
  "falha de swarm",
  "black swan regulatório",
]);
```

### API entry points

```ts
export class MHUOrchestrator {
  constructor(opts?: MHUOrchestratorOptions);

  /** Run the full 12-step pipeline. */
  executePipeline(req: PipelineRequest): PipelineReport;

  /** Read-only access to engines, for the bridge and for tests. */
  readonly engines: Readonly<{
    hive: IHiveMemory;
    causal: ICausalGraphEngine;
    meta: IMetacognitionEngine;
    emotion: IEmotionalLayer;
    counterfactual: ICounterfactualEngine;
    bayes: IBayesianInference;
    tools: IToolSynthesisEngine;
    repair: ISelfRepairEngine;
    council: IMultiAgentCouncil;
    swarm: ISwarmInterface;
    world: IWorldModel;
    planner: IExecutivePlanner;
  }>;
}

export interface MHUOrchestratorOptions {
  readonly sessionId?: string;          // default: random uuid v4
  readonly initialState?: Partial<CognitiveState>;
  readonly engines?: Partial<{ /* 12 engine impls */ }>; // DI for tests
}

export function createOrchestrator(
  opts?: MHUOrchestratorOptions,
): MHUOrchestrator;
```

---

## 5. Error-handling pattern

Three layers, three policies:

1. **Programmer errors** (wrong types, missing required fields) →
   throw `EngineError` with code `INVALID_INPUT` or `MISSING_DEPENDENCY`.
   These are bugs in callers; do **not** catch.
2. **Operational failures** (network, timeout, budget) → return
   `EngineResult<T>` and let the orchestrator log + degrade. Example:
   `ToolSynthesisEngine` returns `EngineResult<ToolMutation>` if its
   budget is exhausted.
3. **Pipeline-level failures** → `MHUOrchestrator.executePipeline` is
   the **one** place that catches. On a thrown `EngineError` with code
   `BUDGET_EXCEEDED` it returns a partial `PipelineReport` with the
   fields populated up to the failing step, and a top-level
   `runtime_ms` field set to the elapsed time. Other throwables are
   re-raised.

```ts
try {
  return this.executePipeline(req);
} catch (err) {
  if (err instanceof EngineError && err.code === "BUDGET_EXCEEDED") {
    return this.partialReport;
  }
  throw err;
}
```

Every engine MUST:

- Validate numeric inputs and throw `EngineError("INVALID_INPUT", …)` if
  out of range.
- Never `console.log` directly — accept an optional `logger?: (msg: string, meta?: object) => void`
  in their constructor. The orchestrator wires a default no-op logger.
- Be safe to construct with no arguments.

---

## 6. Usage example

```ts
import { createOrchestrator } from "@metamorfus/mhu-core";
import type { PipelineRequest } from "@metamorfus/mhu-core/pipeline";

const orchestrator = createOrchestrator();

const request: PipelineRequest = {
  query: "Should we ship the swarm protocol to production?",
  horizonDays: 30,
  counterfactualLimit: 5,
};

const report = orchestrator.executePipeline(request);

console.log("session:", report.session_id);
console.log("posterior:", report.bayesian_update.posterior);
console.log("top plan item:", report.strategic_plan.items[0]?.title);
console.log("council consensus:", report.debate.consensusScore);
console.log("runtime_ms:", report.runtime_ms);
```

The bridge (`@metamorfus/mhu-bridge`) consumes `report.tool_synthesis`
and `report.strategic_plan`, translates them into OpenCode tool
invocations, and feeds the LLM response back into the next request.

---

## 7. Versioning

`MHU_CORE_VERSION` is a semver string. The orchestrator embeds it in
every `PipelineReport` via a side channel (`orchestrator.version`).
Breaking changes to any interface in this document require a major
bump and a migration note in `CHANGELOG.md` of `packages/mhu-core`.
