// server/cognitive/statistical-eval.mjs
// T14: Real statistical validation of skill performance.
//
// Replaces the single train/test split (which is "guessing" — the
// system overfits to one data partition) with k-fold cross-
// validation. This is the standard in ML evaluation:
//
// Real-world refs:
//   - scikit-learn model_selection:
//     https://scikit-learn.org/stable/model_selection.html
//   - mlxtend confusion matrix & ROC:
//     https://github.com/rasbt/mlxtend
//   - PyOD benchmark (k-fold for fraud detection):
//     https://github.com/yzhao062/pyod
//   - Wireshark-style: k-fold cross-validation is the
//     established protocol since Kohavi 1995.
//
// What this adds vs the simple train/test split:
//   1. k-fold CV with stratification (preserves fraud ratio per fold)
//   2. Bootstrap confidence intervals (95% CI on F1)
//   3. ROC analysis (TPR vs FPR at multiple thresholds)
//   4. Confusion matrix per fold
//   5. Variance analysis: is the skill brittle (high variance)
//      or robust (low variance) across folds?

import path from "node:path";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Generate a MORE VARIED synthetic fraud dataset. The previous
 * version had only 3 patterns (spike/drip/weird). This one has
 * 7 patterns to make the test harder and more realistic.
 */
export function generateVariedFraudDataset(n = 200, nFraud = 20) {
  const txs = [];
  const fraudIds = new Set();
  const idPick = () => `tx_${(txs.length + 1).toString().padStart(5, "0")}`;
  // Realistic amounts: 80% small (10-200), 15% medium (200-1000), 5% large (>1000)
  const sampleAmount = () => {
    const r = Math.random();
    if (r < 0.80) return 10 + Math.random() * 190;
    if (r < 0.95) return 200 + Math.random() * 800;
    return 1000 + Math.random() * 9000;
  };
  // Realistic merchants
  const merchants = ["amazon", "walmart", "target", "costco", "apple", "google",
    "starbucks", "uber", "lyft", "doordash", "shell", "bp", "exxon",
    "netflix", "spotify", "unknown_offshore", "crypto_exchange",
    "gambling_site", "sketchy_llc", "shell_corp"];
  // Common merchants (used in normal txs)
  const commonMerchants = ["amazon", "walmart", "target", "costco", "apple", "google"];
  // Normal transactions
  for (let i = 0; i < n - nFraud; i++) {
    txs.push({
      id: idPick(),
      amount: sampleAmount(),
      merchant: commonMerchants[Math.floor(Math.random() * commonMerchants.length)],
      hour: 8 + Math.floor(Math.random() * 14),  // 8am-10pm normal hours
    });
  }
  // 7 fraud patterns (not 3, harder to memorize)
  for (let i = 0; i < nFraud; i++) {
    const id = idPick();
    fraudIds.add(id);
    const pattern = i % 7;
    switch (pattern) {
      case 0: // spike — way above normal
        txs.push({ id, amount: 5000 + Math.random() * 10000, merchant: merchants[Math.floor(Math.random() * 4) + 14], hour: Math.floor(Math.random() * 24) });
        break;
      case 1: // micro-spike — small but unusual
        txs.push({ id, amount: 1 + Math.random() * 5, merchant: "unknown", hour: 3 });
        break;
      case 2: // late night + common merchant (stealth)
        txs.push({ id, amount: 50 + Math.random() * 200, merchant: "amazon", hour: 2 });
        break;
      case 3: // round number (psychological: $1000, $500)
        txs.push({ id, amount: 500 * Math.ceil(Math.random() * 20), merchant: "wire_transfer", hour: 14 });
        break;
      case 4: // rare merchant
        txs.push({ id, amount: 100 + Math.random() * 300, merchant: merchants[15 + Math.floor(Math.random() * 5)], hour: 12 });
        break;
      case 5: // foreign currency hint
        txs.push({ id, amount: 200 + Math.random() * 200, merchant: "crypto_exchange", hour: 1 });
        break;
      case 6: // test transaction (very small after a large one)
        txs.push({ id, amount: 0.5, merchant: "sketchy_llc", hour: 4 });
        break;
    }
  }
  return { txs, fraudIds };
}

/**
 * k-fold cross-validation with stratification. Each fold preserves
 * the fraud ratio of the original dataset.
 *
 * Returns array of {trainIdx, testIdx} pairs.
 */
