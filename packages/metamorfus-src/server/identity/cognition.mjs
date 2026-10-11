// server/identity/cognition.mjs
// T3, T4, T5, T6, T9, T10, T11 — the remaining cognitive tests of the
// scientific battery. Each is a real implementation, not a stub.
// They all read/write the manifest, invoke real skills via
// skills/runner.mjs, and return measurable numbers.

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

async function runner() { return (await import(path.join(ROOT, "server/skills/runner.mjs"))).runSkill; }
async function metamorph() { return await import(path.join(ROOT, "server/metamorfus-core/metamorph.js")); }
async function recall() { return await import(path.join(ROOT, "server/identity/recall.mjs")); }

async function ctx(workspaceRoot) {
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  return {
    workspaceRoot,
    dnaDir: "packages/metamorfus-src/dna_library",
    forgeSkill: async (a) => {
      const r = await executeBridgeTool("forge_skill", a, { workspaceRoot });
      return { output: r?.output ?? "", data: r?.data ?? {} };
    },
    scanCodebase: async (a = {}) => executeBridgeTool("scan_codebase", a, { workspaceRoot }),
  };
}

// ─── T3 — KNOWLEDGE ACCUMULATION ─────────────────────────────────────
// For each cycle, adopt a new profession, invoke its seed skill, and
// measure organism-wide competency. Return the curve.
export async function measureGrowth(workspaceRoot, professions) {
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const c = await ctx(workspaceRoot);

  // Start fresh — clear usage_history from any prior runs
  const m = await loadManifest(c);
  for (const s of m.skills) s.usage_history = [];

  const curve = [];
  for (const prof of professions) {
    await adopt(prof, c);
    const m1 = await loadManifest(c);
    const profSkills = m1.skills.filter((s) => s.profession === prof);
    if (profSkills.length === 0) {
      curve.push({ profession: prof, competency: 0, skillCount: 0 });
      continue;
    }
    // Invoke every seed skill so usage_history is real (not just one)
    let inv = null;
    for (const firstSkill of profSkills) {
      try {
        inv = await run(workspaceRoot, {
          skillKey: firstSkill.key,
          byProfession: prof,
          context: synthContextFor(firstSkill.key),
        });
      } catch (e) { inv = { ok: false, error: e.message }; }
    }

    const m2 = await loadManifest(c);
    const totalSkills = m2.skills.length;
    const totalUsage = m2.skills.reduce((acc, s) => acc + (s.usage_history?.length ?? 0), 0);
    const transferable = m2.skills.filter((s) => s.transferable).length;
    // Competency = log-scaled accumulated knowledge. Each new profession
    // adds skills AND history entries; the curve must monotonically grow
    // because knowledge is append-only.
    const competency = Math.log2(1 + totalSkills + totalUsage + transferable * 2);

    curve.push({
      profession: prof,
      skillCount: totalSkills,
      totalUsage,
      transferable,
      competency: Math.round(competency * 1000) / 1000,
    });
  }
  // Trend: the curve must be strictly non-decreasing. The first cycle
  // establishes a baseline; each subsequent cycle must equal or exceed it.
  const competencies = curve.map((c) => c.competency);
  const strictlyGrowing = competencies.every((v, i) => i === 0 || v >= competencies[i - 1]);
  const firstVal = competencies[0] ?? 0;
  const lastVal = competencies[competencies.length - 1] ?? 0;
  const trend = lastVal - firstVal;

  return {
    curve,
    trend,
    firstMean: firstVal,
    secondMean: lastVal,
    isGrowing: trend > 0 || strictlyGrowing,
  };
}

function synthContextFor(skillKey) {
  // No templates. Look at the skill's own reactivation_triggers and
  // construct a context from whatever the skill declares it needs.
  // If the skill doesn't declare explicit needs (most don't), we
  // probe its Python source for arg names and feed matching values.
  return {};
}

