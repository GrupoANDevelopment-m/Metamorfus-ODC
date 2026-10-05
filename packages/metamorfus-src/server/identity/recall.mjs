// server/identity/recall.mjs
// Real decision recovery. Reads the manifest's usage_history and
// reconstructs what the organism actually did in past lives — what
// skill it used, when, in which profession, with what result, and
// what subsequent skill chain it triggered.
//
// No fabrication. Every field comes from the manifest on disk.

export function recallSkill(manifest, skillKey) {
  if (!manifest || !Array.isArray(manifest.skills)) return null;
  const skill = manifest.skills.find((s) => s.key === skillKey);
  if (!skill) return null;

  const usage = Array.isArray(skill.usage_history) ? skill.usage_history : [];

  // Unique professions that ever used this skill
  const professionsEverUsed = [...new Set(
    usage.map((u) => u.by_profession).filter(Boolean),
  )];

  // Last decision (most recent usage)
  const lastUse = usage.length > 0 ? usage[usage.length - 1] : null;

  // Per-profession decision summary
  const byProfession = {};
  for (const u of usage) {
    const p = u.by_profession ?? "unknown";
    if (!byProfession[p]) byProfession[p] = { count: 0, lastAt: null, lastResult: null };
    byProfession[p].count += 1;
    if (!byProfession[p].lastAt || u.at > byProfession[p].lastAt) {
      byProfession[p].lastAt = u.at;
      byProfession[p].lastResult = u.result ?? null;
    }
  }

  // Success rate if outcomes were recorded
  const withOutcomes = usage.filter((u) => typeof u.outcome === "number");
  const successRate = withOutcomes.length > 0
    ? withOutcomes.reduce((a, u) => a + (u.outcome > 0 ? 1 : 0), 0) / withOutcomes.length
    : null;

  return {
    key: skillKey,
    profession: skill.profession ?? null,
    morph_focus: skill.morph_focus ?? null,
    status: skill.status ?? null,
    mastery: skill.mastery ?? 0,
    transferable: !!skill.transferable,
    usageCount: usage.length,
    professionsEverUsed,
    isCrossLife: professionsEverUsed.length > 1,
    lastUse,
    byProfession,
    successRate,
    archaeology: skill.archaeology ?? [],
  };
}

/**
 * For a current query, find skills whose past usage in the same or
 * adjacent profession is most relevant. This is what makes the
 * organism USE its past experience instead of just retaining it.
 */
export function suggestFromMemory(manifest, query, currentProfession) {
  if (!manifest || !Array.isArray(manifest.skills)) return [];
  const q = (query ?? "").toLowerCase();
  const tokens = new Set(q.split(/\W+/).filter((t) => t.length > 2));

  const scored = [];
  for (const skill of manifest.skills) {
    let score = 0;
    // Token overlap with reactivation_triggers
    const triggers = (skill.reactivation_triggers ?? []).map((t) => t.toLowerCase());
    for (const trig of triggers) {
      if (tokens.has(trig)) score += 3;
    }
    // Cross-life skills are weighted higher (they've actually worked)
    if (skill.transferable) score += 2;
    // Skills used by the same profession recently get a boost
    if (skill.profession === currentProfession) score += 1;
    // High-mastery skills get a small boost
    score += Math.min(2, (skill.mastery ?? 0) * 2);
    // Past usage count (capped)
    score += Math.min(2, ((skill.usage_history ?? []).length) * 0.5);

    if (score > 0) {
      scored.push({
        key: skill.key,
        profession: skill.profession,
        transferable: !!skill.transferable,
        usageCount: (skill.usage_history ?? []).length,
        mastery: skill.mastery ?? 0,
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 10);
}

/**
 * Build a justification string the organism can show when explaining
 * WHY it chose a skill. Composed from the real usage_history.
 */
export function justifyChoice(manifest, skillKey, currentProfession) {
  const r = recallSkill(manifest, skillKey);
  if (!r) return { ok: false, reason: `skill '${skillKey}' not in manifest` };

  const parts = [];
  parts.push(`I chose ${skillKey} (profession ${r.profession}, mastery ${r.mastery.toFixed(2)}, status ${r.status}).`);

  if (r.usageCount === 0) {
    parts.push("It has never been invoked — I am using it on inference from its triggers.");
  } else {
    const lives = r.professionsEverUsed.length;
    parts.push(`It has been invoked ${r.usageCount} time(s) across ${lives} life(s).`);
    if (r.isCrossLife) {
      parts.push(`It is transferable=true because multiple professions have used it: ${r.professionsEverUsed.join(", ")}.`);
    }
    if (r.lastUse) {
      const ago = r.lastUse.at ? new Date(r.lastUse.at).toISOString() : "unknown";
      parts.push(`Last used at ${ago} as ${r.lastUse.by_profession ?? "unknown"} with result ${JSON.stringify(r.lastUse.result ?? null).slice(0, 200)}.`);
    }
    if (r.successRate !== null) {
      parts.push(`Historical success rate: ${(r.successRate * 100).toFixed(0)}%.`);
    }
  }
  if (r.archaeology.length > 0) {
    parts.push(`Archaeology: ${r.archaeology.length} archived prior version(s).`);
  }
  if (currentProfession && r.profession && r.profession !== currentProfession) {
    parts.push(`Note: I am currently in profession '${currentProfession}' but this skill belongs to '${r.profession}' — reusing prior experience.`);
  }
  return { ok: true, justification: parts.join(" "), recall: r };
}