/**
 * Metamorfus core — the meta-organism layer that tracks professions,
 * morph_focus, and the persistent DNA library.
 *
 * Open skill schema (round 3):
 *   Skills are NOT just Python source. A skill is any executable
 *   artifact that carries memory. The DNA library stores skills with
 *   a typed `runtime` and an opaque `payload` shaped by that runtime.
 *
 *   runtime = "python" | "javascript" | "wasm" | "shell" | "spec"
 *
 *   "spec" is a non-executable skill (data, schema, reference) — for
 *   cases where the organism just needs to remember a concept without
 *   being able to run it (e.g., a reference protocol, a glossary, a
 *   configuration template).
 *
 *   payload shape:
 *     python      { source: string }
 *     javascript  { source: string }
 *     wasm        { bytes_ref: string, exports: string[] }
 *     shell       { command: string }
 *     spec        { content: unknown, format: string }
 *
 *   Other runtimes can be added without changing the schema — only
 *   the swarm dispatch table needs to know.
 */

export type MorphFocus =
  | "BALANCED"
  | "HUNT"
  | "THINK"
  | "GATHER"
  | "TRADE"
  | "ESCAPE";

export type AttributeName = "cpu" | "strength" | "agility";

export type SkillRuntime = "python" | "javascript" | "wasm" | "shell" | "spec";

export interface Intention {
  action: string;
  intensity: number;
  required_attributes: Partial<Record<AttributeName, number>>;
  version: number;
  params?: Record<string, unknown>;
}

/**
 * A skill is any executable artifact that carries memory. The
 * `runtime` field tells the swarm how to invoke it; the `payload`
 * shape depends on the runtime.
 *
 * IMPORTANT: the same skill key may appear multiple times in `skills[]`
 * because re-forging produces version-bumped copies. Older versions are
 * not deleted. The *latest* matching entry is the active version; the
 * rest is archaeology that the cortex can read for context but not invoke.
 */
export interface SkillManifest {
  /** Snake_case key, must end with _protocol. */
  key: string;
  /** Profession that forged this skill. */
  profession: string;
  /** Skill version. Monotonically increases when re-forged. */
  version: number;
  /** Runtime that knows how to execute this skill. */
  runtime: SkillRuntime;
  /**
   * Runtime-specific payload.
   *   python      → { source: string }
   *   javascript  → { source: string }
   *   wasm        → { bytes_ref: string, exports: string[] }
   *   shell       → { command: string }
   *   spec        → { content: unknown, format: string }
   */
  payload: SkillPayload;
  /** ISO timestamp when forged. */
  forged_at: string;
  /** who/what forged this. */
  foraged_by?: string;
  /** Morph_focus that activates this skill most strongly. */
  morph_focus: MorphFocus;

  // ─── Conceptual additions (round 2) ──────────────────────────────

