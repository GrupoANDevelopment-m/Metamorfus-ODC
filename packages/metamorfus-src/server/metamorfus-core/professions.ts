/**
 * Concrete professions the organism can adopt. Each defines:
 *   • a stable name
 *   • a default morph_focus
 *   • a description (the cortex reads it before forging the seeds)
 *   • seed skills — what the cortex should grow when the profession is
 *     adopted. Real-world forged skills land as Python files in
 *     `packages/metamorfus-src/dna_library/<key>.py`.
 *
 * Seeds carry `version` and `reactivation_triggers`. The latter is
 * honoured by `chooseCandidateSkills` — when the organism is in a
 * profession whose morph_focus does NOT match this skill's focus, the
 * skill is dormant but wakes up if the executor's context matches one
 * of the triggers. Each such wake-up logs a usage_history entry, and
 * the second distinct profession to use it promotes the skill to
 * transferable=true automatically (see decay.ts).
 */

import type { Profession, MorphFocus, AttributeName } from "./types.js";
import { SEED_SOURCES } from "./seed-sources.js";

interface SeedInput {
  key: string;
  version?: number;
  morph_focus?: MorphFocus;
  /** Optional override; otherwise pulled from SEED_SOURCES. */
  reactivation_triggers?: string[];
  foraged_by?: string;
}

const PROFESSION_DATA: Array<{
  name: string;
  description: string;
  default_morph_focus: MorphFocus;
  seeds: SeedInput[];
}> = [
  {
    name: "scientist",
    description:
      "Reasoning-led investigator. Grows skills for hypothesis, experiment design, " +
      "and peer review. Morph focus: THINK.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "hypothesis_protocol", version: 1, morph_focus: "THINK" },
      { key: "experimental_design_protocol", version: 1, morph_focus: "THINK" },
      { key: "peer_review_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "lumberjack",
    description:
      "Physically led forest worker. Grows skills for tree felling, axe sharpening, " +
      "forest navigation, weather reading. Morph focus: HUNT.",
    default_morph_focus: "HUNT",
    seeds: [
      { key: "fell_tree_protocol", version: 1, morph_focus: "HUNT" },
      { key: "sharpen_axe_protocol", version: 1, morph_focus: "HUNT" },
      { key: "navigate_forest_protocol", version: 1, morph_focus: "HUNT" },
      { key: "weather_read_protocol", version: 1, morph_focus: "HUNT" },
    ],
  },
  {
    name: "architect",
    description:
      "Synthesis-led designer. Grows skills for blueprinting, structural " +
      "analysis, and material selection. Morph focus: THINK. Reuses " +
      "scientist's hypothesis_protocol and lumberjack's weather_read_protocol " +
      "via reactivation triggers.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "blueprint_protocol", version: 1, morph_focus: "THINK" },
      { key: "structural_analysis_protocol", version: 1, morph_focus: "THINK" },
      { key: "material_selection_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
];

export const PROFESSIONS: Profession[] = PROFESSION_DATA.map((p) => ({
  name: p.name,
  description: p.description,
  default_morph_focus: p.default_morph_focus,
  seeds: p.seeds.map((seed) => {
    const spec = SEED_SOURCES[seed.key];
    if (!spec) {
      throw new Error(`Unknown seed key: ${seed.key}`);
    }
    return {
      key: seed.key,
      profession: p.name,
      version: seed.version ?? 1,
      morph_focus: seed.morph_focus ?? p.default_morph_focus,
      foraged_by: seed.foraged_by ?? `${p.name}.adopt`,
      source: spec.source,
      reactivation_triggers:
        seed.reactivation_triggers ?? spec.reactivation_triggers,
    };
  }),
}));

export function getProfession(name: string): Profession | undefined {
  return PROFESSIONS.find((p) => p.name === name);
}
