/**
 * Decay + usage tracking — the temporal layer of the DNA library.
 *
 * The organism's skills are not equally trained:
 *   • mastery decays with time when not used
 *   • mastery rises with each successful use
 *   • transferable is EMERGENT — promoted after the second distinct
 *     profession uses a skill via reactivation.
 *
 * Functions in this module are PURE. They take a manifest and a
 * timestamp, mutate a copy, and return it. Callers persist the result.
 */

import type {
  SkillManifest,
  SkillStatus,
} from "./types.js";

/** Half-life of an unused skill, in seconds. After 30 days of disuse,
 * mastery halves. After 60 days, quarter. After 90 days, eighth. Decay
 * stops at MASTERY_FLOOR so dormant knowledge is never fully lost. */
export const DECAY_HALF_LIFE_SEC = 30 * 24 * 60 * 60;
export const MASTERY_FLOOR = 0.05;
/** Mastery gain per successful use. Logarithmic, so late gains cost more. */
export const MASTERY_GAIN_PER_USE = 0.1;
/** Mastery cap. */
export const MASTORY_CEILING = 1.0;
/** Skills below this mastery are tagged "decayed". */
export const DECAY_STATUS_THRESHOLD = 0.2;
/** Skills with mastery >= this are tagged "active" again when other
 * conditions are met. */
export const ACTIVE_STATUS_THRESHOLD = 0.7;
/** Number of distinct professions in usage_history that triggers a
 * transferability promotion. */
export const TRANSFERABLE_PROMOTION_AT = 2;

/**
 * Per-profession decay profile. Different professions decay at different
 * rates — a lumberjack's axe-sharpening atrophies faster than a
 * scientist's hypothesis-formulation, because the latter is more
 * cognitive. The defaults in the constants above apply when a profession
 * has no explicit profile.
 *
 * Lookup by profession name; falls back to the default profile if
 * the profession isn't registered.
 */
export interface DecayProfile {
  /** Half-life in seconds for THIS profession's skills. */
  halfLifeSec: number;
  /** Mastery gain per use. */
  gainPerUse: number;
  /** Mastery floor. */
  floor: number;
  /** Mastery ceiling. */
  ceiling: number;
  /** Below this mastery, the skill is tagged "decayed". */
  statusThreshold: number;
  /** At or above this mastery (with recent use), the skill is "active". */
  activeThreshold: number;
}

export const DEFAULT_DECAY_PROFILE: DecayProfile = {
  halfLifeSec: DECAY_HALF_LIFE_SEC,
  gainPerUse: MASTERY_GAIN_PER_USE,
  floor: MASTERY_FLOOR,
  ceiling: MASTORY_CEILING,
  statusThreshold: DECAY_STATUS_THRESHOLD,
  activeThreshold: ACTIVE_STATUS_THRESHOLD,
};

/**
 * Per-profession decay profiles. Each profession can override the
 * global defaults to model domain-specific atrophy rates. Add or
 * tweak entries here to tune how each profession forgets.
 */
export const PROFESSION_DECAY_PROFILES: Record<string, DecayProfile> = {
  // Physical professions: skills rust faster if unused.
  lumberjack: {
    halfLifeSec: 14 * 24 * 60 * 60, // 14 days
    gainPerUse: 0.08,
    floor: 0.05,
    ceiling: 1.0,
    statusThreshold: 0.25,
    activeThreshold: 0.7,
  },
  // Cognitive professions: skills hold longer (more transferable).
  scientist: {
    halfLifeSec: 90 * 24 * 60 * 60, // 90 days
    gainPerUse: 0.12,
    floor: 0.08,
    ceiling: 1.0,
    statusThreshold: 0.15,
    activeThreshold: 0.6,
  },
  architect: {
    halfLifeSec: 60 * 24 * 60 * 60, // 60 days
    gainPerUse: 0.1,
    floor: 0.05,
    ceiling: 1.0,
    statusThreshold: 0.2,
    activeThreshold: 0.65,
  },
};

/** Look up a decay profile by profession name, with default fallback. */
export function decayProfileFor(profession: string): DecayProfile {
  return PROFESSION_DECAY_PROFILES[profession] ?? DEFAULT_DECAY_PROFILE;
}

/**
 * Recompute status from mastery + recency.
 *
 *   mastery >= 0.7 AND last_used_at within RECENT_USE_WINDOW   → "active"
 *   mastery >= 0.2                                              → "dormant"
 *   mastery <  0.2                                              → "decayed"
 *   (older version of a re-forged skill is set externally to "archaeology")
 */
export const RECENT_USE_WINDOW_SEC = 7 * 24 * 60 * 60;

