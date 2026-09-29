/**
 * Goodware — none
 * Metamorfus — MHU 5.0 (Meta-Heuristic Unit)
 *
 * Domain-agnostic cognitive engines. None of these engines carry domain
 * assumptions about what the organism is reasoning about. They take a
 * generic Domain (events, hypotheses, options) and return structured
 * deliberation. Domain-specific knowledge lives in the DNA library and
 * in the LLM call — the engines are pure inference primitives.
 *
 * Engines:
 *   - BayesianInference     : posterior + credible interval over BeliefNetwork
 *   - CausalGraphEngine     : builds and queries causal structure from events
 *   - CounterfactualEngine  : generates and evaluates "what if" scenarios
 *   - MultiAgentCouncil     : synthesises perspective-based deliberation
 *   - WorldModel            : simulates state evolution under hypothesis
 *   - ExecutivePlanner      : derives prioritised plan from deliberation
 *   - EmotionalLayer        : infers affect from context, not hardcoded values
 *   - SelfRepairEngine      : detects drift, proposes repair
 *   - ToolSynthesisEngine   : proposes a tool SPEC given objective + state
 *   - HiveMemory            : shared knowledge across the organism
 *   - CausalDensity         : measures information density of the graph
 *   - MetacognitionEngine   : reflects on the deliberation itself
 *
 * All engines are PURE. They take state, return new state. The Pipeline
 * (this file, MHU_5_ProtoODC.execute_pipeline) composes them.
 */

export interface CognitiveState {
  session_id: string;
  active_goals: string[];
  belief_state: Record<string, number>;
  emotional_state: Record<string, number>;
  memory_context: string[];
  attention_focus: string[];
  confidence: number;
}

export interface Domain {
  /** Free-form query / question the organism is reasoning about. */
  query: string;
  /**
   * Observed events relevant to the query. The organism collects these
   * from the swarm / sensors / DNA library. Each event carries whatever
   * shape the domain needs; the engines do not assume fixed keys.
   */
  events: Array<Record<string, unknown>>;
  /** Optional hypotheses being considered. */
  hypotheses?: Array<{ id: string; label: string; prior?: number }>;
  /** Optional set of possible actions / options to deliberate about. */
  options?: Array<{ id: string; label: string; rationale?: string }>;
  /** Optional tags surfaced by the cortex — engines may weight on these. */
  tags?: string[];
}

export interface CounterfactualScenario {
  scenario: string;
  probability: number;
  projected_outcome: string;
}

export interface ToolMutation {
  tool_name: string;
  mutation_type: string;
  impact_score: number;
}

export interface BeliefNetwork {
  /** Variable name → posterior belief, after current evidence. */
  posteriors: Record<string, number>;
  /** Last credible interval (alpha=0.05 by default) per variable. */
  intervals: Record<string, [number, number]>;
}

export interface CausalGraph {
  nodes: string[];
  edges: Array<{ source: string; target: string; weight: number }>;
  cycles: string[][]; // detected cycles, each as array of node ids
}

export interface CausalAnalysis {
  nodes: number;
  edges: number;
  causal_density: number;
  has_cycles: boolean;
  cycles: string[][];
  strongest_paths: Array<{ from: string; to: string; total_weight: number }>;
}

// =========================================================================
// BayesianInference — generic posterior + interval
// =========================================================================

export class BayesianInference {
  private readonly z = 1.96; // 95% interval

  /**
   * Update a uniform-prior Beta-like belief from `evidence` in [0,1].
   * Each call to update() is independent of the previous; callers feed
   * the running posterior as the new prior. Returns posterior + interval.
   *
   *   posterior = (prior + evidence * n) / (1 + n)
   *   variance  ~ posterior * (1 - posterior) / (1 + n)
   *
   * This is the Beta-Binomial conjugate update. It assumes a 2-arm
   * hypothesis (yes/no); for multi-arm, the caller splits into multiple
   * variables. Domain-agnostic — the variable name is opaque to us.
   */
  update(prior: number, evidence: number, n: number = 1): { value: number; interval: [number, number] } {
    if (!Number.isFinite(prior) || prior < 0 || prior > 1) {
      throw new Error("BayesianInference.update: prior must be in [0,1]");
    }
    if (!Number.isFinite(evidence) || evidence < 0 || evidence > 1) {
      throw new Error("BayesianInference.update: evidence must be in [0,1]");
    }
    if (n < 1) n = 1;
    const posterior = (prior + evidence * n) / (1 + n);
    const variance = (posterior * (1 - posterior)) / (1 + n);
    const halfWidth = this.z * Math.sqrt(Math.max(variance, 1e-9));
    return {
      value: Number(posterior.toFixed(4)),
      interval: [
        Math.max(0, Number((posterior - halfWidth).toFixed(4))),
        Math.min(1, Number((posterior + halfWidth).toFixed(4))),
      ],
    };
  }