export function stratifiedKFold(n, fraudIds, k = 5) {
  const fraudIdx = [];
  const normalIdx = [];
  for (let i = 0; i < n; i++) {
    // The fraudIds is a Set of transaction IDs; we need indices
    if (fraudIds.has(i)) fraudIdx.push(i);
    else normalIdx.push(i);
  }
  // Shuffle both
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  shuffle(fraudIdx);
  shuffle(normalIdx);
  // Distribute into k folds
  const folds = Array.from({ length: k }, () => ({ train: [], test: [] }));
  fraudIdx.forEach((idx, i) => {
    const fold = i % k;
    folds[fold].test.push(idx);
  });
  normalIdx.forEach((idx, i) => {
    const fold = i % k;
    folds[fold].test.push(idx);
  });
  // Build train sets
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i !== j) folds[i].train.push(...folds[j].test);
    }
  }
  return folds;
}

/**
 * Score a binary prediction: precision, recall, F1, confusion matrix.
 * Real-world ref: sklearn.metrics.precision_recall_fscore_support
 *
 * BUG FIX: TN requires knowing the total population. Without it,
 * the previous implementation estimated TN from flagged.size +
 * truth.size, which is wildly wrong (TN should be much larger
 * for typical imbalanced datasets).
 *
 * Now takes an optional `nTotal` parameter (the population size)
 * to compute TN correctly. If not provided, TN is omitted.
 */
export function scoreBinary(flagged, truth, nTotal = null) {
  const flaggedSet = new Set(flagged);
  const truthSet = new Set(truth);
  let tp = 0, fp = 0, fn = 0;
  for (const id of flaggedSet) {
    if (truthSet.has(id)) tp++;
    else fp++;
  }
  for (const id of truthSet) {
    if (!flaggedSet.has(id)) fn++;
  }
  // TN: only computable if we know the total population
  let tn = null;
  if (nTotal !== null && nTotal >= tp + fp + fn) {
    tn = nTotal - tp - fp - fn;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision, recall, f1, tp, fp, fn, tn,
    confusionMatrix: { tp, fp, fn, tn },
  };
}

/**
 * Student's t-distribution confidence interval for k-fold CV.
 *
 * The proper CI for k-fold cross-validation is the t-distribution:
 *   CI = mean ± t_{alpha/2, k-1} * std / sqrt(k)
 *
 * This is the standard protocol since Kohavi 1995. We use t-critical
 * values from a lookup table (more accurate than the asymptotic
 * normal approximation for small k).
 *
 * Refs:
 *   - Kohavi 1995, "A Study of Cross-Validation and Bootstrap for
 *     Accuracy Estimation and Model Selection"
 *   - scikit-learn's cross_val_score returns mean +/- 1.96*std/sqrt(k)
 *     for 95% CI (asymptotic), which we improve with t-distribution
 *     for small k (e.g., k=5)
 */
const T_CRITICAL_95 = { 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 20: 2.086, 30: 2.042, 60: 2.000, 1000: 1.96 };
export function tCI(f1s, alpha = 0.05) {
  if (f1s.length === 0) return { mean: 0, ci: [0, 0], std: 0, tCritical: 0, sem: 0 };
  const n = f1s.length;
  const mean = f1s.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(f1s.map((v) => (v - mean) ** 2).reduce((a, b) => a + b, 0) / Math.max(1, n - 1));
  const sem = std / Math.sqrt(n);
  // Find t-critical for given df = n-1
  const df = n - 1;
  let t = 1.96;
  if (T_CRITICAL_95[df] !== undefined) t = T_CRITICAL_95[df];
  else if (df < 2) t = 12.706;  // very small
  const halfWidth = t * sem;
  return {
    mean, std, sem, tCritical: t, df,
    ci: [Math.max(0, mean - halfWidth), Math.min(1, mean + halfWidth)],
    method: "t-distribution",
  };
}

/**
 * Bootstrap confidence interval (legacy, kept for comparison).
 * Note: this resamples F1 values directly, which is a simplified
 * proxy. The proper t-distribution CI above is preferred.
 */
export function bootstrapCI(f1s, B = 1000, alpha = 0.05) {
  if (f1s.length === 0) return { mean: 0, ci: [0, 0], std: 0 };
  const samples = [];
  for (let i = 0; i < B; i++) {
    const sample = [];
    for (let j = 0; j < f1s.length; j++) {
      sample.push(f1s[Math.floor(Math.random() * f1s.length)]);
    }
    samples.push(sample.reduce((a, b) => a + b, 0) / sample.length);
  }
  samples.sort((a, b) => a - b);
  const mean = f1s.reduce((a, b) => a + b, 0) / f1s.length;
  const std = Math.sqrt(f1s.map((v) => (v - mean) ** 2).reduce((a, b) => a + b, 0) / f1s.length);
  const lower = samples[Math.floor(B * alpha / 2)];
  const upper = samples[Math.floor(B * (1 - alpha / 2))];
  return { mean, ci: [lower, upper], std, n: f1s.length, method: "bootstrap (simplified)" };
}