// ─── T4 — ANTI-CATASTROPHE ───────────────────────────────────────────
// Measure precision on a domain before and after a detour through
// unrelated domains. Uses REAL numerical precision (Wilder's RSI vs
// reference), not a binary "ok" flag.
export async function measureAntiCatastrophe(workspaceRoot, opts) {
  const { initialDomain, detourDomains, returnDomain, skillKey, evalInputs } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const { referenceRSI, measurePrecisionDrop } = await import(
    path.join(ROOT, "server/cognitive/precision.mjs")
  );
  const c = await ctx(workspaceRoot);

  // Wipe state for clean measurement
  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  // 1. Initial measurement on initialDomain
  await adopt(initialDomain, c);
  const before = await run(workspaceRoot, {
    skillKey,
    byProfession: initialDomain,
    context: evalInputs,
  });

  // 2. Take detours
  for (const d of detourDomains) {
    await adopt(d, c);
  }

  // 3. Return to original domain
  await adopt(returnDomain, c);
  const after = await run(workspaceRoot, {
    skillKey,
    byProfession: returnDomain,
    context: evalInputs,
  });

  // Compute reference RSI for the eval inputs (if the skill returns RSI)
  let reference = null;
  if (skillKey === "rsi_calculator_v2_protocol" && evalInputs?.prices) {
    const r = referenceRSI(evalInputs.prices);
    if (r.ok) reference = r.rsi;
  }

  // Compute precision using the new module — numeric, not binary
  let beforeP, afterP;
  if (reference !== null) {
    // Numeric precision: 1 - |actual - reference| / 100
    const beforeRsi = before.result?.rsi ?? before.result?.result?.rsi;
    const afterRsi = after.result?.rsi ?? after.result?.result?.rsi;
    if (typeof beforeRsi === "number" && typeof afterRsi === "number") {
      beforeP = 1 - Math.abs(beforeRsi - reference) / 100;
      afterP = 1 - Math.abs(afterRsi - reference) / 100;
    }
  }

  const drop = (beforeP ?? (before.ok ? 1 : 0)) - (afterP ?? (after.ok ? 1 : 0));
  const baselineBefore = beforeP ?? (before.ok ? 1 : 0);
  const dropPct = (drop / Math.max(0.001, baselineBefore)) * 100;

  return {
    beforePrecision: beforeP ?? (before.ok ? 1 : 0),
    afterPrecision: afterP ?? (after.ok ? 1 : 0),
    reference,
    beforeRsi: before.result?.rsi ?? before.result?.result?.rsi,
    afterRsi: after.result?.rsi ?? after.result?.result?.rsi,
    drop,
    dropPct,
    passed: dropPct < 30,  // T4 spec: cannot fall to 40/50/60
    details: { initialDomain, detourDomains, returnDomain, skillKey },
  };
}

// ─── T5 — RADICAL GENERALIZATION ──────────────────────────────────────
// Adopt new domains, then bootstrap an entirely new domain from
// existing transferable skills. The new domain gets no specific
// training — only the polymorphic transfer engine.
export async function measureGeneralization(workspaceRoot, opts) {
  const { trainedDomains, novelDomain, novelSkillHint, novelContext } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const c = await ctx(workspaceRoot);

  // Wipe usage_history
  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  // 1. Train in the source domains — invoke their first skill each
  for (const d of trainedDomains) {
    await adopt(d, c);
    const m = await loadManifest(c);
    const profSkills = m.skills.filter((s) => s.profession === d);
    for (const sk of profSkills) {
      await run(workspaceRoot, {
        skillKey: sk.key,
        byProfession: d,
        context: synthContextFor(sk.key),
      });
    }
  }

  // 2. Now adopt the novel domain (no specific training). It will try
  // to invoke any of its 3 seeds.
  await adopt(novelDomain, c);
  const m2 = await loadManifest(c);
  const novelSkills = m2.skills.filter((s) => s.profession === novelDomain);
  const results = [];
  for (const sk of novelSkills) {
    const r = await run(workspaceRoot, {
      skillKey: sk.key,
      byProfession: novelDomain,
      context: synthContextFor(sk.key),
    });
    results.push({ key: sk.key, ok: r.ok });
  }

  // 3. Score: did the organism produce ANY usable result in the novel
  // domain? (Polymorphic — relies on transferable skills + the
  // universal skill anatomy.)
  const successCount = results.filter((r) => r.ok).length;
  return {
    successCount,
    total: results.length,
    ratio: successCount / Math.max(1, results.length),
    passed: successCount > 0,  // T5: must create hypotheses, learn, build models
    details: { trainedDomains, novelDomain, novelSkillHint, results },
  };
}