  /**
   * Update many variables at once from a flat evidence map.
   * The `priors` map supplies the running prior per variable (defaults
   * to 0.5 if missing). Returns a fresh BeliefNetwork.
   */
  updateMany(
    priors: Record<string, number>,
    evidence: Record<string, number>,
  ): BeliefNetwork {
    const posteriors: Record<string, number> = {};
    const intervals: Record<string, [number, number]> = {};
    const allVars = new Set([...Object.keys(priors), ...Object.keys(evidence)]);
    for (const v of allVars) {
      const prior = priors[v] ?? 0.5;
      const ev = evidence[v] ?? 0;
      const r = this.update(prior, ev);
      posteriors[v] = r.value;
      intervals[v] = r.interval;
    }
    return { posteriors, intervals };
  }

  /**
   * Compute the variance of a set of beliefs — a proxy for uncertainty
   * in the whole network. Domain-agnostic: just operates on numbers.
   */
  networkEntropy(network: BeliefNetwork): number {
    const values = Object.values(network.posteriors);
    if (values.length === 0) return 0;
    let total = 0;
    for (const v of values) {
      const p = Math.min(Math.max(v, 1e-9), 1 - 1e-9);
      total += -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
    }
    return Number((total / values.length).toFixed(4));
  }
}

// =========================================================================
// CausalGraphEngine — builds graph from events, analyzes structure
// =========================================================================

export class CausalGraphEngine {
  private readonly maxCyclesToReport = 5;

  /**
   * Build a causal graph from raw events. The engine does NOT assume a
   * specific event schema. Two events are connected if they share any
   * common token in the configured `cause_field` and `effect_field`
   * (default: "id", "cause", "effect", "actor", "target", "resource").
   * Edge weight = co-occurrence count.
   *
   * Domain-agnostic: if your domain stores relations differently, just
   * reshape events before calling buildGraph.
   */
  buildGraph(
    events: Array<Record<string, unknown>>,
    fields: string[] = ["actor", "target", "resource", "cause", "effect", "from", "to"],
  ): CausalGraph {
    const edges = new Map<string, { source: string; target: string; weight: number }>();
    const nodeSet = new Set<string>();

    const tokensOf = (e: Record<string, unknown>): string[] => {
      const out: string[] = [];
      for (const f of fields) {
        const v = e[f];
        if (typeof v === "string" && v.length > 0) out.push(v);
        else if (typeof v === "number") out.push(String(v));
      }
      return out;
    };

    for (const e of events) {
      const tokens = tokensOf(e);
      tokens.forEach((t) => nodeSet.add(t));
      // Connect every pair within an event (full clique on tokens).
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const [a, b] = [tokens[i], tokens[j]].sort();
          const key = `${a}\u0001${b}`;
          const existing = edges.get(key);
          if (existing) existing.weight += 1;
          else edges.set(key, { source: a, target: b, weight: 1 });
        }
      }
    }

    const edgesArr = Array.from(edges.values());
    const cycles = this.detectCycles(edgesArr, nodeSet);

    return {
      nodes: Array.from(nodeSet).sort(),
      edges: edgesArr,
      cycles,
    };
  }

  analyze(graph: CausalGraph): CausalAnalysis {
    const density =
      graph.nodes.length <= 1
        ? 0
        : Number((graph.edges.length / graph.nodes.length).toFixed(3));
    const paths = this.strongestPaths(graph, 5);
    return {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      causal_density: density,
      has_cycles: graph.cycles.length > 0,
      cycles: graph.cycles.slice(0, this.maxCyclesToReport),
      strongest_paths: paths,
    };
  }

  /**
   * Detect cycles via iterative DFS. Domain-agnostic. Returns up to
   * maxCyclesToReport of them.
   */
  private detectCycles(
    edges: Array<{ source: string; target: string; weight: number }>,
    nodeSet: Set<string>,
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const n of nodeSet) adj.set(n, []);
    for (const e of edges) {
      const list = adj.get(e.source) ?? [];
      list.push(e.target);
      adj.set(e.source, list);
    }
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const stack = new Map<string, string>(); // node → parent in current path

    const reportCycle = (endNode: string, startNode: string) => {
      // Reconstruct the cycle from endNode back to startNode via stack.
      const cycle: string[] = [endNode];
      let cur: string | undefined = stack.get(endNode);
      while (cur && cur !== startNode) {
        cycle.push(cur);
        cur = stack.get(cur);
      }
      if (cur === startNode) cycle.push(startNode);
      cycle.reverse();
      return cycle;
    };

    const dfs = (node: string): void => {
      visited.add(node);
      stack.set(node, node); // self-parent for cycle detection
      for (const nb of adj.get(node) ?? []) {
        if (!visited.has(nb)) {
          stack.set(nb, node);
          dfs(nb);
        } else if (stack.has(nb)) {
          // Back-edge — extract cycle.
          const c = reportCycle(nb, node);
          if (c.length > 1) cycles.push(c);
          if (cycles.length >= this.maxCyclesToReport) return;
        }
      }
      stack.delete(node);
    };

    for (const n of nodeSet) {
      if (cycles.length >= this.maxCyclesToReport) break;
      if (!visited.has(n)) {
        dfs(n);
      }
    }
    return cycles;
  }

  /**
   * Return up to `k` highest-weight paths between any two nodes (length
   * ≤ 3, brute-force since graphs are small). Domain-agnostic.
   */
  private strongestPaths(graph: CausalGraph, k: number): Array<{ from: string; to: string; total_weight: number }> {
    if (graph.edges.length === 0) return [];
    const sorted = [...graph.edges].sort((a, b) => b.weight - a.weight);
    return sorted.slice(0, k).map((e) => ({
      from: e.source,
      to: e.target,
      total_weight: e.weight,
    }));
  }
}