export function computeStatus(m: SkillManifest, nowMs: number): SkillStatus {
  if (m.status === "archaeology") return "archaeology";
  if (m.mastery < DECAY_STATUS_THRESHOLD) return "decayed";
  if (m.mastery >= ACTIVE_STATUS_THRESHOLD) {
    if (!m.last_used_at) return "dormant"; // unused since forge; fluency but no proof
    const delta = (nowMs - new Date(m.last_used_at).getTime()) / 1000;
    if (delta <= RECENT_USE_WINDOW_SEC) return "active";
  }
  return "dormant";
}

/**
 * Apply time-based mastery decay to a single skill. Pure.
 *
 *   mastery' = max(profile.floor, mastery * 0.5 ^ (elapsed_seconds / profile.halfLifeSec))
 *
 * The profile is looked up by the skill's `profession` so each
 * profession can have its own atrophy rate. Falls back to the global
 * defaults if the profession has no explicit profile.
 */
export function decayMastery(
  m: SkillManifest,
  nowMs: number,
  profile: DecayProfile = DEFAULT_DECAY_PROFILE,
): SkillManifest {
  if (m.status === "archaeology") return m;
  const refMs = m.last_used_at
    ? new Date(m.last_used_at).getTime()
    : new Date(m.forged_at).getTime();
  const elapsedSec = Math.max(0, (nowMs - refMs) / 1000);
  if (elapsedSec === 0) return m;
  const factor = Math.pow(0.5, elapsedSec / profile.halfLifeSec);
  const next = Math.max(profile.floor, m.mastery * factor);
  if (next === m.mastery) return m;
  return { ...m, mastery: next };
}

/**
 * Recompute status from mastery + recency, using the given profile.
 */
export function computeStatusWithProfile(
  m: SkillManifest,
  nowMs: number,
  profile: DecayProfile = DEFAULT_DECAY_PROFILE,
): SkillStatus {
  if (m.status === "archaeology") return "archaeology";
  if (m.mastery < profile.statusThreshold) return "decayed";
  if (m.mastery >= profile.activeThreshold) {
    if (!m.last_used_at) return "dormant";
    const delta = (nowMs - new Date(m.last_used_at).getTime()) / 1000;
    if (delta <= RECENT_USE_WINDOW_SEC) return "active";
  }
  return "dormant";
}

/**
 * Apply decay to every skill in the manifest. Returns a shallow copy of
 * the manifest with each skill recomputed. Uses the profession-specific
 * profile for each skill.
 */
export function applyDecay(
  skills: SkillManifest[],
  nowMs: number = Date.now(),
): SkillManifest[] {
  return skills.map((s) => {
    const profile = decayProfileFor(s.profession);
    const decayed = decayMastery(s, nowMs, profile);
    const status = computeStatusWithProfile(decayed, nowMs, profile);
    return decayed.status === status ? decayed : { ...decayed, status };
  });
}

/**
 * Record that a skill was just used by a specific profession with a
 * specific context. This is the ONLY way mastery rises and transferable
 * gets promoted. Pure — returns a new manifest entry.
 *
 * Internal use (byProfession === skill.profession) boosts mastery and
 * records the event, but does NOT count toward transferable promotion —
 * using a skill in its native profession proves nothing about
 * transferability. Only a use by a DIFFERENT profession counts toward
 * the TRANSFERABLE_PROMOTION_AT threshold.
 */
export function recordUse(
  m: SkillManifest,
  byProfession: string,
  context: string,
  nowMs: number = Date.now(),
): SkillManifest {
  const now = new Date(nowMs).toISOString();
  const isExternal = byProfession !== m.profession;
  const previousExternals = new Set(
    m.usage_history
      .filter((u) => u.by_profession !== m.profession)
      .map((u) => u.by_profession),
  );
  const distinctExternal = new Set(previousExternals);
  if (isExternal) distinctExternal.add(byProfession);
  const transferable = m.transferable || distinctExternal.size >= TRANSFERABLE_PROMOTION_AT;
  const mastery = m.mastery + MASTERY_GAIN_PER_USE * (1 - m.mastery);
  const usage_history = [
    ...m.usage_history,
    { at: now, by_profession: byProfession, context },
  ];
  const updated: SkillManifest = {
    ...m,
    mastery: Math.min(MASTORY_CEILING, mastery),
    last_used_at: now,
    usage_history,
    transferable,
  };
  return {
    ...updated,
    status: computeStatus(updated, nowMs),
  };
}

/**
 * Apply a usage event across a whole manifest (returns a new array).
 * Convenience wrapper used by adopt() and by the Executor.
 */
export function recordUseAcross(
  skills: SkillManifest[],
  skillKey: string,
  byProfession: string,
  context: string,
  nowMs: number = Date.now(),
): SkillManifest[] {
  return skills.map((s) =>
    s.key === skillKey ? recordUse(s, byProfession, context, nowMs) : s,
  );
}