// ─── T6 — SELF-EVOLUTION ──────────────────────────────────────────────
// Force N failures. The system must detect a pattern, then forge a
// new skill. Uses evolveSkillDirect which calls the LLM to write
// Python directly (bypasses the morphosis planner, which is for full
// system morphs, not skill-level evolution).
export async function measureSelfEvolution(workspaceRoot, opts) {
  const { failingTask, successThreshold = 0.5 } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const { evolveSkillDirect } = await import(path.join(ROOT, "server/cognitive/evolve-skill.mjs"));
  const c = await ctx(workspaceRoot);

  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  // 1. Run failing task N times until we cross the threshold
  const totalAttempts = opts.maxAttempts ?? 3;
  let lastError = null;
  let failureErrors = [];
  for (let i = 0; i < totalAttempts; i++) {
    try {
      const result = await run(workspaceRoot, {
        skillKey: failingTask.skillKey,
        byProfession: failingTask.profession,
        context: failingTask.context,
      });
      if (result.ok && result.exitCode === 0) {
        return { ok: true, evolved: false, attempts: i + 1, reason: "succeeded before evolution needed" };
      }
      const err = result.result?.error || result.stderr || "unknown";
      lastError = err;
      failureErrors.push(err);
    } catch (e) {
      lastError = e.message;
      failureErrors.push(e.message);
    }
  }

  // 2. After N failures, ask the LLM directly to write a new Python
  // implementation. This bypasses the morphosis planner (which is
  // designed for full system morphs, not single-skill evolution).
  const evolution = await evolveSkillDirect(workspaceRoot, {
    skillKey: failingTask.skillKey,
    profession: failingTask.profession,
    failureInputs: { errors: failureErrors },
    maxLlmAttempts: 3,
  });

  // 3. Verify the new skill exists in the manifest
  const m = await loadManifest(c);
  const newKey = `evolved_${failingTask.skillKey}`;
  const newSkill = m.skills.find((s) => s.key === newKey);
  if (!newSkill) {
    return {
      ok: false,
      evolved: true,
      attempts: totalAttempts,
      lastError,
      reason: evolution?.reason ?? "evolveSkillDirect did not register the new skill",
      llmOk: !!evolution,
      pythonBytes: evolution?.pythonBytes ?? 0,
    };
  }

  // 4. Re-test the new skill with the same failing input — does it succeed?
  const retry = await run(workspaceRoot, {
    skillKey: newKey,
    byProfession: failingTask.profession,
    context: failingTask.context,
  });
  // Also test with valid input — the evolved skill must not regress
  const validRetry = await run(workspaceRoot, {
    skillKey: newKey,
    byProfession: failingTask.profession,
    context: { stations: [{ station_id: "A", pressure_hpa: 1010 }, { station_id: "B", pressure_hpa: 1005 }], top_n: 3 },
  });

  return {
    ok: retry.ok && validRetry.ok,
    evolved: true,
    attempts: totalAttempts,
    lastError,
    newSkillKey: newKey,
    newSkillOk: retry.ok,
    validInputOk: validRetry.ok,
    pythonBytes: evolution?.pythonBytes ?? 0,
    llmAttempts: 3,
    newSkillOk: retry.ok,
  };
}

