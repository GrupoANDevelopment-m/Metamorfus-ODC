/**
 * Python source bodies for each profession's seed skills. Kept separate
 * from `professions.ts` so the bodies stay readable.
 *
 * Convention:
 *   • def skill(organism, context) signature (matches forge_skill validator)
 *   • returns an intention dict
 *   • docstring at the top
 *
 * Each seed now carries `reactivation_triggers` — context tokens that
 * wake the skill while it's dormant (i.e., during a metamorphosis into
 * a profession whose current focus doesn't match this skill's focus).
 * For example, a hypothesis_protocol forged by a scientist has the
 * trigger "surprise", so when an architect encounters an unexpected
 * structural finding, the dormant hypothesis skill wakes up — and the
 * organism logs the cross-profession use, which eventually promotes
 * the skill to transferable=true.
 */

export interface SeedSpec {
  source: string;
  /** Default reactivation_triggers; can be overridden at the skill level. */
  reactivation_triggers: string[];
}

export const SEED_SOURCES: Record<string, SeedSpec> = {
  // ─── SCIENTIST ────────────────────────────────────────────────────────
  hypothesis_protocol: {
    reactivation_triggers: ["surprise", "anomaly", "why", "unexpected"],
    source: `
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
`.trim(),
  },

  experimental_design_protocol: {
    reactivation_triggers: ["comparison", "controlled", "control", "baseline"],
    source: `
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
`.trim(),
  },

  peer_review_protocol: {
    reactivation_triggers: ["critique", "review", "feedback", "objection"],
    source: `
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
`.trim(),
  },

  // ─── LUMBERJACK ───────────────────────────────────────────────────────
  fell_tree_protocol: {
    reactivation_triggers: ["fall", "fell", "storm", "emergency"],
    source: `
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
`.trim(),
  },

  sharpen_axe_protocol: {
    reactivation_triggers: ["edge", "sharpen", "maintenance", "repair"],
    source: `
def skill(organism, context):
    """Maintain the edge. Tool care.

    Originally forged by: lumberjack.adopt
    Reactivation triggers: edge, sharpen, maintenance, repair
    """
    return {
        "action": "SHARPEN_AXE",
        "intensity": 0.4,
        "required_attributes": {"strength": 10},
        "version": 1
    }
`.trim(),
  },

  navigate_forest_protocol: {
    reactivation_triggers: ["lost", "trail", "bearing", "outdoor", "forest"],
    source: `
def skill(organism, context):
    """Read trails, find bearings, return home.

    Originally forged by: lumberjack.adopt
    Reactivation triggers: lost, trail, bearing, outdoor, forest
    """
    destination = context.get("destination", "")
    return {
        "action": "NAVIGATE_FOREST",
        "intensity": 0.5,
        "required_attributes": {"agility": 30},
        "version": 1,
        "params": {"destination": destination}
    }
`.trim(),
  },

  weather_read_protocol: {
    reactivation_triggers: ["weather", "sky", "wind", "storm", "forecast"],
    source: `
def skill(organism, context):
    """Read sky, wind, pressure to predict weather.

    Originally forged by: lumberjack.adopt
    Reactivation triggers: weather, sky, wind, storm, forecast
    """
    return {
        "action": "READ_WEATHER",
        "intensity": 0.3,
        "required_attributes": {"cpu": 10},
        "version": 1
    }
`.trim(),
  },

  // ─── ARCHITECT ────────────────────────────────────────────────────────
  blueprint_protocol: {
    reactivation_triggers: ["design", "draft", "blueprint", "plan"],
    source: `
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
`.trim(),
  },

  structural_analysis_protocol: {
    reactivation_triggers: ["load", "stress", "span", "collapse"],
    source: `
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
`.trim(),
  },

  material_selection_protocol: {
    reactivation_triggers: ["material", "specs", "substrate", "selection"],
    source: `
def skill(organism, context):
    """Pick materials from a constraint set.

    Originally forged by: architect.adopt
    Reactivation triggers: material, specs, substrate, selection
    """
    constraints = context.get("constraints", {})
    return {
        "action": "SELECT_MATERIALS",
        "intensity": 0.6,
        "required_attributes": {"cpu": 40},
        "version": 1,
        "params": {"constraints": constraints}
    }
`.trim(),
  },
};
