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
 *   mastery' = max(MASTERY_FLOOR, mastery * 0.5 ^ (elapsed_seconds / HALF_LIFE))
 */
export function decayMastery(m: SkillManifest, nowMs: number): SkillManifest {
  if (m.status === "archaeology") return m;
  const refMs = m.last_used_at
    ? new Date(m.last_used_at).getTime()
    : new Date(m.forged_at).getTime();
  const elapsedSec = Math.max(0, (nowMs - refMs) / 1000);
  if (elapsedSec === 0) return m;
  const factor = Math.pow(0.5, elapsedSec / DECAY_HALF_LIFE_SEC);
  const next = Math.max(MASTERY_FLOOR, m.mastery * factor);
  if (next === m.mastery) return m;
  return { ...m, mastery: next };
}

/**
 * Apply decay to every skill in the manifest. Returns a shallow copy of
 * the manifest with each skill recomputed.
 */
export function applyDecay(
  skills: SkillManifest[],
  nowMs: number = Date.now(),
): SkillManifest[] {
  return skills.map((s) => {
    const decayed = decayMastery(s, nowMs);
    const status = computeStatus(decayed, nowMs);
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