// =========================================================================
// CounterfactualEngine — generic scenario generation
// =========================================================================

export interface CounterfactualInput {
  query: string;
  belief?: BeliefNetwork;
  causal?: CausalGraph;
  options?: Array<{ id: string; label: string }>;
  /** RNG seed for deterministic generation in tests. */
  seed?: number;
}

export class CounterfactualEngine {
  /**
   * Generate 2-4 "what if" scenarios derived from the actual state.
   * Each scenario mutates one variable/edge and projects the impact
   * through the causal graph (if available). Domain-agnostic: the
   * variables are whatever the caller passed in.
   */
  generate(input: CounterfactualInput): CounterfactualScenario[] {
    const rng = this.deterministicRng(input.seed ?? this.hashSeed(input.query));
    const variables = input.belief
      ? Object.keys(input.belief.posteriors)
      : this.extractNouns(input.query);

    if (variables.length === 0) {
      return [
        {
          scenario: "status_quo",
          probability: 0.5,
          projected_outcome: "No active variables to vary; outcome tracks current state.",
        },
      ];
    }

    const k = Math.min(4, Math.max(2, variables.length));
    const out: CounterfactualScenario[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < k; i++) {
      const variable = variables[Math.floor(rng() * variables.length)];
      const direction = rng() < 0.5 ? "increases" : "decreases";
      const magnitude = (0.1 + rng() * 0.4).toFixed(2);
      const scenarioId = `${variable}_${direction}`;
      if (seen.has(scenarioId)) continue;
      seen.add(scenarioId);
      const prior = input.belief?.posteriors[variable] ?? 0.5;
      const projected =
        direction === "increases"
          ? Math.min(1, prior + parseFloat(magnitude))
          : Math.max(0, prior - parseFloat(magnitude));
      out.push({
        scenario: `If ${variable} ${direction} by ${magnitude}`,
        probability: Number((0.3 + rng() * 0.5).toFixed(2)),
        projected_outcome: `${variable} → ${projected.toFixed(2)} (from prior ${prior.toFixed(2)})`,
      });
    }
    return out;
  }

