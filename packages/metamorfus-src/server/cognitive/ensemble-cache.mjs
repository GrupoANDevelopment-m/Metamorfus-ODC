// server/cognitive/ensemble-cache.mjs
// Opção 4: Persistent cache of which skill combinations worked
// for which task types. Reuses successful ensembles on similar
// future tasks.
//
// Real-world references:
//   - Meta-learning: https://github.com/google-research/meta-learning
//   - Auto-sklearn's meta-features:
//     https://automl.github.io/auto-sklearn/master/components.html#meta-features
//   - AutoGluon's bagging/stacking:
//     https://github.com/autogluon/autogluon/blob/master/timeseries/src/autogluon/timeseries/models/ensemble/

import path from "node:path";
import fs from "node:fs/promises";

const ROOT = "/workspace/metamorfus-opencode/packages/metamorfus-src";

/**
 * Persistent cache of (task_signature → ensemble) mappings with
 * historical scores. Stored as JSON in dna_library/ensemble_cache.json
 * (which is in the dna_library directory, not subject to manifest
 * corruption).
 */
export class EnsembleCache {
  constructor(workspaceRoot) {
    this.path = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library", "ensemble_cache.json");
    this.entries = [];
  }
  async load() {
    try {
      const raw = await fs.readFile(this.path, "utf-8");
      this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
    return this;
  }
  async save() {
    await fs.writeFile(this.path, JSON.stringify(this.entries, null, 2));
  }

  /**
   * Compute a signature for a task. The signature is the
   * set of signal types the task needs — same task type
   * = same signature, regardless of exact wording.
   */
  static async signatureForTask(taskDescription) {
    const { classifyTaskSignals } = await import(path.join(ROOT, "server/cognitive/meta-orchestrator.mjs"));
    const sigs = classifyTaskSignals(taskDescription).sort().join("|");
    return sigs || "generic";
  }

  /**
   * Record that a particular combination of skills was used
   * for a task and got a particular score.
   */
  async record(taskDescription, skillKeys, score, details = {}) {
    const sig = await EnsembleCache.signatureForTask(taskDescription);
    this.entries.push({
      at: new Date().toISOString(),
      task: taskDescription,
      signature: sig,
      skills: [...skillKeys].sort(),
      score,
      details,
    });
    await this.save();
  }

  /**
   * Look up the best historical ensemble for a task.
   * Returns the highest-scoring combination whose signature
   * matches the current task, or null if none.
   */
  async suggest(taskDescription, threshold = 0.5) {
    const sig = await EnsembleCache.signatureForTask(taskDescription);
    // Find all entries with this signature
    const matching = this.entries.filter((e) => e.signature === sig);
    if (matching.length === 0) return null;
    // Group by skill combination
    const byCombo = new Map();
    for (const e of matching) {
      const key = e.skills.join(",");
      if (!byCombo.has(key)) byCombo.set(key, { skills: e.skills, scores: [], details: [] });
      byCombo.get(key).scores.push(e.score);
      byCombo.get(key).details.push(e.details);
    }
    // Pick the combo with highest mean score
    let best = null, bestMean = -1;
    for (const v of byCombo.values()) {
      const mean = v.scores.reduce((a, b) => a + b, 0) / v.scores.length;
      if (mean > bestMean) {
        bestMean = mean;
        best = v;
      }
    }
    if (bestMean < threshold) return null;
    return {
      skills: best.skills,
      meanScore: bestMean,
      uses: best.scores.length,
    };
  }

  /**
   * Get all entries for analysis.
   */
  getEntries() { return [...this.entries]; }

  /**
   * Summary statistics.
   */
  summary() {
    const bySig = new Map();
    for (const e of this.entries) {
      if (!bySig.has(e.signature)) bySig.set(e.signature, []);
      bySig.get(e.signature).push(e);
    }
    const out = {};
    for (const [sig, entries] of bySig.entries()) {
      const scores = entries.map((e) => e.score);
      out[sig] = {
        count: entries.length,
        meanScore: scores.reduce((a, b) => a + b, 0) / scores.length,
        bestScore: Math.max(...scores),
        uniqueCombos: new Set(entries.map((e) => e.skills.join(","))).size,
      };
    }
    return out;
  }
}