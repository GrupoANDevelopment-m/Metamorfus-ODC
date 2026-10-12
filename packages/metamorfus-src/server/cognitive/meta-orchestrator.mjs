// server/cognitive/meta-orchestrator.mjs
// Opção 3: Meta-aware orchestrator — combines skills by SIGNAL TYPE,
// not just by profession.
//
// Real-world reference:
//   - Auto-sklearn's meta-learning: https://github.com/automl/auto-sklearn
//   - FLAML: https://github.com/microsoft/FLAML
//   - AutoGluon's model zoo: https://github.com/autogluon/autogluon
//
// The principle: instead of asking "what profession has skill X?",
// ask "what SIGNAL does skill X produce?" A trader skill that
// computes RSI produces a STATISTICAL signal. A meteorology skill
// that computes pressure gradient also produces a STATISTICAL
// signal. Combining two STATISTICAL skills is redundant; combining
// STATISTICAL + TEMPORAL + GRAPH is complementary.

/**
 * Signal taxonomy. Each skill maps to one or more signal types
 * based on what it actually computes, not which profession it
 * belongs to. The taxonomy is derived from real anomaly-detection
 * literature (Chandola et al., 2009; Goldstein & Uchida, 2016).
 */
export const SIGNAL_TYPES = {
  STATISTICAL: "statistical",   // mean, stdev, percentile, z-score
  TEMPORAL: "temporal",         // time-of-day, velocity, sequences
  GRAPH: "graph",               // connected components, hubs, paths
  CATEGORICAL: "categorical",   // rare categories, mode, frequency
  MAGNITUDE: "magnitude",       // absolute value, range, threshold
  PATTERN: "pattern",           // shape, sequence, motif matching
  ANOMALY: "anomaly",           // outlier scoring, isolation
};

/**
 * Auto-detect signal type from a skill's source code. We scan
 * for keywords that correspond to each signal type. This is
 * static analysis — no execution, no LLM call needed.
 *
 * Real-world analog: sklearn's ClassifierValidator or AutoML's
 * data-type inference.
 */
export function detectSignalTypes(skillKey, pythonSource) {
  if (!pythonSource) return [];
  const src = pythonSource.toLowerCase();
  const types = [];
  // STATISTICAL: mean, stdev, percentile, distribution
  if (/\b(mean|average|std|standard|var|variance|percentile|median|distribution|sigma|outlier|anomal)\b/.test(src)) {
    types.push(SIGNAL_TYPES.STATISTICAL);
  }
  // TEMPORAL: time, hour, sequence, velocity, recent
  if (/\b(time|hour|second|day|night|sequence|velocity|recent|delta|change|next|previous|trend)\b/.test(src)) {
    types.push(SIGNAL_TYPES.TEMPORAL);
  }
  // GRAPH: edges, nodes, hub, path, connection
  if (/\b(edge|node|graph|hub|path|connection|adjacent|cluster|component|degree|neighbor)\b/.test(src)) {
    types.push(SIGNAL_TYPES.GRAPH);
  }
  // CATEGORICAL: merchant, category, type, rare
  if (/\b(merchant|category|type|class|label|tag|kind|rare|frequent|unique|distinct)\b/.test(src)) {
    types.push(SIGNAL_TYPES.CATEGORICAL);
  }
  // MAGNITUDE: threshold, max, min, range
  if (/\b(threshold|max|minimum|range|absolute|abs\(|>)\b/.test(src)) {
    types.push(SIGNAL_TYPES.MAGNITUDE);
  }
  // PATTERN: regex, motif, sequence matching
  if (/\b(pattern|regex|match|findall|substring|contains|startswith|endswith)\b/.test(src)) {
    types.push(SIGNAL_TYPES.PATTERN);
  }
  // ANOMALY: explicit anomaly score
  if (/\b(anomal|outlier|suspicious|fraud|attack|intrusion|deviation|drift)\b/.test(src)) {
    types.push(SIGNAL_TYPES.ANOMALY);
  }
  return [...new Set(types)];
}

/**
 * Classify a task by what signal types it needs. The task
 * description is matched against the signal taxonomy.
 *
 * Real-world analog: AutoML's task-type detection (binary
 * classification, regression, time-series, graph).
 */
export function classifyTaskSignals(taskDescription) {
  const desc = (taskDescription ?? "").toLowerCase();
  const required = [];
  if (/fraud|suspicious|malicious|anomal|attack/.test(desc)) {
    required.push(SIGNAL_TYPES.ANOMALY, SIGNAL_TYPES.STATISTICAL);
  }
  if (/time|day|hour|sequence|trend|forecast/.test(desc)) {
    required.push(SIGNAL_TYPES.TEMPORAL, SIGNAL_TYPES.MAGNITUDE);
  }
  if (/graph|network|connection|cluster|hub/.test(desc)) {
    required.push(SIGNAL_TYPES.GRAPH);
  }
  if (/merchant|category|type|class|tag/.test(desc)) {
    required.push(SIGNAL_TYPES.CATEGORICAL);
  }
  if (/pattern|signature|regex|match/.test(desc)) {
    required.push(SIGNAL_TYPES.PATTERN);
  }
  if (/price|amount|magnitude|value|size/.test(desc)) {
    required.push(SIGNAL_TYPES.MAGNITUDE, SIGNAL_TYPES.STATISTICAL);
  }
  return [...new Set(required)];
}

/**
 * Pick the best set of skills for a task by matching signal types.
 * Greedy: cover the required signal types using the smallest set
 * of skills. Skills that add a NEW signal type are preferred.
 *
 * @param {Array<{skillKey, signalTypes}>} skillsWithTypes
 * @param {Array<string>} requiredSignals
 * @returns {Array<{skillKey, coveredSignals}>}
 */
export function selectSkillsForTask(skillsWithTypes, requiredSignals) {
  if (!requiredSignals || requiredSignals.length === 0) {
    return skillsWithTypes.slice(0, 1).map((s) => ({ skillKey: s.skillKey, coveredSignals: s.signalTypes }));
  }
  const selected = [];
  const covered = new Set();
  for (const req of requiredSignals) {
    // Find skills that have this signal type and add the most NEW types
    const candidates = skillsWithTypes
      .filter((s) => s.signalTypes.includes(req))
      .map((s) => {
        const newTypes = s.signalTypes.filter((t) => !covered.has(t));
        return { ...s, newTypes };
      })
      .sort((a, b) => b.newTypes.length - a.newTypes.length);
    if (candidates.length > 0) {
      const best = candidates[0];
      if (!selected.find((s) => s.skillKey === best.skillKey)) {
        selected.push({ skillKey: best.skillKey, coveredSignals: best.signalTypes });
        best.signalTypes.forEach((t) => covered.add(t));
      }
    }
  }
  return selected;
}

/**
 * The full meta-orchestration: given a workspace and a task,
 * returns the optimal skill selection with reasoning.
 */
export async function metaOrchestrate(workspaceRoot, taskDescription, candidateSkills) {
  const required = classifyTaskSignals(taskDescription);
  const selected = selectSkillsForTask(candidateSkills, required);
  const covered = new Set(selected.flatMap((s) => s.coveredSignals));
  const missing = required.filter((r) => !covered.has(r));
  return {
    task: taskDescription,
    requiredSignals: required,
    selectedSkills: selected.map((s) => s.skillKey),
    coveredSignals: [...covered],
    missingSignals: missing,
    recommendation: missing.length === 0
      ? `selected ${selected.length} skills covering all required signals`
      : `missing ${missing.length} signal types (${missing.join(", ")}) — consider forging a new skill`,
  };
}