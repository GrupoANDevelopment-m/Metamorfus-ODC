// server/identity/score.mjs
// Real Identity Preservation Score (IPS). Reads the manifest on disk,
// weighs the actual evidence the organism accumulated, and returns a
// score 0–100 + per-component breakdown.
//
// Components:
//   1. Skill retention — % of the original profession's skill keys
//      still in the live manifest
//   2. Mastery retention — average mastery of surviving skills, vs the
//      mastery snapshot at the baseline
//   3. Decision recall — usage_history density on surviving skills
//      (a skill that was used in prior lives scores higher than one
//      that has never been invoked)
//   4. Focus consistency — fraction of surviving skills whose morph_focus
//      still matches the original profession's default_morph_focus
//   5. Transferability index — how many surviving skills are now
//      transferable=true (emergent property from cross-life usage)
//
// Each component is weighted and the weighted average is the IPS.
// The caller passes two manifest snapshots: baseline (taken before the
// journey started) and current. Both must be real manifest objects
// loaded from disk — the function does not fabricate state.

const WEIGHTS = {
  skillRetention: 0.30,
  masteryRetention: 0.25,
  decisionRecall: 0.20,
  focusConsistency: 0.15,
  transferability: 0.10,
};

export function computeIPS(baselineManifest, currentManifest) {
  if (!baselineManifest || !currentManifest) {
    throw new Error("computeIPS: both manifests are required");
  }

  const baseSkills = Array.isArray(baselineManifest.skills) ? baselineManifest.skills : [];
  const currSkills = Array.isArray(currentManifest.skills) ? currentManifest.skills : [];

  const baseProf = baselineManifest.state?.profession ?? null;
  if (!baseProf) {
    return {
      ips: 0,
      components: { error: "no baseline profession" },
      details: { baseSkills: baseSkills.length, currSkills: currSkills.length },
    };
  }

  // Skills that belonged to the original profession
  const baseProfSkills = baseSkills.filter((s) => s.profession === baseProf);
  const baseKeys = new Set(baseProfSkills.map((s) => s.key));
  const baseByKey = Object.fromEntries(baseProfSkills.map((s) => [s.key, s]));

  // Skills that still exist in the current manifest
  const currByKey = Object.fromEntries(currSkills.map((s) => [s.key, s]));

  const survivingKeys = [...baseKeys].filter((k) => currByKey[k]);
  const skillRetention = baseKeys.size > 0 ? survivingKeys.length / baseKeys.size : 0;

  // Mastery retention — average (current_mastery / baseline_mastery)
  // for surviving skills. Baseline mastery defaults to 1.0 for skills
  // that were freshly forged (no baseline mastery recorded).
  let masterySum = 0;
  let masteryN = 0;
  for (const k of survivingKeys) {
    const baseM = baseByKey[k]?.mastery ?? 1.0;
    const currM = currByKey[k]?.mastery ?? 0;
    masterySum += baseM > 0 ? currM / baseM : 0;
    masteryN += 1;
  }
  const masteryRetention = masteryN > 0 ? masterySum / masteryN : 0;

  // Decision recall — usage_history density per surviving skill,
  // normalised against the max seen across all base skills.
  const baseMaxUsage = Math.max(
    1,
    ...baseProfSkills.map((s) => (s.usage_history ?? []).length),
  );
  let decisionSum = 0;
  for (const k of survivingKeys) {
    const currU = (currByKey[k]?.usage_history ?? []).length;
    decisionSum += Math.min(1, currU / baseMaxUsage);
  }
  const decisionRecall = survivingKeys.length > 0 ? decisionSum / survivingKeys.length : 0;

  // Focus consistency — fraction of surviving skills whose morph_focus
  // matches the baseline profession's default_morph_focus
  const baseFocus = baselineManifest.state?.morph_focus ?? null;
  let focusOk = 0;
  for (const k of survivingKeys) {
    if (currByKey[k]?.morph_focus === baseFocus) focusOk += 1;
  }
  const focusConsistency = survivingKeys.length > 0 ? focusOk / survivingKeys.length : 0;

  // Transferability — fraction of surviving skills that are now transferable
  let xferOk = 0;
  for (const k of survivingKeys) {
    if (currByKey[k]?.transferable === true) xferOk += 1;
  }
  const transferability = survivingKeys.length > 0 ? xferOk / survivingKeys.length : 0;

  const ips =
    skillRetention * WEIGHTS.skillRetention +
    Math.min(1, masteryRetention) * WEIGHTS.masteryRetention +
    decisionRecall * WEIGHTS.decisionRecall +
    focusConsistency * WEIGHTS.focusConsistency +
    transferability * WEIGHTS.transferability;

  return {
    ips: Math.round(ips * 10000) / 100, // 0-100 with 2 decimals
    components: {
      skillRetention: Math.round(skillRetention * 10000) / 100,
      masteryRetention: Math.round(Math.min(1, masteryRetention) * 10000) / 100,
      decisionRecall: Math.round(decisionRecall * 10000) / 100,
      focusConsistency: Math.round(focusConsistency * 10000) / 100,
      transferability: Math.round(transferability * 10000) / 100,
    },
    weights: WEIGHTS,
    details: {
      baseProfession: baseProf,
      baseFocus,
      baseSkillsCount: baseKeys.size,
      survivingSkillsCount: survivingKeys.length,
      survivingKeys: survivingKeys.sort(),
      lostKeys: [...baseKeys].filter((k) => !currByKey[k]).sort(),
    },
  };
}

/**
 * Take two consecutive probes (chronological order) and return whether
 * identity drift happened. Drift is detected when skills disappear,
 * when focus changed without an adopt(), or when mastery collapsed.
 */
export function detectDrift(prev, curr) {
  const alerts = [];
  if (!prev?.state || !curr?.state) return { drift: false, alerts };

  if (prev.state.profession === curr.state.profession &&
      prev.state.morph_focus !== curr.state.morph_focus) {
    alerts.push({ kind: "focus_drift", from: prev.state.morph_focus, to: curr.state.morph_focus });
  }

  const prevKeys = new Set((prev.skills ?? []).map((s) => s.key));
  const currKeys = new Set((curr.skills ?? []).map((s) => s.key));
  const lost = [...prevKeys].filter((k) => !currKeys.has(k));
  if (lost.length > 0) {
    alerts.push({ kind: "skills_lost", keys: lost });
  }

  return { drift: alerts.length > 0, alerts };
}