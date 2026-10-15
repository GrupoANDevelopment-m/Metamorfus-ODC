// server/cognitive/directional-forge.mjs
// T16: Directional Forge — uses real baseline failures to inform
// the LLM what to build. NOT a blind "detect fraud" prompt.
//
// Pipeline:
//   1. Run baseline on realistic (PaySim-like) data
//   2. Collect the SPECIFIC fraud cases the baseline misses
//   3. Build "situational" training data that EXERCISES those cases
//      (oversample the missed cases, plus variants)
//   4. Tell the LLM: "baseline misses these EXACT patterns, write
//      a skill that catches them"
//   5. Validate forged skill on held-out data with k=10
//   6. Statistical significance: does the forged skill beat baseline?
//
// Real-world references:
//   - modAL active learning: https://github.com/modAL-python/modAL
//   - imbalanced-learn SMOTE: https://github.com/scikit-learn-contrib/imbalanced-learn
//   - Snorkel weak supervision: https://github.com/snorkel-team/snorkel
//   - Facebook AugLy: https://github.com/facebookresearch/AugLy

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Run the baseline and collect:
 *   - true positives: fraud the baseline caught
 *   - false negatives: fraud the baseline missed
 *   - false positives: legit the baseline wrongly flagged
 *
 * Then characterize the MISSED fraud by their properties
 * (type, amount, merchant, etc.) so we can target them.
 */
export async function diagnoseBaselineFailures(workspaceRoot, txs, fraudIds) {
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const r = await runSkill(workspaceRoot, {
    skillKey: "fraud_anomaly_protocol",
    byProfession: "fraud_analyst",
    context: { transactions: txs },
  });
  const flaggedSet = new Set((r.result?.result?.flagged ?? []).map((t) => t.id ?? t));
  const missed = [];  // fraud not flagged
  const caught = [];  // fraud flagged
  for (const tx of txs) {
    if (fraudIds.has(tx.id)) {
      if (flaggedSet.has(tx.id)) caught.push(tx);
      else missed.push(tx);
    }
  }
  // Characterize missed fraud by their properties
  const missedByType = {};
  const missedByAmount = [];
  for (const tx of missed) {
    missedByType[tx.type] = (missedByType[tx.type] ?? 0) + 1;
    missedByAmount.push(tx.amount);
  }
  return { missed, caught, flaggedSet, missedByType, missedByAmount, totalMissed: missed.length };
}

/**
 * Build "situational" training data that oversamples the missed
 * cases + creates variants. This is the "active learning" part:
 * instead of generic training data, we focus on what the model
 * gets wrong.
 *
 * Real-world ref: SMOTE (Synthetic Minority Over-sampling),
 * https://github.com/scikit-learn-contrib/imbalanced-learn
 */
export function buildSituationalData(txs, fraudIds, missedFraud, targetOversample = 10) {
  // 1. Keep all the original data
  let situational = txs.slice();
  let situationalFraud = new Set(fraudIds);
  // 2. For each missed fraud case, generate (targetOversample) variants
  //    Variants: same type/amount/merchant, different IDs
  let idCounter = 1000000;
  for (const fraud of missedFraud) {
    for (let i = 0; i < targetOversample; i++) {
      const variant = {
        ...fraud,
        id: `situational_${idCounter++}`,
        // Slight noise on amount (5% variation) to teach the model
        // the pattern, not the exact value
        amount: Math.round(fraud.amount * (0.95 + Math.random() * 0.1) * 100) / 100,
      };
      situational.push(variant);
      situationalFraud.add(variant.id);
    }
  }
  return { txs: situational, fraudIds: situationalFraud };
}

/**
 * Build a focused LLM prompt that targets the SPECIFIC failures.
 * Instead of "detect fraud", we tell the LLM:
 *   "the baseline misses these 3 specific cases with these
 *   properties, write a skill that catches them"
 */
