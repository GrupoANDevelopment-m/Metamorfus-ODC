/**
 * Metamorfus core — the meta-organism layer that tracks professions,
 * morph_focus, and the persistent DNA library.
 *
 * Conceptual model (refined against the operator's brief):
 *
 *   Profession   — a bundle of related skills + an active morph_focus.
 *                  Tags skills with the profession they originated from.
 *
 *   Morph_Focus  — what the organism is OPTIMIZED for THIS moment. It
 *                  does NOT delete other skills from view; it gates
 *                  which skills the Executor sees as ACTIVE. Dormant
 *                  skills wake when context matches a reactivation
 *                  trigger — like a scientist who is a lumberjack but
 *                  remembers hypotheses when a tree falls unexpectedly.
 *
 *   DNA Library  — append-only, NEVER ERASES. Forgetting is physically
 *                  impossible. Every forged skill lands here FOREVER,
 *                  including older versions of re-forged skills (which
 *                  become "archaeology" the cortex can introspect).
 *
 *   Transferable skill — a skill that has been proven useful in more
 *                  than one profession. Transferability is EMERGENT,
 *                  not stamped at forge time. The first time another
 *                  profession uses a dormant skill via reactivation,
 *                  the usage_history grows. After N >= 2 distinct
 *                  professions in usage_history, the skill is promoted
 *                  to transferable=true by `recordUse`.
 *
 *   Mastery     — numeric (0.0-1.0). Decays with time, rises with use.
 *                  The organism is not equally fluent in all skills.
 *
 *   A metamorphosis is the act of changing profession. The organism's
 *   total knowledge DOES NOT shrink. It only re-weights.
 */

export type MorphFocus =
  | "BALANCED"
  | "HUNT"
  | "THINK"
  | "GATHER"
  | "TRADE"
  | "ESCAPE";

export type AttributeName = "cpu" | "strength" | "agility";

export interface Intention {
  action: string;
  intensity: number;
  required_attributes: Partial<Record<AttributeName, number>>;
  version: number;
  params?: Record<string, unknown>;
}

/**
 * One historical entry in the DNA library.
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
  /** Origin source code (Python). */
  source: string;
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
   * For example, a hypothesis_protocol forged as a scientist might
   * declare the trigger `"surprise"`, so when the architect encounters
   * an unexpected structural finding, the dormant hypothesis skill
   * wakes up.
   */
  reactivation_triggers: string[];
  /** Computed by the engine — not editable. */
  status: SkillStatus;
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
 * Tracks the active profession and morph_focus at any moment.
 */
/**
 * A bundle of skills + focus that the cortex adopts when entering a
 * profession. The seeds are the skills the cortex forges upon
 * adoption. Real-world skills land as Python files in the DNA library.
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
    source: string;
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
