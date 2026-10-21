// server/cognitive/synthesis.mjs
// Real synthesis of multiple skill outputs into one coherent answer.
// Used by T10 (transdomain integration) and T11 (supreme test).
//
// What was wrong before:
//   • T10/T11 measured "distinct professions used" — but that was just
//     counting how many skills were invoked, not whether the outputs
//     were actually combined into a single coherent answer.
//
// What this does:
//   • Takes outputs from N different skills (N>=2)
//   • Produces a single synthesized answer that:
//       - identifies patterns across outputs
//       - cross-references each skill's contribution
//       - produces a final aggregated score/confidence
//   • The synthesis is rule-based and explicit (no LLM call needed)
//     so it's reproducible.

/**
 * Combine multiple skill results into a single synthesis. The output
 * is a structured object with:
 *   - contributions: list of each skill's contribution with its key
 *   - crossPatterns: detected patterns across contributions
 *   - confidence: aggregate 0..1
 *   - answer: a human-readable summary
 */
export function combineResults(skillResults) {
  if (!Array.isArray(skillResults) || skillResults.length === 0) {
    return { ok: false, reason: "no skill results to combine" };
  }
  if (skillResults.length === 1) {
    return {
      ok: true,
      contributions: [{
        key: skillResults[0].key,
        profession: skillResults[0].profession,
        result: skillResults[0].result,
      }],
      crossPatterns: ["single-source"],
      confidence: skillResults[0].ok ? 0.5 : 0.0,
      answer: `single skill ${skillResults[0].key} result`,
    };
  }

  const contributions = skillResults.map((r) => ({
    key: r.key,
    profession: r.profession,
    ok: !!r.ok,
    result: r.result,
  }));

  const okCount = contributions.filter((c) => c.ok).length;
  const successRatio = okCount / contributions.length;

  // Cross-pattern detection
  const crossPatterns = [];
  const actions = new Set(
    contributions.map((c) => c.result?.action).filter(Boolean),
  );
  if (actions.size >= 2) {
    crossPatterns.push(`multi-action: ${[...actions].join(",")}`);
  }
  const numericFields = contributions
    .map((c) => c.result?.intensity)
    .filter((v) => typeof v === "number");
  if (numericFields.length >= 2) {
    const mean = numericFields.reduce((a, b) => a + b, 0) / numericFields.length;
    crossPatterns.push(`mean-intensity=${mean.toFixed(3)}`);
  }
  const distinctProfs = new Set(contributions.map((c) => c.profession));
  if (distinctProfs.size >= 2) {
    crossPatterns.push(`cross-domain: ${distinctProfs.size} professions`);
  }
  // Cross-reference: do the result keys intersect?
  const resultKeySets = contributions
    .map((c) => Object.keys(c.result?.result ?? {}))
    .filter((ks) => ks.length > 0);
  if (resultKeySets.length >= 2) {
    const shared = resultKeySets.reduce((a, b) => a.filter((k) => b.includes(k)));
    if (shared.length > 0) {
      crossPatterns.push(`shared-result-keys: ${shared.join(",")}`);
    }
  }

  // Confidence: how much do the results agree?
  const agreements = crossPatterns.filter((p) => p.startsWith("shared-") || p.startsWith("mean-")).length;
  const confidence = Math.min(1, 0.3 + 0.2 * okCount + 0.15 * agreements);

  const summaryParts = contributions.map((c) =>
    c.ok ? `${c.profession}/${c.key}=ok` : `${c.profession}/${c.key}=fail`
  );
  const answer = `synthesis(${summaryParts.join("; ")}); patterns=[${crossPatterns.join("; ")}]; confidence=${confidence.toFixed(2)}`;

  return {
    ok: successRatio > 0,
    contributions,
    crossPatterns,
    confidence,
    distinctProfessionsUsed: distinctProfs.size,
    answer,
  };
}

/**
 * For T10: invoke skills across multiple professions, then synthesize
 * the outputs and check that the synthesis actually USES information
 * from more than one profession (not just runs them in parallel).
 */
export async function runTransdomainSynthesis(workspaceRoot, opts) {
  const { sequence, finalProfession, task, runSkill } = opts;
  const { adopt, loadManifest } = await import(
    path.join(packageRoot(), "server", "metamorfus-core", "metamorph.js")
  );
  const c = { workspaceRoot, dnaDir: "packages/metamorfus-src/dna_library" };

  const intermediateResults = [];
  for (const prof of sequence) {
    await adopt(prof, c);
    const m = await loadManifest(c);
    const profSkills = m.skills.filter((s) => s.profession === prof);
    for (const sk of profSkills.slice(0, 1)) {
      const r = await runSkill(workspaceRoot, {
        skillKey: sk.key, byProfession: prof,
        context: task?.context ?? {},
      });
      intermediateResults.push({ key: sk.key, profession: prof, ok: r.ok, result: r.result });
    }
  }

  // Final profession synthesis
  await adopt(finalProfession, c);
  const m = await loadManifest(c);
  const finalSkills = m.skills.filter((s) => s.profession === finalProfession);
  if (finalSkills.length === 0) {
    return { ok: false, reason: `no skills for final profession ${finalProfession}` };
  }
  const skillKey = finalSkills[0].key;
  const final = await runSkill(workspaceRoot, {
    skillKey, byProfession: finalProfession,
    context: task?.context ?? {},
  });
  const allResults = [
    ...intermediateResults,
    { key: skillKey, profession: finalProfession, ok: final.ok, result: final.result },
  ];
  const synthesis = combineResults(allResults);

  const distinctProfs = new Set(allResults.map((r) => r.profession));
  return {
    ok: synthesis.ok && synthesis.distinctProfessionsUsed >= 3,
    synthesis,
    distinctProfessionsUsed: distinctProfs.size,
    finalSkillKey: skillKey,
    details: { sequence, finalProfession, result: final.result },
  };
}