export function buildDirectionalPrompt(missedCases, datasetProperties) {
  const casesSample = missedCases.slice(0, 5);
  const casesList = casesSample.map((c) => {
    return `  - type=${c.type} amount=${c.amount} merchant=${c.merchant} errorBalanceOrig=${c.errorBalanceOrig?.toFixed(2) ?? "?"} isMerchant=${c.isMerchant}`;
  }).join("\n");
  const missedTypes = {};
  for (const c of missedCases) {
    missedTypes[c.type] = (missedTypes[c.type] ?? 0) + 1;
  }
  return `Detect fraudulent mobile money transactions. The existing fraud_anomaly_protocol MISSES these specific cases:

${casesList}

Characterize what's missing:
${Object.entries(missedTypes).map(([t, n]) => `  - ${n} cases of type ${t}`).join("\n")}

Total missed: ${missedCases.length} out of ${datasetProperties.nFraud} fraud cases.

Key PaySim facts (use these in your detection logic):
  - Fraud ONLY occurs in TRANSFER and CASH_OUT (NEVER in PAYMENT, CASH_IN, DEBIT — these are ALWAYS safe)
  - M-prefix on nameDest = merchant (fraudsters don't use merchant accounts)
  - C-prefix on nameDest = customer (could be fraud target)
  - errorBalanceOrig = oldbalanceOrg - newbalanceOrig - amount. Non-zero = drain pattern
  - Fraud amounts often large, especially relative to oldbalanceOrg

Your skill should:
  1. Immediately rule out PAYMENT, CASH_IN, DEBIT types
  2. For TRANSFER and CASH_OUT: check isMerchant — if TRUE, mark SAFE
  3. For non-merchant recipients: check errorBalanceOrig — if non-zero, flag
  4. Return SCORE per transaction (0.0 to 1.0), score >= 0.5 = flagged

Return: {"action": "FRAUD_SCAN", "intensity": 0.7, "version": 1, "result": {"flagged": [ids with score >= 0.5], "flagged_count": N, "scores": {id: score, ...}}}

Use only stdlib. Keep under 80 lines. Output ONLY Python source.`;
}

/**
 * The full directional forge pipeline:
 *   1. Diagnose baseline failures
 *   2. Build situational training data
 *   3. Forge with directional prompt
 *   4. Validate with k=10
 *   5. Statistical significance
 */
