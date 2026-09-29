/**
 * Skill bodies for each profession's seed skills. Kept separate from
 * `professions.ts` so the bodies stay readable.
 *
 * Convention:
 *   • python skills expose `def skill(organism, context)`
 *   • javascript skills expose `function skill(organism, context)`
 *   • shell skills are single-line bash pipelines
 *   • spec skills are reference data with no executable body
 *   • each seed carries `reactivation_triggers` so dormant skills can
 *     wake on context match and earn transferable=true
 *
 * Each seed now carries `reactivation_triggers` — context tokens that
 * wake the skill while it's dormant (i.e., during a metamorphosis into
 * a profession whose current focus doesn't match this skill's focus).
 */

import type { SkillRuntime, SkillPayload } from "./types.js";

export interface SeedSpec {
  /** Default runtime — overridable at the profession level. */
  runtime: SkillRuntime;
  /** Runtime-specific payload. */
  payload: SkillPayload;
  /** Default reactivation_triggers; can be overridden at the skill level. */
  reactivation_triggers: string[];
}

const PY = (source: string): SkillPayload => ({ source } as SkillPayload);
const JS = (source: string): SkillPayload => ({ source } as SkillPayload);
const SH = (command: string): SkillPayload => ({ command } as SkillPayload);
const SP = (content: unknown, format: string): SkillPayload =>
  ({ content, format } as SkillPayload);

export const SEED_SOURCES: Record<string, SeedSpec> = {
  // ─── SCIENTIST ────────────────────────────────────────────────────────
  hypothesis_protocol: {
    runtime: "python",
    reactivation_triggers: ["surprise", "anomaly", "why", "unexpected"],
    payload: PY(`
def skill(organism, context):
    """Form a falsifiable hypothesis from an observation.

    Originally forged by: scientist.adopt
    Reactivation triggers: surprise, anomaly, why, unexpected
    """
    observation = context.get("observation", "")
    return {
        "action": "FORM_HYPOTHESIS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 25},
        "version": 1,
        "params": {"observation": observation, "falsifiable": True}
    }
`.trim()),
  },

  experimental_design_protocol: {
    runtime: "python",
    reactivation_triggers: ["comparison", "controlled", "control", "baseline"],
    payload: PY(`
def skill(organism, context):
    """Design an experiment to test a hypothesis.

    Originally forged by: scientist.adopt
    Reactivation triggers: comparison, controlled, control, baseline
    """
    hypothesis = context.get("hypothesis", "")
    return {
        "action": "DESIGN_EXPERIMENT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"hypothesis": hypothesis, "controls": True}
    }
`.trim()),
  },

  peer_review_protocol: {
    runtime: "python",
    reactivation_triggers: ["critique", "review", "feedback", "objection"],
    payload: PY(`
def skill(organism, context):
    """Review a colleague's claim for rigor.

    Originally forged by: scientist.adopt
    Reactivation triggers: critique, review, feedback, objection
    Note: historically thought non-transferable, but in practice it
    wakes up in any profession when someone submits work for review.
    """
    claim = context.get("claim", "")
    return {
        "action": "PEER_REVIEW",
        "intensity": 0.5,
        "required_attributes": {"cpu": 30},
        "version": 1,
        "params": {"claim": claim}
    }
`.trim()),
  },

  // ─── LUMBERJACK ───────────────────────────────────────────────────────
  fell_tree_protocol: {
    runtime: "python",
    reactivation_triggers: ["fall", "fell", "storm", "emergency"],
    payload: PY(`
def skill(organism, context):
    """Chop down a tree. Pure physical action.

    Originally forged by: lumberjack.adopt
    Reactivation triggers: fall, fell, storm, emergency
    """
    tree_id = context.get("tree_id", "")
    return {
        "action": "FELL_TREE",
        "intensity": 0.9,
        "required_attributes": {"strength": 60, "agility": 20},
        "version": 1,
        "params": {"tree_id": tree_id}
    }
`.trim()),
  },

  sharpen_axe_protocol: {
    runtime: "shell",
    reactivation_triggers: ["edge", "sharpen", "maintenance", "repair"],
    // Real sharpen-axe would be a bash that runs a sharpening routine.
    // We use `true` so the executor can verify the discipline is honoured.
    payload: SH(`echo "sharpen_axe: edge restored" && exit 0`),
  },

  navigate_forest_protocol: {
    runtime: "javascript",
    reactivation_triggers: ["lost", "trail", "bearing", "outdoor", "forest"],
    payload: JS(`
function skill(organism, context) {
  // Pure navigation solver: emit a bearing recommendation.
  return {
    action: "NAVIGATE_FOREST",
    intensity: 0.5,
    required_attributes: { agility: 30 },
    version: 1,
    params: { destination: context.destination || "", bearing_deg: 0 }
  };
}
`.trim()),
  },

  weather_read_protocol: {
    runtime: "spec",
    reactivation_triggers: ["weather", "sky", "wind", "storm", "forecast"],
    // Reference protocol: not executable, just remembered. The cortex
    // can read this as guidance; executors don't invoke it.
    payload: SP(
      {
        title: "weather_read_protocol",
        type: "reference",
        rules: [
          "If cumulus build vertically fast → convective risk",
          "If wind shifts counter-clockwise → incoming front",
          "If pressure drops > 3 hPa/hour → storm within 6 hours",
        ],
      },
      "json",
    ),
  },

  // ─── ARCHITECT ────────────────────────────────────────────────────────
  blueprint_protocol: {
    runtime: "python",
    reactivation_triggers: ["design", "draft", "blueprint", "plan"],
    payload: PY(`
def skill(organism, context):
    """Draft a blueprint from a brief.

    Originally forged by: architect.adopt
    Reactivation triggers: design, draft, blueprint, plan
    """
    brief = context.get("brief", "")
    return {
        "action": "DRAFT_BLUEPRINT",
        "intensity": 0.7,
        "required_attributes": {"cpu": 50},
        "version": 1,
        "params": {"brief": brief}
    }
`.trim()),
  },

  structural_analysis_protocol: {
    runtime: "python",
    reactivation_triggers: ["load", "stress", "span", "collapse"],
    payload: PY(`
def skill(organism, context):
    """Compute load-bearing requirements.

    Originally forged by: architect.adopt
    Reactivation triggers: load, stress, span, collapse
    """
    span = context.get("span_meters", 0)
    return {
        "action": "STRUCTURAL_ANALYSIS",
        "intensity": 0.8,
        "required_attributes": {"cpu": 60},
        "version": 1,
        "params": {"span_meters": span}
    }
`.trim()),
  },

  material_selection_protocol: {
    runtime: "spec",
    reactivation_triggers: ["material", "specs", "substrate", "selection"],
    // Reference data — organism just remembers the rubric.
    payload: SP(
      {
        title: "material_selection_protocol",
        type: "rubric",
        axes: ["load_kg_m2", "exposure", "cost_per_m2", "lifecycle_years"],
        defaults: { load_kg_m2: 200, exposure: "interior", cost_per_m2: 50, lifecycle_years: 30 },
      },
      "json",
    ),
  },
};