  /**
   * Fluency in this skill. 0.0 = forgotten muscle memory, 1.0 = mastery.
   * Starts at 0.5 (half-trained) when forged. Decays with time, rises
   * with each successful use via `recordUse`.
   */
  mastery: number;
  /** ISO timestamp of last use, or null if never used after forge. */
  last_used_at: string | null;
  /**
   * Append-only history of each cross-profession reactivation. The
   * `profession` field tells the engine who used the skill; the engine
   * uses this to promote the skill to `transferable=true` after the
   * second distinct profession.
   */
  usage_history: Array<{ at: string; by_profession: string; context: string }>;
  /**
   * Whether this skill has earned cross-profession relevance. Set to
   * false at forge. Becomes true after `recordUse` is called by a
   * SECOND distinct profession. Reversible only by the user explicitly
   * editing the manifest — never automatically cleared by the engine.
   */
  transferable: boolean;
  /**
   * Context patterns that wake this skill while dormant. When the
   * Executor asks "what should I do for context X", any dormant skill
   * whose trigger patterns match X is reactivated on the fly.
   */
  reactivation_triggers: string[];
  /** Computed by the engine — not editable. */
  status: SkillStatus;
  /**
   * Free-form metadata. Use this for domain-specific extras without
   * changing the schema: tags, source attribution, weight, etc.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Discriminated union for skill payloads. The swarm dispatch picks one
 * based on `runtime`; new runtimes can be added by extending this union.
 */
export type SkillPayload =
  | { source: string }
  | { source: string }
  | { bytes_ref: string; exports: string[] }
  | { command: string }
  | { content: unknown; format: string };

/**
 * Type guards per runtime. Callers should narrow `payload` with these
 * before using its fields.
 */
export function isPythonPayload(p: SkillPayload): p is { source: string } {
  return typeof (p as { source?: unknown }).source === "string";
}
export function isJavascriptPayload(p: SkillPayload): p is { source: string } {
  return typeof (p as { source?: unknown }).source === "string";
}
export function isWasmPayload(p: SkillPayload): p is { bytes_ref: string; exports: string[] } {
  const w = p as { bytes_ref?: unknown; exports?: unknown };
  return typeof w.bytes_ref === "string" && Array.isArray(w.exports);
}
export function isShellPayload(p: SkillPayload): p is { command: string } {
  return typeof (p as { command?: unknown }).command === "string";
}
export function isSpecPayload(p: SkillPayload): p is { content: unknown; format: string } {
  const s = p as { content?: unknown; format?: unknown };
  return s.content !== undefined && typeof s.format === "string";
}

/**
 * Extracts the source string from any payload that has one
 * (python / javascript / shell). Used by legacy code paths that still
 * treat `source` as the canonical field.
 */
export function payloadSource(p: SkillPayload): string | undefined {
  if (isPythonPayload(p) || isJavascriptPayload(p) || isShellPayload(p)) {
    return p.source ?? (p as { command?: string }).command;
  }
  return undefined;
}

export type SkillStatus =
  /** Active and fluent. mastery > 0.7 and last_used within window. */
  | "active"
  /** Known but not currently invoked. Reactivated on context match. */
  | "dormant"
  /** Decayed. Very low mastery. Still in library, not normally reachable. */
  | "decayed"
  /** Older version of a re-forged skill. Visible to introspection only. */
  | "archaeology";

/**
 * A bundle of skills + focus that the cortex adopts when entering a
 * profession. The seeds are the skills the cortex forges upon
 * adoption. Real-world forged skills land as executable artifacts in
 * the DNA library.
 */
export interface Profession {
  /** Stable identifier (snake_case). */
  name: string;
  /** Human-friendly description (read by cortex before forging seeds). */
  description: string;
  /** Default morph_focus for this profession. */
  default_morph_focus: MorphFocus;
  /** Skills the cortex forges when this profession is adopted. */
  seeds: Array<{
    key: string;
    profession: string;
    version: number;
    morph_focus: MorphFocus;
    runtime: SkillRuntime;
    payload: SkillPayload;
    reactivation_triggers: string[];
    foraged_by?: string;
  }>;
}

export interface MetamorphState {
  profession: string;
  morph_focus: MorphFocus;
  /** Total unique skill KEYS ever forged (matches across versions). */
  cumulative_skill_count: number;
  /** Distinct skills currently reactivated or fluent. Computed on demand. */
  active_skill_keys: string[];
  /** Skills preserved from prior professions (still in DNA library). */
  retained_from_past_professions: string[];
  /** Currently-decayed skills (computed at choice-time). */
  decayed_skills: string[];
  /**
   * History of every profession adopted, in chronological order.
   * Enables A→B→C→A reversibility: any past profession is reachable.
   */
  profession_chain: string[];
}

/** A context object passed by the Executor when asking which skills apply. */
export interface SkillSelectorContext {
  /** Free-form text the cortex / executor is currently reasoning about. */
  text: string;
  /** Optional tags the executor already knows. */
  tags?: string[];
}

/**
 * Decide which skills the Executor should consider as candidates for the
 * current state. Order:
 *   1. Active profession's skills whose morph_focus matches state.morph_focus
 *   2. Dormant skills whose reactivation_triggers match context
 *   3. Transferable skills (any profession)
 *
 * Archaeology is NOT included. Decayed skills are AT BEST included
 * if their triggers strongly match context.
 */
export function chooseCandidateSkills(
  manifest: SkillManifest[],
  state: MetamorphState,
  context: SkillSelectorContext,
): SkillManifest[] {
  const text = (context.text ?? "").toLowerCase();
  const tags = new Set((context.tags ?? []).map((t) => t.toLowerCase()));
  const focus = state.morph_focus;

  return manifest.filter((m) => {
    if (m.status === "archaeology") return false;
    if (m.profession === state.profession && m.morph_focus === focus) return true;
    if (m.transferable) return true;
    if (m.status === "dormant") {
      // Reactivate if any trigger token matches the context text or tags.
      for (const trig of m.reactivation_triggers) {
        if (text.includes(trig.toLowerCase())) return true;
        if (tags.has(trig.toLowerCase())) return true;
      }
    }
    if (m.status === "decayed") {
      // Only reactivate decayed skills on exact-tag match (rare wakeup).
      for (const trig of m.reactivation_triggers) {
        if (tags.has(trig.toLowerCase())) return true;
      }
    }
    return false;
  });
}
