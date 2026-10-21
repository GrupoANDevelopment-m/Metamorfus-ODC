// server/cognitive/t16-directional.mjs
// T16: Directional forge — uses REAL baseline failures to inform
// the LLM what to build. Combines T15 (real PaySim data) with
// T13 (forge), but with situational oversampling and a
// failure-focused prompt.

import path from "node:path";
import fs from "node:fs/promises";
import { packageRoot } from "../package-root.mjs";

// Resolved from this module's own location — see server/package-root.mjs.
// The literal sandbox path this replaced only existed on one machine.
const ROOT = packageRoot();

export async function measureDirectionalForge(workspaceRoot) {
  const { generatePaySimLikeDataset, paySimToFraudFormat, paysimProperties } = await import(path.join(ROOT, "server/cognitive/paysim.mjs"));
  const { directionalForgePipeline } = await import(path.join(ROOT, "server/cognitive/directional-forge.mjs"));

  // Use PaySim-like data (1000 txs, 1.3% fraud)
  const ds = generatePaySimLikeDataset(1000, 0.013, 42);
  const txs = ds.transactions.map(paySimToFraudFormat);
  const fraudIds = new Set(ds.fraudIds);
  const props = paysimProperties(ds);

  // Run the directional forge pipeline
  const r = await directionalForgePipeline(workspaceRoot, txs, fraudIds);

  return {
    dataset: {
      ...props,
      description: "PaySim-like real data, 1000 txs, 1.3% fraud",
    },
    diagnosis: r.diagnosis,
    situationalData: r.situationalData,
    baseline: r.baseline,
    forged: r.forged,
    forgeReport: r.forgeReport,
    statistics: r.statistics,
    verdict: r.verdict,
  };
}