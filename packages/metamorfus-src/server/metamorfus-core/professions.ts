/**
 * Concrete professions the organism can adopt. Each defines:
 *   • a stable name
 *   • a default morph_focus
 *   • a description (the cortex reads it before forging the seeds)
 *   • seed skills — what the cortex should grow when the profession is
 *     adopted. Each seed declares its `runtime` (python | javascript |
 *     shell | wasm | spec) and a runtime-specific `payload`.
 *
 * Seeds carry `version` and `reactivation_triggers`. The latter is
 * honoured by `chooseCandidateSkills` — when the organism is in a
 * profession whose morph_focus does NOT match this skill's focus, the
 * skill is dormant but wakes up if the executor's context matches one
 * of the triggers. Each such wake-up logs a usage_history entry, and
 * the second distinct profession to use it promotes the skill to
 * transferable=true automatically (see decay.ts).
 */

import type { Profession, MorphFocus, AttributeName, SkillRuntime, SkillPayload } from "./types.js";
import { SEED_SOURCES } from "./seed-sources.js";

interface SeedInput {
  key: string;
  version?: number;
  morph_focus?: MorphFocus;
  /** Optional runtime override; otherwise pulled from SEED_SOURCES. */
  runtime?: SkillRuntime;
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

  // ─── T1–T11 SCIENTIFIC TEST BATTERY PROFESSIONS ────────────────────
  // These were added so the scientific test battery (T1 Identity,
  // T2 Transfer, T3 Accumulation, T4 Anti-catastrophe, T5 Generalization,
  // T6 Self-evolution, T9 Reversibility, T10 Transdomain, T11 Supreme)
  // has a multi-domain substrate to work against. Each profession
  // adopts skills that already exist on disk in dna_library/ as
  // forged or builtin entries — there is no parallel system, no
  // mock; the seeds are real skills the cortex can grow on `adopt`.
  {
    name: "meteorologist",
    description:
      "Atmospheric investigator. Grows skills for pressure-gradient analysis, " +
      "front detection, and forecast synthesis. Morph focus: THINK.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "analyze_pressure_gradient_protocol", version: 1, morph_focus: "THINK" },
      { key: "front_detection_protocol", version: 1, morph_focus: "THINK" },
      { key: "forecast_synthesis_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "cybersecurity",
    description:
      "Defensive adversary. Grows skills for port scanning, header auditing, " +
      "and incident logging. Morph focus: HUNT.",
    default_morph_focus: "HUNT",
    seeds: [
      { key: "real_port_scanner_protocol", version: 1, morph_focus: "HUNT" },
      { key: "real_http_header_audit_protocol", version: 1, morph_focus: "HUNT" },
      { key: "real_incident_logger_protocol", version: 1, morph_focus: "HUNT" },
    ],
  },
  {
    name: "engineer",
    description:
      "Builder. Grows skills for load calculation, stress analysis, " +
      "and tolerance design. Morph focus: THINK.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "engineer_load_calc_protocol", version: 1, morph_focus: "THINK" },
      { key: "engineer_stress_analysis_protocol", version: 1, morph_focus: "THINK" },
      { key: "engineer_tolerance_design_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "trader",
    description:
      "Market agent. Grows skills for price fetches, RSI calculation, and " +
      "signal synthesis. Morph focus: HUNT.",
    default_morph_focus: "HUNT",
    seeds: [
      { key: "crypto_price_v2_protocol", version: 1, morph_focus: "HUNT" },
      { key: "rsi_calculator_v2_protocol", version: 1, morph_focus: "HUNT" },
      { key: "signal_synthesis_protocol", version: 1, morph_focus: "HUNT" },
    ],
  },
  {
    name: "doctor",
    description:
      "Clinical investigator. Grows skills for triage, differential diagnosis, " +
      "and treatment synthesis. Morph focus: THINK.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "doctor_triage_protocol", version: 1, morph_focus: "THINK" },
      { key: "doctor_differential_protocol", version: 1, morph_focus: "THINK" },
      { key: "doctor_treatment_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "physicist",
    description:
      "Theoretical modeler. Grows skills for dimensional analysis, " +
      "force-balance, and wave mechanics. Morph focus: THINK.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "physicist_dimensional_protocol", version: 1, morph_focus: "THINK" },
      { key: "physicist_force_balance_protocol", version: 1, morph_focus: "THINK" },
      { key: "physicist_wave_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "archaeologist",
    description:
      "Pattern hunter across time. Grows skills for stratigraphy, artifact " +
      "inference, and chronology. Morph focus: THINK. Reuses scientist's " +
      "hypothesis_protocol via reactivation triggers.",
    default_morph_focus: "THINK",
    seeds: [
      { key: "archaeo_stratigraphy_protocol", version: 1, morph_focus: "THINK" },
      { key: "archaeo_artifact_inference_protocol", version: 1, morph_focus: "THINK" },
      { key: "archaeo_chronology_protocol", version: 1, morph_focus: "THINK" },
    ],
  },
  {
    name: "fraud_analyst",
    description:
      "Anomaly hunter in financial data. Grows skills for transaction " +
      "anomaly detection, network analysis, and pattern reporting. " +
      "Morph focus: HUNT. Reuses cybersecurity's real_port_scanner_protocol " +
      "via reactivation triggers (network-anomaly context).",
    default_morph_focus: "HUNT",
    seeds: [
      { key: "fraud_anomaly_protocol", version: 1, morph_focus: "HUNT" },
      { key: "fraud_network_protocol", version: 1, morph_focus: "HUNT" },
      { key: "fraud_report_protocol", version: 1, morph_focus: "HUNT" },
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
      runtime: seed.runtime ?? spec.runtime,
      payload: spec.payload as SkillPayload,
      reactivation_triggers:
        seed.reactivation_triggers ?? spec.reactivation_triggers,
    };
  }),
}));

export function getProfession(name: string): Profession | undefined {
  return PROFESSIONS.find((p) => p.name === name);
}