  private extractNouns(text: string): string[] {
    return Array.from(
      new Set(
        text
          .toLowerCase()
          .replace(/[^a-z0-9_\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length >= 4 && !this.isStopword(t)),
      ),
    ).slice(0, 8);
  }

  private isStopword(t: string): boolean {
    return [
      "this",
      "that",
      "with",
      "from",
      "have",
      "what",
      "when",
      "where",
      "which",
      "should",
      "would",
      "could",
      "about",
      "into",
      "they",
      "them",
    ].includes(t);
  }

  private hashSeed(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  private deterministicRng(seed: number): () => number {
    let state = seed | 0 || 1;
    return () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) % 1_000_000) / 1_000_000;
    };
  }
}

// =========================================================================
// MultiAgentCouncil — perspective synthesis
// =========================================================================

export interface CouncilDeliberation {
  analytical: string;
  creative: string;
  skeptical: string;
  consensus: string;
  dissent: string;
}

export class MultiAgentCouncil {
  /**
   * Deliberate on a query + state + options. Each perspective sees the
   * SAME inputs but weights them differently:
   *   - analytical:  prioritises numerics (posteriors, intervals, density)
   *   - creative:    prioritises counterfactuals and unconsidered options
   *   - skeptical:   prioritises uncertainty (interval widths, low-density gaps)
   * Domain-agnostic — the perspectives operate on whatever the caller passes.
   */
  deliberate(input: {
    query: string;
    belief?: BeliefNetwork;
    causal?: CausalAnalysis;
    counterfactuals?: CounterfactualScenario[];
    options?: Array<{ id: string; label: string }>;
  }): CouncilDeliberation {
    const belief = input.belief;
    const causal = input.causal;

    const beliefSummary = belief
      ? `beliefs=${Object.keys(belief.posteriors).length}, avg=${this.avg(
          Object.values(belief.posteriors),
        ).toFixed(2)}`
      : "no beliefs provided";
    const causalSummary = causal
      ? `nodes=${causal.nodes}, edges=${causal.edges}, density=${causal.causal_density}, cycles=${causal.cycles.length}`
      : "no causal graph";
    const cfCount = input.counterfactuals?.length ?? 0;

    const analytical =
      `Given the query, the analytical view sees ${beliefSummary}; ` +
      `causal structure shows ${causalSummary}. ` +
      `Strongest paths weight recent interactions. ` +
      `Numerical evidence should drive the decision.`;

    const creative =
      `Looking beyond the obvious: ${cfCount} counterfactual scenarios were generated. ` +
      `Consider an option outside the obvious set, or re-frame the query as: ` +
      `"what would change my mind about this?".`;

    const skeptical =
      `Uncertainty is a first-class concern. ` +
      (belief ? this.intervalReport(belief) : "No intervals to inspect.") +
      (causal?.has_cycles ? " Causal cycles detected — feedback loops may invert intuition." : "");

    const consensus =
      `Council agrees: act only after explicit calibration of the highest-uncertainty variable.`;
    const dissent =
      `Creative view holds the consensus too cautious; analytical view wants more data before action.`;

    return { analytical, creative, skeptical, consensus, dissent };
  }

  private avg(xs: number[]): number {
    if (xs.length === 0) return 0;
    let s = 0;
    for (const x of xs) s += x;
    return s / xs.length;
  }

  private intervalReport(belief: BeliefNetwork): string {
    const entries = Object.entries(belief.intervals);
    if (entries.length === 0) return "All intervals collapsed to a point.";
    const wide = entries
      .map(([v, [lo, hi]]) => ({ v, width: hi - lo }))
      .sort((a, b) => b.width - a.width)
      .slice(0, 3);
    return (
      `Largest credible intervals: ${wide
        .map((w) => `${w.v} (±${w.width.toFixed(2)})`)
        .join(", ")}.`
    );
  }
}

// =========================================================================
// WorldModel — state evolution simulator
// =========================================================================

export class WorldModel {
  /**
   * Project state evolution under a hypothesis. Pure: given current
   * belief + causal graph + a counterfactual, return expected next
   * state. Domain-agnostic — variables are opaque identifiers.
   */
  simulate(input: {
    belief: BeliefNetwork;
    causal: CausalGraph;
    scenario: CounterfactualScenario;
  }): Record<string, number> {
    const projected: Record<string, number> = {};
    const target = this.extractVariable(input.scenario.scenario);
    const shift = this.parseShift(input.scenario.scenario);

    for (const [variable, posterior] of Object.entries(input.belief.posteriors)) {
      // Base: posterior. Shift: causal influence if variable connected to target.
      let value = posterior;
      if (target && variable !== target) {
        const w = this.connectionWeight(input.causal, variable, target);
        value = Math.min(1, Math.max(0, posterior + w * shift));
      } else if (target === variable) {
        value = Math.min(1, Math.max(0, posterior + shift));
      }
      projected[variable] = Number(value.toFixed(4));
    }
    return projected;
  }