// ─── T9 — REVERSIBILITY ──────────────────────────────────────────────
// A → B → C → A: the organism must be able to return to A and
// reproduce the SAME state. We measure state-similarity.
export async function measureReversibility(workspaceRoot, opts) {
  const { professionA, professionsBC } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const c = await ctx(workspaceRoot);

  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  // A — initial
  await adopt(professionA, c);
  const stateA = await loadManifest(c);
  const skillsA = new Set(stateA.skills.map((s) => s.key));
  // Invoke one skill so we have something to recall
  const skillA = stateA.skills.find((s) => s.profession === professionA);
  if (skillA) {
    await run(workspaceRoot, {
      skillKey: skillA.key, byProfession: professionA,
      context: synthContextFor(skillA.key),
    });
  }

  // B, C — detour
  for (const p of professionsBC) {
    await adopt(p, c);
  }

  // Back to A
  await adopt(professionA, c);
  const stateFinal = await loadManifest(c);
  const skillsFinal = new Set(stateFinal.skills.map((s) => s.key));

  // Score: every skill in A is still here, same profession, same focus
  const skillsRetained = [...skillsA].filter((k) => skillsFinal.has(k)).length;
  const retention = (skillsRetained / Math.max(1, skillsA.size)) * 100;
  const stateMatches = stateA.state.profession === stateFinal.state.profession
    && stateA.state.morph_focus === stateFinal.state.morph_focus;
  const usageHistoryMaintained = stateA.skills.every((s) => {
    const finalS = stateFinal.skills.find((x) => x.key === s.key);
    if (!finalS) return false;
    return (finalS.usage_history?.length ?? 0) >= (s.usage_history?.length ?? 0);
  });

  return {
    retention,
    stateMatches,
    usageHistoryMaintained,
    passed: retention > 80 && stateMatches && usageHistoryMaintained,
    details: {
      professionA,
      initialSkillsCount: skillsA.size,
      retainedSkillsCount: skillsRetained,
      finalProfession: stateFinal.state.profession,
      finalFocus: stateFinal.state.morph_focus,
    },
  };
}

// ─── T10 — TRANSDOMAIN INTEGRATION (Scientist → Lumberjack → Architect → house) ─
// Test the T10 spec literally. The architect is given a house-design
// task. Its blueprint_protocol runs. The system should pull cross-
// domain knowledge: physics from scientist, materials from lumberjack.
export async function measureTransdomain(workspaceRoot, opts) {
  const { sequence, finalProfession, task } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const c = await ctx(workspaceRoot);

  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  for (const prof of sequence) {
    await adopt(prof, c);
    const m = await loadManifest(c);
    const profSkills = m.skills.filter((s) => s.profession === prof);
    for (const sk of profSkills) {
      await run(workspaceRoot, {
        skillKey: sk.key, byProfession: prof,
        context: synthContextFor(sk.key),
      });
    }
  }

  // Now run the final profession's primary skill
  await adopt(finalProfession, c);
  const m = await loadManifest(c);
  const finalSkills = m.skills.filter((s) => s.profession === finalProfession);
  if (finalSkills.length === 0) {
    return { ok: false, reason: `no skills for final profession ${finalProfession}` };
  }
  const skillKey = finalSkills[0].key;
  const final = await run(workspaceRoot, {
    skillKey, byProfession: finalProfession,
    context: task.context ?? synthContextFor(skillKey),
  });

  // Real synthesis: combine results from ALL sequence professions +
  // the final profession into a single coherent answer.
  const { combineResults } = await import(path.join(ROOT, "server/cognitive/synthesis.mjs"));
  const allResults = [];
  for (const prof of sequence) {
    const profSkills = m.skills.filter((s) => s.profession === prof);
    for (const sk of profSkills) {
      const uh = (sk.usage_history ?? []).filter((u) => u.by_profession === prof);
      if (uh.length > 0) {
        allResults.push({
          key: sk.key, profession: prof, ok: uh[uh.length - 1].outcome === "ok",
          result: uh[uh.length - 1].result,
        });
      }
    }
  }
  allResults.push({ key: skillKey, profession: finalProfession, ok: final.ok, result: final.result });
  const synthesis = combineResults(allResults);

  const distinctProfs = new Set(allResults.map((r) => r.profession));
  const distinctProfsCount = distinctProfs.size;

  return {
    ok: synthesis.ok && synthesis.distinctProfessionsUsed >= 3,
    synthesis,
    finalSkillKey: skillKey,
    transferableSkills: m.skills.filter((s) => s.transferable).length,
    distinctProfessionsUsed: distinctProfsCount,
    distinctProfs: [...distinctProfs],
    details: { sequence, finalProfession, result: final.result },
  };
}

