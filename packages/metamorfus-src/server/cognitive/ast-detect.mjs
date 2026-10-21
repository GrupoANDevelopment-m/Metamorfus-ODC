// server/cognitive/ast-detect.mjs
// JS wrapper around the Python AST analyzer. Calls ast-analyzer.py
// via spawn to get reliable signal-type detection for each skill.
//
// BUG FIX #4: Replaces the fragile regex-based detection in
// meta-orchestrator.mjs. AST parsing is more robust because it
// understands Python's actual structure (imports, function calls,
// control flow, return shape) rather than matching substrings.

import { spawn } from "node:child_process";
import path from "node:path";
import { packageRoot } from "../package-root.mjs";

// Resolved from this module's own location — see server/package-root.mjs.
// The literal sandbox path this replaced only existed on one machine.
const ROOT = packageRoot();

/**
 * Detect signal types for one or more skills by parsing their
 * Python source via the AST analyzer.
 *
 * @param {string} workspaceRoot
 * @param {string[]} skillKeys — the skills to analyze
 * @returns {Promise<Record<string, {signalTypes: string[], signalCounts: object, details: object}>>}
 */
export async function detectSignalTypesAST(workspaceRoot, skillKeys) {
  const analyzerPath = path.join(ROOT, "server", "cognitive", "ast-analyzer.py");
  const dnaDir = path.join(workspaceRoot, "packages", "metamorfus-src", "dna_library");
  const skillPaths = skillKeys.map((k) => path.join(dnaDir, `${k}.py`));

  return new Promise((resolve) => {
    const p = spawn("python3", [analyzerPath, ...skillPaths], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("exit", (code) => {
      if (code !== 0) {
        resolve({});
        return;
      }
      try {
        const results = JSON.parse(out);
        const map = {};
        for (let i = 0; i < skillKeys.length; i++) {
          const r = results[i] ?? {};
          map[skillKeys[i]] = {
            signalTypes: r.signal_types ?? [],
            signalCounts: r.signal_counts ?? {},
            details: r.details ?? {},
            error: r.error ?? null,
          };
        }
        resolve(map);
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Adaptive correlation threshold (BUG FIX #5).
 * Instead of a fixed 0.7, derive the threshold from the
 * actual distribution of pairwise correlations in the
 * candidate set. If all skills are highly correlated, raise
 * the threshold to be more selective. If they're diverse,
 * lower it.
 *
 * Formula:
 *   threshold = median(correlations) + 0.1
 *   clamp to [0.4, 0.85]
 *   +0.05 * (n_skills - 2) to favor diversity in larger sets
 */
export function adaptiveThreshold(correlations) {
  if (!Array.isArray(correlations) || correlations.length === 0) return 0.7;
  // Filter out self-correlations (1.0)
  const offDiag = correlations.filter((c) => c < 0.99);
  if (offDiag.length === 0) return 0.7;
  const sorted = [...offDiag].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = offDiag.reduce((a, b) => a + b, 0) / offDiag.length;
  // Use the mean of median and mean, with a small boost for sets with many skills
  const n = Math.sqrt(offDiag.length + 1);
  const base = (median + mean) / 2;
  const threshold = base + 0.05 * Math.log(n);
  return Math.max(0.4, Math.min(0.85, threshold));
}

/**
 * Build a correlation matrix and return both the matrix and
 * the adaptive threshold that should be used for selection.
 */
export async function buildAdaptiveSelection(skillOutputs, inputs) {
  const { complementarityMatrix } = await import(path.join(ROOT, "server/cognitive/complementarity.mjs"));
  const matrix = complementarityMatrix(skillOutputs, inputs);
  // Flatten to get all pairwise correlations (excluding diagonal)
  const corrs = [];
  for (let i = 0; i < matrix.length; i++) {
    for (let j = i + 1; j < matrix.length; j++) {
      corrs.push(matrix[i][j]);
    }
  }
  const threshold = adaptiveThreshold(corrs);
  return { matrix, threshold, correlations: corrs };
}