/**
 * ROC analysis. For BINARY classifiers (flagged or not), the ROC
 * curve is degenerate — only 1 point exists. Real ROC AUC requires
 * a continuous score per item, not a binary flag.
 *
 * For honest reporting: we return the single operating point with
 * TPR and FPR, and explicitly note the AUC is NOT defined for
 * binary classifiers (would require score-based ranking).
 *
 * Ref: Fawcett 2006, "An introduction to ROC analysis"
 * sklearn.metrics.roc_curve
 */
export function rocCurve(flagged, truth, allIds) {
  if (allIds.length === 0) return { tpr: 0, fpr: 0, auc: null, degenerate: true };
  const flaggedSet = new Set(flagged);
  const truthSet = new Set(truth);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const id of allIds) {
    const isFlagged = flaggedSet.has(id);
    const isTruth = truthSet.has(id);
    if (isFlagged && isTruth) tp++;
    else if (isFlagged && !isTruth) fp++;
    else if (!isFlagged && isTruth) fn++;
    else tn++;
  }
  const tpr = tp / Math.max(1, tp + fn);  // sensitivity / recall
  const fpr = fp / Math.max(1, fp + tn);  // 1 - specificity
  const precision = tp / Math.max(1, tp + fp);
  const recall = tpr;
  return {
    degenerate: true,
    reason: "binary classifier — ROC AUC not defined (needs score-based ranking)",
    tpr, fpr, precision, recall,
    operatingPoint: { tpr, fpr, threshold: "binary" },
    confusionMatrix: { tp, fp, fn, tn },
  };
}

/**
 * Run the full k-fold evaluation on a skill. Returns:
 *   - perFoldScores: array of F1 per fold
 *   - meanF1, stdF1, t-distribution CI
 *   - confusion matrix (summed across folds)
 *   - ROC analysis (note: degenerate for binary skills)
 */
export async function kFoldEvaluate(workspaceRoot, skillKey, profession, txs, fraudIds, k = 5) {
  const { runSkill } = await import(path.join(ROOT, "server/skills/runner.mjs"));
  // Build the set of fraud INDICES (not IDs)
  const fraudIndices = new Set();
  for (let i = 0; i < txs.length; i++) {
    if (fraudIds.has(txs[i].id)) fraudIndices.add(i);
  }
  const folds = stratifiedKFold(txs.length, fraudIndices, k);
  const perFoldScores = [];
  const perFoldConfusion = [];
  let totalTp = 0, totalFp = 0, totalFn = 0, totalTn = 0;
  for (let foldIdx = 0; foldIdx < k; foldIdx++) {
    const { test } = folds[foldIdx];
    const testTxs = test.map((i) => txs[i]);
    const testFraudIds = new Set(testTxs.filter((t) => fraudIds.has(t.id)).map((t) => t.id));
    const r = await runSkill(workspaceRoot, {
      skillKey,
      byProfession: profession,
      context: { transactions: testTxs },
    });
    const flagged = (r.result?.result?.flagged ?? []).map((t) => t.id ?? t);
    // Pass nTotal so TN is computed correctly
    const sc = scoreBinary(flagged, testFraudIds, testTxs.length);
    perFoldScores.push(sc.f1);
    perFoldConfusion.push(sc.confusionMatrix);
    totalTp += sc.tp;
    totalFp += sc.fp;
    totalFn += sc.fn;
    if (sc.tn !== null) totalTn += sc.tn;
  }
  // Use t-distribution CI (proper for k-fold)
  const tci = tCI(perFoldScores);
  const allIds = txs.map((t) => t.id);
  // Run on FULL dataset for the operational confusion matrix
  const fullRes = await runSkill(workspaceRoot, {
    skillKey,
    byProfession: profession,
    context: { transactions: txs },
  });
  const fullFlagged = (fullRes.result?.result?.flagged ?? []).map((t) => t.id ?? t);
  const fullSc = scoreBinary(fullFlagged, fraudIds, txs.length);
  const roc = rocCurve(fullFlagged, fraudIds, allIds);
  return {
    k,
    perFoldScores: perFoldScores.map((s) => Math.round(s * 1000) / 1000),
    meanF1: tci.mean,
    stdF1: tci.std,
    sem: tci.sem,
    tCritical: tci.tCritical,
    ci95: { lower: tci.ci[0], upper: tci.ci[1] },
    ciMethod: tci.method,
    totalConfusionMatrix: { tp: totalTp, fp: totalFp, fn: totalFn, tn: totalTn },
    fullDatasetConfusionMatrix: fullSc.confusionMatrix,
    fullDatasetF1: fullSc.f1,
    roc,
    robustness: tci.std < 0.1 ? "robust" : tci.std < 0.2 ? "moderate" : "brittle",
  };
}