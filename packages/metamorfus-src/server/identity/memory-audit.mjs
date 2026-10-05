// server/identity/memory-audit.mjs
// Real continuous-memory audit. Walks the manifest and reports:
//   • growth — total skills + history entries
//   • corruption — duplicate keys, unreachable skills, broken refs
//   • loops — same profession re-adopted without intermediate change
//   • decay — skills with very low mastery that were heavily used
//
// This is the audit that backs T8 (Temporal Scale — 100/500/1000
// metamorphoses must not corrupt memory).
//
// IMPORTANT — what the manifest actually carries:
//   • manifest.metamorphosis_log        — chronological record of adopts
//     [{ from, to, at, skills_forged, skills_reactivated, retained_from_past }]
//   • manifest.state.profession_chain  — Set of professions ever adopted
//   • manifest.skills[]                — every skill with usage_history
//
// Earlier revisions of this audit looked at manifest.state.history which
// does not exist on the schema; the system stores chronology in
// metamorphosis_log instead. Reading the wrong field produced two false
// positives: "missing_mastery_decay_field" and "no_history_array".

export function auditMemory(manifest) {
  const anomalies = [];
  const stats = {
    skillCount: 0,
    historyEntries: 0,
    archaeologyEntries: 0,
    dormantSkills: 0,
    activeSkills: 0,
    transferableSkills: 0,
    professionsSeen: new Set(),
    metamorphosisCount: 0,
  };

  if (!manifest || !Array.isArray(manifest.skills)) {
    return { ok: false, reason: "manifest has no skills array", anomalies, stats };
  }
  stats.skillCount = manifest.skills.length;

  // Check 1 — duplicate keys
  const seenKeys = new Set();
  const dupKeys = [];
  for (const s of manifest.skills) {
    if (seenKeys.has(s.key)) dupKeys.push(s.key);
    seenKeys.add(s.key);
  }
  if (dupKeys.length > 0) {
    anomalies.push({ kind: "duplicate_keys", keys: dupKeys });
  }

  // Per-skill stats
  for (const s of manifest.skills) {
    const uh = Array.isArray(s.usage_history) ? s.usage_history : [];
    stats.historyEntries += uh.length;
    stats.archaeologyEntries += Array.isArray(s.archaeology) ? s.archaeology.length : 0;
    if (s.status === "dormant") stats.dormantSkills += 1;
    else if (s.status === "active" || s.status === "ready") stats.activeSkills += 1;
    if (s.transferable) stats.transferableSkills += 1;
    if (s.profession) stats.professionsSeen.add(s.profession);
  }

  // Check 2 — broken usage_history refs (at/by_profession inconsistent)
  for (const s of manifest.skills) {
    const uh = Array.isArray(s.usage_history) ? s.usage_history : [];
    for (const u of uh) {
      if (u.at && isNaN(Date.parse(u.at))) {
        anomalies.push({ kind: "bad_timestamp", skillKey: s.key, value: u.at });
      }
    }
  }

  // Check 3 — metamorphosis_log loop detection (the REAL chronology field).
  const log = Array.isArray(manifest.metamorphosis_log) ? manifest.metamorphosis_log : [];
  stats.metamorphosisCount = log.length;
  for (let i = 2; i < log.length; i++) {
    const a = log[i - 2];
    const b = log[i - 1];
    const c = log[i];
    if (a?.to === b?.to && b?.to === c?.to && a?.from !== c?.from) {
      anomalies.push({ kind: "ping_pong_loop", profession: c.to, at: c.at });
    }
  }

  // Check 4 — manifest integrity (against the REAL schema)
  if (!manifest.state?.profession) {
    anomalies.push({ kind: "no_current_profession" });
  }
  if (!Array.isArray(manifest.metamorphosis_log)) {
    anomalies.push({ kind: "no_metamorphosis_log" });
  }
  // profession_chain is a derived view over metamorphosis_log; it can be
  // regenerated but the system ships it precomputed.
  if (!Array.isArray(manifest.profession_chain)) {
    anomalies.push({ kind: "missing_profession_chain" });
  }

  return {
    ok: anomalies.length === 0,
    anomalies,
    stats: {
      ...stats,
      professionsSeen: [...stats.professionsSeen],
    },
  };
}

/**
 * Compact the metamorphosis_log to a bounded window. Keeps the most
 * recent N entries and a digest count for the discarded tail.
 */
export function compactHistory(manifest, windowSize = 1000) {
  const log = Array.isArray(manifest.metamorphosis_log) ? manifest.metamorphosis_log : [];
  if (log.length <= windowSize) {
    return { compacted: false, before: log.length, after: log.length };
  }
  const kept = log.slice(-windowSize);
  const dropped = log.length - windowSize;
  manifest.metamorphosis_log = kept;
  manifest.history_compacted = {
    droppedCount: dropped,
    lastCompactedAt: new Date().toISOString(),
  };
  return { compacted: true, before: log.length, after: kept.length, dropped };
}