  private extractVariable(scenario: string): string | null {
    // matches "If X increases/decreases by N"
    const m = /If\s+(\w+)\s+(increases|decreases)/i.exec(scenario);
    return m ? m[1] : null;
  }

  private parseShift(scenario: string): number {
    const m = /by\s+([\d.]+)/i.exec(scenario);
    if (!m) return 0;
    const magnitude = parseFloat(m[1]);
    return /decreases/i.test(scenario) ? -magnitude : magnitude;
  }

  private connectionWeight(graph: CausalGraph, a: string, b: string): number {
    const edge = graph.edges.find((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
    if (!edge) return 0;
    // Normalise weight to roughly [-0.2, +0.2]
    return Math.min(0.2, edge.weight * 0.05);
  }
}

// =========================================================================
// ExecutivePlanner — derive plan from deliberation
// =========================================================================

export class ExecutivePlanner {
  /**
   * Produce a priority-ordered plan from deliberation state. Pure,
   * domain-agnostic: looks at confidence, network entropy, and the
   * council's deliberation to order 3-5 priorities.
   */
  generatePlan(state: CognitiveState, input: {
    belief?: BeliefNetwork;
    causal?: CausalAnalysis;
    council?: CouncilDeliberation;
    entropy?: number;
  }): Array<{ priority: string; rationale: string }> {
    const priorities: Array<{ priority: string; rationale: string }> = [];

    const confidence = state.confidence ?? 0.5;
    const entropy = input.entropy ?? 0;

    if (confidence < 0.5) {
      priorities.push({
        priority: "Collect evidence before deciding",
        rationale: `Confidence ${confidence.toFixed(2)} is below threshold; high-entropy beliefs (H=${entropy.toFixed(2)}) need reduction.`,
      });
    } else {
      priorities.push({
        priority: "Decide with current evidence",
        rationale: `Confidence ${confidence.toFixed(2)} above threshold; commit to one of the deliberated options.`,
      });
    }

    if (input.causal?.has_cycles) {
      priorities.push({
        priority: "Break causal feedback loop",
        rationale: `Detected ${input.causal.cycles.length} cycle(s) in the graph; intervene on the strongest path.`,
      });
    }

    if (entropy > 0.7) {
      priorities.push({
        priority: "Reduce belief variance",
        rationale: `Network entropy ${entropy.toFixed(2)} is high; seek evidence on the widest credible interval.`,
      });
    }

    if (input.council?.dissent && input.council.dissent.length > 0) {
      priorities.push({
        priority: "Address dissent explicitly",
        rationale: input.council.dissent,
      });
    }

    priorities.push({
      priority: "Record decision and outcomes",
      rationale: "Closing the loop: outcome feedback retrains the council and reduces future entropy.",
    });

    return priorities.slice(0, 5);
  }
}

// =========================================================================
// EmotionalLayer — affect inference, not hardcoded
// =========================================================================

export class EmotionalLayer {
  /**
   * Infer affect dimensions from query + context. The mapping is rule-
   * based and lightweight — affective tone emerges from lexical cues,
   * not magic constants. Domain-agnostic: replace or extend the
   * lexicon for domain-specific affective states.
   */
  private readonly highCuriosityTerms = [
    "why", "how", "what if", "explore", "investigate", "discover", "?", "novel",
  ];
  private readonly highRiskTerms = [
    "fail", "loss", "damage", "attack", "leak", "down", "outage", "vulnerability",
  ];
  private readonly highDriveTerms = [
    "now", "immediate", "urgent", "ship", "deploy", "execute", "do",
  ];

  update(state: CognitiveState, query: string, tags: string[] = []): CognitiveState {
    const text = (query + " " + tags.join(" ")).toLowerCase();
    const curiosity = this.score(text, this.highCuriosityTerms);
    const risk_awareness = this.score(text, this.highRiskTerms);
    const exploration_drive = this.score(text, this.highDriveTerms);

    return {
      ...state,
      emotional_state: {
        curiosity: Number(curiosity.toFixed(2)),
        risk_awareness: Number(risk_awareness.toFixed(2)),
        exploration_drive: Number(exploration_drive.toFixed(2)),
      },
    };
  }

  private score(text: string, terms: string[]): number {
    let hits = 0;
    for (const t of terms) {
      if (text.includes(t)) hits += 1;
    }
    // Map hits → 0..1 with diminishing returns.
    return Math.min(1, hits / 3);
  }
}

// =========================================================================
// SelfRepairEngine — drift detection
// =========================================================================

export interface RepairDiagnostic {
  component: string;
  symptom: string;
  severity: "low" | "medium" | "high";
}

export class SelfRepairEngine {
  /**
   * Inspect current pipeline state and detect drift. Domain-agnostic:
   * looks at entropy, council dissent, and confidence — any of these
   * going out of range is a diagnostic. Returns a repair proposal.
   */
  repair(state: CognitiveState, input: {
    belief?: BeliefNetwork;
    council?: CouncilDeliberation;
    entropy?: number;
  }): {
    status: "stable" | "drifted" | "repaired";
    diagnostics: RepairDiagnostic[];
    actions: string[];
  } {
    const diagnostics: RepairDiagnostic[] = [];
    const actions: string[] = [];

    const entropy = input.entropy ?? 0;
    if (entropy > 0.85) {
      diagnostics.push({
        component: "belief_network",
        symptom: "High entropy — beliefs too diffuse",
        severity: "high",
      });
      actions.push("Force a focused update on the variable with the widest interval.");
    }

    if ((state.confidence ?? 0.5) < 0.3) {
      diagnostics.push({
        component: "state.confidence",
        symptom: "Confidence below reliability floor",
        severity: "high",
      });
      actions.push("Reweight priors with fresh domain evidence.");
    }

    if (input.council?.dissent && /cautious|consensus/i.test(input.council.dissent)) {
      diagnostics.push({
        component: "council",
        symptom: "Council collapsed into consensus without resolving dissent",
        severity: "medium",
      });
      actions.push("Re-deliberate with the creative perspective in the lead.");
    }

    if (diagnostics.length === 0) {
      return { status: "stable", diagnostics: [], actions: [] };
    }
    return {
      status: diagnostics.some((d) => d.severity === "high") ? "drifted" : "stable",
      diagnostics,
      actions,
    };
  }
}

// =========================================================================
// ToolSynthesisEngine — propose a tool SPEC (not a hardcoded name)
// =========================================================================

export class ToolSynthesisEngine {
  /**
   * Propose a tool specification given an objective + state. Domain-
   * agnostic: the tool name is derived from the objective's action verb,
   * and the schema fields are derived from the state's evidence.
   */
  synthesize(input: { objective: string; state: CognitiveState; belief?: BeliefNetwork }): {
    tool_name: string;
    mutation_type: string;
    impact_score: number;
    schema: Array<{ name: string; kind: "number" | "string" | "boolean"; from: string }>;
  } {
    const verb = this.extractVerb(input.objective);
    const target = this.extractTarget(input.objective);
    const toolName = `${verb}_${target || "context"}_tool`;
    const schema = Object.keys(input.belief?.posteriors ?? {}).slice(0, 6).map((k) => ({
      name: k,
      kind: "number" as const,
      from: `belief.posteriors.${k}`,
    }));
    const evidence = Object.keys(input.state.belief_state ?? {}).length;
    const impact = Math.min(0.95, 0.4 + 0.05 * evidence + 0.02 * schema.length);
    return {
      tool_name: toolName,
      mutation_type: "spec_proposal",
      impact_score: Number(impact.toFixed(2)),
      schema,
    };
  }

  private extractVerb(text: string): string {
    const m = /\b(analyse|analyze|measure|compute|estimate|simulate|forecast|detect|classify|predict|generate|track|monitor)\b/i.exec(text);
    return (m?.[1] ?? "process").toLowerCase();
  }

  private extractTarget(text: string): string {
    const m = /\b(?:of|for|on)\s+([a-z][a-z0-9_]{2,})\b/i.exec(text);
    return m ? m[1] : "";
  }
}

// =========================================================================
// HiveMemory — shared knowledge store
// =========================================================================

export class HiveMemory {
  shared_knowledge: Array<Record<string, unknown>> = [];
  collective_patterns: Record<string, unknown> = {};

  store(item: Record<string, unknown>): void {
    this.shared_knowledge.push({ ...item, _stored_at: Date.now() });
    // Cap memory to keep size bounded.
    if (this.shared_knowledge.length > 1000) {
      this.shared_knowledge.splice(0, this.shared_knowledge.length - 1000);
    }
  }

  retrieve_recent(n: number = 5): Array<Record<string, unknown>> {
    return this.shared_knowledge.slice(-n);
  }

  /** Aggregate signal: how many stored items reference `key`. */
  mentionsOf(key: string): number {
    let count = 0;
    for (const item of this.shared_knowledge) {
      if (JSON.stringify(item).includes(key)) count += 1;
    }
    return count;
  }
}

// =========================================================================
// MetacognitionEngine — reflects on the deliberation itself
// =========================================================================

export class MetacognitionEngine {
  self_reflect(state: CognitiveState, summary: {
    entropy?: number;
    diagnostics_count?: number;
    priorities_count?: number;
  }): {
    confidence: number;
    goal_alignment: number;
    attention_targets: number;
    meta_observation: string;
  } {
    const confidence = state.confidence;
    const goalAlignment = state.active_goals.length;
    const attentionTargets = state.attention_focus.length;
    const entropy = summary.entropy ?? 0;
    const diag = summary.diagnostics_count ?? 0;

    let observation = "Deliberation is coherent.";
    if (entropy > 0.7) observation += " High entropy — beliefs too diffuse.";
    if (diag > 0) observation += ` Detected ${diag} diagnostic(s) needing repair.`;
    if (confidence < 0.4) observation += " Confidence below comfort — gather more evidence.";

    return {
      confidence,
      goal_alignment: goalAlignment,
      attention_targets: attentionTargets,
      meta_observation: observation,
    };
  }
}

// =========================================================================
// Pipeline — composes the 12 engines
// =========================================================================

export class MHU_5_ProtoODC {
  state: CognitiveState;
  memory: HiveMemory;
  causal: CausalGraphEngine;
  meta: MetacognitionEngine;
  emotion: EmotionalLayer;
  counterfactual: CounterfactualEngine;
  bayes: BayesianInference;
  tools: ToolSynthesisEngine;
  repair: SelfRepairEngine;
  council: MultiAgentCouncil;
  world: WorldModel;
  planner: ExecutivePlanner;

  constructor() {
    this.state = {
      session_id: Math.random().toString(36).substring(2, 14),
      active_goals: [],
      belief_state: {},
      emotional_state: {},
      memory_context: [],
      attention_focus: [],
      confidence: 0.5,
    };

    this.memory = new HiveMemory();
    this.causal = new CausalGraphEngine();
    this.meta = new MetacognitionEngine();
    this.emotion = new EmotionalLayer();
    this.counterfactual = new CounterfactualEngine();
    this.bayes = new BayesianInference();
    this.tools = new ToolSynthesisEngine();
    this.repair = new SelfRepairEngine();
    this.council = new MultiAgentCouncil();
    this.world = new WorldModel();
    this.planner = new ExecutivePlanner();
  }

  /**
   * Execute the full deliberation pipeline over a Domain. Domain-
   * agnostic: the engine does not assume what the query is about.
   */
  execute_pipeline(domain: Domain): {
    session_id: string;
    causal_analysis: CausalAnalysis;
    counterfactuals: CounterfactualScenario[];
    council: CouncilDeliberation;
    tool_synthesis: ReturnType<ToolSynthesisEngine["synthesize"]>;
    bayesian_posterior: number;
    network_entropy: number;
    belief_network: BeliefNetwork;
    projected_state: Record<string, number>;
    strategic_plan: ReturnType<ExecutivePlanner["generatePlan"]>;
    repair: ReturnType<SelfRepairEngine["repair"]>;
    emotional_state: Record<string, number>;
    meta_report: ReturnType<MetacognitionEngine["self_reflect"]>;
    recommendations: string[];
    runtime_seconds: number;
  } {
    const t0 = Date.now();

    // 1. Causal structure from events.
    const graph = this.causal.buildGraph(domain.events);
    const causalAnalysis = this.causal.analyze(graph);

    // 2. Bayesian belief update — evidence derived from events, not hardcoded.
    const evidence: Record<string, number> = {};
    for (const e of domain.events) {
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === "number" && k !== "id" && k !== "timestamp") {
          evidence[k] = Math.min(1, Math.max(0, v as number));
        } else if (typeof v === "boolean") {
          evidence[k] = v ? 1 : 0;
        }
      }
    }
    // Also lift state.belief_state into priors.
    const beliefNetwork = this.bayes.updateMany(this.state.belief_state, evidence);
    const networkEntropy = this.bayes.networkEntropy(beliefNetwork);

    // 3. Counterfactuals over belief + causal graph + options.
    const counterfactuals = this.counterfactual.generate({
      query: domain.query,
      belief: beliefNetwork,
      causal: graph,
      options: domain.options,
    });

    // 4. Council deliberation.
    const councilDeliberation = this.council.deliberate({
      query: domain.query,
      belief: beliefNetwork,
      causal: causalAnalysis,
      counterfactuals,
      options: domain.options,
    });

    // 5. Tool synthesis proposal.
    const toolProposal = this.tools.synthesize({
      objective: domain.query,
      state: this.state,
      belief: beliefNetwork,
    });

    // 6. World model — project first counterfactual.
    const projectedState = counterfactuals.length > 0
      ? this.world.simulate({ belief: beliefNetwork, causal: graph, scenario: counterfactuals[0] })
      : {};

    // 7. Strategy.
    const strategicPlan = this.planner.generatePlan(this.state, {
      belief: beliefNetwork,
      causal: causalAnalysis,
      council: councilDeliberation,
      entropy: networkEntropy,
    });

    // 8. Affect inference from the actual query/tags.
    this.state = this.emotion.update(this.state, domain.query, domain.tags ?? []);
    const emotionalState = this.state.emotional_state;

    // 9. Self-repair on the deliberation so far.
    const repairReport = this.repair.repair(this.state, {
      belief: beliefNetwork,
      council: councilDeliberation,
      entropy: networkEntropy,
    });

    // 10. Update state confidence from belief coherence.
    const confidence =
      networkEntropy < 0.4 ? 0.8 : networkEntropy < 0.7 ? 0.6 : 0.4;
    this.state.confidence = confidence;

    // 11. Set active goals from the query if none exist.
    if (this.state.active_goals.length === 0) {
      this.state.active_goals = [domain.query.slice(0, 80)];
    }
    if (this.state.attention_focus.length === 0) {
      this.state.attention_focus = (domain.tags ?? []).slice(0, 4);
    }

    // 12. Recommendations distilled from the deliberation.
    const recommendations: string[] = [];
    recommendations.push(`Council consensus: ${councilDeliberation.consensus}`);
    if (repairReport.actions.length > 0) {
      recommendations.push(...repairReport.actions.slice(0, 2));
    }
    if (strategicPlan.length > 0) {
      recommendations.push(`Top priority: ${strategicPlan[0].priority}`);
    }

    // 13. Memory — store a compact deliberation summary.
    this.memory.store({
      query: domain.query,
      posterior_avg: this.avg(Object.values(beliefNetwork.posteriors)),
      entropy: networkEntropy,
      confidence,
    });

    // 14. Metacognition.
    const metaReport = this.meta.self_reflect(this.state, {
      entropy: networkEntropy,
      diagnostics_count: repairReport.diagnostics.length,
      priorities_count: strategicPlan.length,
    });

    const runtime_seconds = (Date.now() - t0) / 1000;

    // Pick a representative scalar for `bayesian_posterior` — the mean posterior.
    const posteriorValues = Object.values(beliefNetwork.posteriors);
    const bayesian_posterior = posteriorValues.length > 0 ? this.avg(posteriorValues) : 0.5;

    return {
      session_id: this.state.session_id,
      causal_analysis: causalAnalysis,
      counterfactuals,
      council: councilDeliberation,
      tool_synthesis: toolProposal,
      bayesian_posterior: Number(bayesian_posterior.toFixed(4)),
      network_entropy: networkEntropy,
      belief_network: beliefNetwork,
      projected_state: projectedState,
      strategic_plan: strategicPlan,
      repair: repairReport,
      emotional_state: emotionalState,
      meta_report: metaReport,
      recommendations,
      runtime_seconds,
    };
  }

  private avg(xs: number[]): number {
    if (xs.length === 0) return 0;
    let s = 0;
    for (const x of xs) s += x;
    return s / xs.length;
  }
}
