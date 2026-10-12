// server/cognitive/complementarity.mjs
// Opção 2: Signal Complementarity Detector
//
// Measures whether two skill outputs carry COMPLEMENTARY or
// REDUNDANT information. Two skills that always produce correlated
// outputs are redundant — combining them doesn't add new signal.
//
// Real-world reference implementations:
//   - numpy.corrcoef (Pearson)
//     https://numpy.org/doc/stable/reference/generated/numpy.corrcoef.html
//   - scipy.stats.spearmanr (rank-based, non-parametric)
//     https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html
//   - scikit-learn's mutual_info_score (information-theoretic)
//     https://scikit-learn.org/stable/modules/generated/sklearn.metrics.mutual_info_score.html
//
// We implement Pearson + Spearman in pure JS. The rule: combine only
// if correlation < 0.7 (in absolute value). Otherwise fall back to
// single-skill.

/**
 * Pearson correlation coefficient between two arrays.
 * Returns a value in [-1, 1]. 0 = no linear correlation.
 * Returns 0 if either array has zero variance or length < 2.
 */
export function pearson(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y)) return 0;
  if (x.length !== y.length) return 0;
  const n = x.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx, b = y[i] - my;
    num += a * b;
    dx2 += a * a;
    dy2 += b * b;
  }
  const den = Math.sqrt(dx2 * dy2);
  return den === 0 ? 0 : num / den;
}

/**
 * Spearman rank correlation. Convert values to ranks, then
 * compute Pearson on the ranks. Robust to non-linearity.
 */
export function spearman(x, y) {
  if (!Array.isArray(x) || !Array.isArray(y)) return 0;
  if (x.length !== y.length) return 0;
  const rankify = (arr) => {
    const indexed = arr.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let i = 0; i < indexed.length; i++) ranks[indexed[i].i] = i + 1;
    return ranks;
  };
  return pearson(rankify(x), rankify(y));
}

/**
 * Extract a comparable scalar series from a skill's output.
 * Each skill returns a different shape; we project to a
 * common representation: an array of per-input scores.
 *
 * For fraud: we use the "flagged" set as a {0,1} series
 * (1 = flagged, 0 = not flagged). For numeric skills: we
 * use the rsi / intensity field.
 */
export function skillOutputToSeries(skillKey, skillResult, inputs) {
  if (!skillResult || !skillResult.ok) return inputs.map(() => 0);
  const inner = skillResult.result?.result ?? {};
  // Fraud-like skills return flagged[] — convert to 0/1 per input id
  if (Array.isArray(inner.flagged)) {
    const flaggedIds = new Set(inner.flagged.map((t) => t?.id ?? t).filter(Boolean));
    return inputs.map((inp) => (flaggedIds.has(inp?.id) || flaggedIds.has(inp) ? 1 : 0));
  }
  // RSI skill
  if (typeof inner.rsi === "number") {
    return inputs.map(() => inner.rsi / 100);
  }
  // Generic intensity
  if (typeof skillResult.result?.intensity === "number") {
    return inputs.map(() => skillResult.result.intensity);
  }
  return inputs.map(() => 0);
}

/**
 * Compute the complementarity matrix for a set of skill outputs.
 * Returns a matrix where M[i][j] = correlation between skill i and j.
 * Lower (closer to 0) = more complementary.
 */
export function complementarityMatrix(skillOutputs, inputs) {
  const series = skillOutputs.map((s) => skillOutputToSeries(s.skillKey, s.result, inputs));
  const n = series.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      if (i === j) { matrix[i][j] = 1; continue; }
      const p = Math.abs(pearson(series[i], series[j]));
      const s = Math.abs(spearman(series[i], series[j]));
      // Use the more conservative (higher) of Pearson and Spearman
      const corr = Math.max(p, s);
      matrix[i][j] = corr;
      matrix[j][i] = corr;
    }
  }
  return matrix;
}

/**
 * Given a set of skill outputs, return the SUBSET that adds
 * the most novel signal. Greedy: start with the highest-intensity
 * skill, then add skills with correlation < threshold to the
 * already-selected set.
 *
 * BUG FIX #1: Now also requires at least ONE domain-matched skill
 * to be in the selection. The previous version would reject
 * fraud_anomaly_protocol in favor of analyze_pressure_gradient_protocol
 * because both produced mostly-zero series (high correlation) and
 * the greedy algorithm picked the slightly-less-zero one. That's
 * wrong — the fraud skill MUST be in the selection for fraud tasks.
 *
 * @param {Array<{skillKey, result, domain?}>} skillOutputs
 * @param {Array} inputs
 * @param {number} threshold
 * @param {string} targetDomain — the domain of the task (e.g. "fraud_analyst")
 * @returns {Array<string>} selected skill keys
 */
export function selectComplementarySkills(skillOutputs, inputs, threshold = 0.7, targetDomain = null) {
  if (skillOutputs.length === 0) return [];
  if (skillOutputs.length === 1) return [skillOutputs[0].skillKey];

  const matrix = complementarityMatrix(skillOutputs, inputs);
  const selected = [];

  // 1. First, ensure the domain-matched skill is included
  if (targetDomain) {
    const domainIdx = skillOutputs.findIndex((s) => {
      // Check the byProfession or domain field
      const prof = s.result?.byProfession ?? s.domain ?? "";
      return prof === targetDomain;
    });
    if (domainIdx >= 0) selected.push(domainIdx);
  }

  // 2. Start with the skill that has highest mean output (most signal)
  const series = skillOutputs.map((s) => skillOutputToSeries(s.skillKey, s.result, inputs));
  const meanSignal = series.map((s) => s.reduce((a, b) => a + b, 0) / s.length);
  const firstIdx = meanSignal.indexOf(Math.max(...meanSignal));
  if (!selected.includes(firstIdx)) selected.push(firstIdx);

  for (let i = 0; i < skillOutputs.length; i++) {
    if (selected.includes(i)) continue;
    // Check correlation with all already-selected
    const maxCorr = Math.max(...selected.map((j) => matrix[i][j]));
    if (maxCorr < threshold) {
      selected.push(i);
    }
  }
  // If we ended up with only the domain-matched skill (because
  // everything else is too correlated), that's still correct —
  // it means the domain-matched skill is sufficient.
  return selected.map((i) => skillOutputs[i].skillKey);
}

/**
 * Explain why a set of skills was/wasn't selected.
 */
export function explainComplementarity(skillOutputs, inputs, threshold = 0.7, targetDomain = null) {
  const matrix = complementarityMatrix(skillOutputs, inputs);
  const selected = selectComplementarySkills(skillOutputs, inputs, threshold, targetDomain);
  const rejected = skillOutputs.map((s) => s.skillKey).filter((k) => !selected.includes(k));
  const pairs = [];
  for (let i = 0; i < skillOutputs.length; i++) {
    for (let j = i + 1; j < skillOutputs.length; j++) {
      pairs.push({
        a: skillOutputs[i].skillKey,
        b: skillOutputs[j].skillKey,
        correlation: matrix[i][j],
        complementary: matrix[i][j] < threshold,
      });
    }
  }
  return { selected, rejected, pairs, threshold, targetDomain };
}