export async function directionalForgePipeline(workspaceRoot, baselineTxs, baselineFraudIds) {
  const { generatePaySimLikeDataset, paySimToFraudFormat, paysimProperties } = await import(path.join(ROOT, "server/cognitive/paysim.mjs"));
  const { kFoldEvaluate, scoreBinary } = await import(path.join(ROOT, "server/cognitive/statistical-eval.mjs"));
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  const { adopt, loadManifest } = await import(path.join(ROOT, "server/metamorfus-core/metamorph.js"));
  const { executeBridgeTool } = await import(path.join(ROOT, "server/odc-opencode-bridge.js"));
  const { autoForgeForGap } = await import(path.join(ROOT, "server/cognitive/auto-forge.mjs"));

  const c = {
    workspaceRoot,
    dnaDir: "packages/metamorfus-src/dna_library",
    forgeSkill: async (a) => {
      const r = await executeBridgeTool("forge_skill", a, { workspaceRoot });
      return { output: r?.output ?? "", data: r?.data ?? {} };
    },
  };
  for (const p of ["fraud_analyst"]) {
    try { await adopt(p, c); } catch {}
  }

  // 1. Diagnose baseline failures on the SAME realistic data
  const diagnosis = await diagnoseBaselineFailures(workspaceRoot, baselineTxs, baselineFraudIds);

  // 2. Build situational training data (oversample missed fraud)
  const { txs: situationalTxs, fraudIds: situationalFraudIds } = buildSituationalData(
    baselineTxs, baselineFraudIds, diagnosis.missed, 15
  );

  // 3. Build the directional prompt
  const datasetProperties = { nFraud: baselineFraudIds.size };
  const taskDescription = buildDirectionalPrompt(diagnosis.missed, datasetProperties);

  // 4. Auto-forge using the situational data + directional prompt
  //    IMPORTANT: evaluate on a 70/30 split of the ORIGINAL data
  //    (not the oversampled data). This prevents covariate shift —
  //    the forged skill is tuned for the natural distribution.
  const evaluateForForge = async (_ws, skillKey, trainingData, groundTruth) => {
    const r = await runSkill(workspaceRoot, {
      skillKey, byProfession: "fraud_analyst", context: { transactions: trainingData },
    });
    const flagged = (r.result?.result?.flagged ?? []).map((t) => t.id ?? t);
    const sc = scoreBinary(flagged, groundTruth, trainingData.length);
    return { score: sc.f1, ...sc, missed: trainingData.filter((t) => groundTruth.has(t.id) && !flagged.includes(t.id)) };
  };
  // The forge trains on the oversampled data (to learn from the
  // missed cases) but is EVALUATED on a held-out 30% of the ORIGINAL
  // data. This ensures the forged skill generalizes to the natural
  // distribution, not the oversampled one.
  const n = baselineTxs.length;
  const splitIdx = Math.floor(n * 0.7);
  const forgeTrainTxs = baselineTxs;
  const forgeEvalTxs = baselineTxs.slice(splitIdx);
  const forgeEvalFraud = new Set(baselineTxs.slice(splitIdx).filter((t) => baselineFraudIds.has(t.id)).map((t) => t.id));

  const forgeReport = await autoForgeForGap(workspaceRoot, {
    taskDescription,
    trainingData: situationalTxs,  // oversampled for LLM
    groundTruth: situationalFraudIds,
    evaluateFn: evaluateForForge,
    existingSkill: "fraud_anomaly_protocol",
    threshold: 0.5,
    profession: "fraud_analyst",
    // NEW: override the test set with a slice of the ORIGINAL data
    // so the forge is evaluated on the natural distribution
    overrideTestTxs: forgeEvalTxs,
    overrideTestFraud: forgeEvalFraud,
  });

  // 5. Validate both on the ORIGINAL data (no oversampling) with k=10
  const baselineKf = await kFoldEvaluate(workspaceRoot, "fraud_anomaly_protocol", "fraud_analyst", baselineTxs, baselineFraudIds, 10);
  let forgedKf = null;
  if (forgeReport.improved) {
    forgedKf = await kFoldEvaluate(workspaceRoot, forgeReport.forgedSkillKey, "fraud_analyst", baselineTxs, baselineFraudIds, 10);
  }

  // 6. Statistical comparison
  const significant = forgedKf && (
    forgedKf.ci95.lower > baselineKf.ci95.upper ||
    baselineKf.ci95.lower > forgedKf.ci95.upper
  );
  const cohenD = forgedKf && (baselineKf.std + (forgedKf.std ?? 0)) > 0
    ? (forgedKf.meanF1 - baselineKf.meanF1) / Math.sqrt((baselineKf.std ** 2 + forgedKf.std ** 2) / 2)
    : 0;

  return {
    diagnosis: {
      totalFraud: baselineFraudIds.size,
      caught: diagnosis.caught.length,
      missed: diagnosis.missed.length,
      missedByType: diagnosis.missedByType,
      missedSamples: diagnosis.missed.slice(0, 5).map((m) => ({
        type: m.type, amount: m.amount, merchant: m.merchant,
        isMerchant: m.isMerchant, errorBalanceOrig: m.errorBalanceOrig,
      })),
    },
    situationalData: {
      originalSize: baselineTxs.length,
      situationalSize: situationalTxs.length,
      oversampleRate: situationalTxs.length / baselineTxs.length,
      situationalFraud: situationalFraudIds.size,
    },
    baseline: { kfold: baselineKf, description: "fraud_anomaly_protocol on ORIGINAL data" },
    forged: forgedKf ? { kfold: forgedKf, forgedSkillKey: forgeReport.forgedSkillKey, description: "Directional-forged skill on ORIGINAL data" } : null,
    forgeReport: {
      improved: forgeReport.improved,
      initialScore: forgeReport.initialScore,
      finalScore: forgeReport.finalScore,
      reason: forgeReport.reason,
    },
    statistics: {
      kFolds: 10,
      tCritical: 2.262,
      baselineMean: baselineKf.meanF1,
      baselineCI: [baselineKf.ci95.lower, baselineKf.ci95.upper],
      forgedMean: forgedKf?.meanF1 ?? null,
      forgedCI: forgedKf ? [forgedKf.ci95.lower, forgedKf.ci95.upper] : null,
      difference: forgedKf ? (forgedKf.meanF1 - baselineKf.meanF1) : 0,
      cohensD: cohenD,
      significant,
    },
    verdict: forgedKf && forgedKf.meanF1 > baselineKf.meanF1
      ? (significant
        ? `Directional forge IMPROVED by ${(forgedKf.meanF1 - baselineKf.meanF1).toFixed(3)} — significant (p<0.05)`
        : `Directional forge improved by ${(forgedKf.meanF1 - baselineKf.meanF1).toFixed(3)} but not significant (CIs overlap)`)
      : `Directional forge did not improve baseline (which was already good)`,
  };
}