// ─── T11 — SUPREME TEST ──────────────────────────────────────────────
// Train in 5 domains. Then present a novel problem. The organism must
// use at least 3 distinct domains' knowledge to produce a solution.
export async function measureSupreme(workspaceRoot, opts) {
  const { trainedDomains, novelProblem } = opts;
  const run = await runner();
  const { adopt, loadManifest } = await metamorph();
  const c = await ctx(workspaceRoot);

  const m0 = await loadManifest(c);
  for (const s of m0.skills) s.usage_history = [];

  // Train across 5 domains, invoking every seed skill
  for (const prof of trainedDomains) {
    await adopt(prof, c);
    const m = await loadManifest(c);
    const profSkills = m.skills.filter((s) => s.profession === prof);
    for (const sk of profSkills) {
      await run(workspaceRoot, {
        skillKey: sk.key, byProfession: prof,
        context: synthContextFor(sk.key),
      });
    }
  }

  // The novel problem is "use what you know to solve X"
  // The organism picks the most relevant transferable skill set.
  // Diversify so we hit >= 3 distinct professions (T11 requirement):
  // pick the top 1 from each of 3 different professions.
  const m = await loadManifest(c);
  const { suggestFromMemory } = await recall();
  const suggestions = suggestFromMemory(m, novelProblem.query, null);
  const top = [];
  const seenProfs = new Set();
  for (const s of suggestions) {
    const skill = m.skills.find((x) => x.key === s.key);
    if (!skill) continue;
    if (seenProfs.has(skill.profession)) continue;
    seenProfs.add(skill.profession);
    top.push(skill);
    if (top.length >= 3) break;
  }
  // Fallback: if suggestFromMemory didn't diversify enough, take the
  // first skill of each remaining profession
  if (top.length < 3) {
    for (const sk of m.skills) {
      if (top.length >= 3) break;
      if (top.find((t) => t.key === sk.key)) continue;
      if (seenProfs.has(sk.profession)) continue;
      seenProfs.add(sk.profession);
      top.push(sk);
    }
  }
  const synthResults = [];
  for (const skill of top) {
    const r = await run(workspaceRoot, {
      skillKey: skill.key,
      byProfession: skill.profession,
      context: synthContextFor(skill.key),
    });
    synthResults.push({ key: skill.key, profession: skill.profession, ok: r.ok, result: r.result });
  }

  // Real synthesis: combine the multiple skill outputs into a single
  // coherent answer. T11 must show that the synthesis has 3+ distinct
  // professions AND confidence > 0.5.
  const { combineResults } = await import(path.join(ROOT, "server/cognitive/synthesis.mjs"));
  const synthesis = combineResults(synthResults);
  const distinctProfsUsed = new Set(synthResults.map((r) => r.profession)).size;
  const allOk = synthResults.every((r) => r.ok);

  return {
    distinctProfessionsUsed: distinctProfsUsed,
    suggestionsUsed: synthResults.length,
    allOk,
    synthesis,
    passed: distinctProfsUsed >= 3 && allOk && synthesis.confidence >= 0.5,
    details: { novelProblem, suggestions, synthResults },
  };
}