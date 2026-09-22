// Integration test for the MHU 5.0 cognitive pipeline.
//
// Runs the REAL TypeScript implementation in mhu_engine.ts (no mock),
// since it's pure TypeScript and runs in the test process directly.
// Validates that every stage of the pipeline emits a usable structure
// that the headless server can inject into the LLM context.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MHU_5_ProtoODC } from "../../mhu_engine.js";

test("MHU: execute_pipeline produces a complete pipeline result", () => {
  const mhu = new MHU_5_ProtoODC();
  const result = mhu.execute_pipeline("Should I buy Bitcoin today?");
  assert.ok(result, "result must exist");
  // Validate every field used by server.ts and headless-server.mjs.
  assert.equal(typeof result.causal_analysis, "object");
  assert.ok(Array.isArray(result.universal_laws));
  assert.ok(result.universal_laws.length >= 3);
  assert.equal(typeof result.graph_analysis, "object");
  assert.equal(typeof result.debate, "object");
  assert.equal(typeof result.tool_synthesis, "object");
  assert.equal(typeof result.bayesian_posterior, "number");
  assert.ok(result.bayesian_posterior >= 0 && result.bayesian_posterior <= 1);
  assert.equal(typeof result.counterfactuals, "object");
  assert.ok(Array.isArray(result.unknown_variables));
  assert.equal(typeof result.strategic_plan, "object");
  assert.ok(Array.isArray(result.recommendations));
  // The engine returns `meta_report` (not `metacognition_report`).
  assert.equal(typeof result.meta_report, "object");
  assert.equal(typeof result.session_id, "string");
  assert.ok(result.session_id.length > 0);
  assert.equal(typeof result.runtime_seconds, "number");
  assert.ok(result.runtime_seconds >= 0);
});

test("MHU: session_id is a non-empty unique-ish string", () => {
  const mhu = new MHU_5_ProtoODC();
  const a = mhu.execute_pipeline("first call");
  assert.equal(typeof a.session_id, "string");
  assert.ok(a.session_id.length >= 4);
});

test("MHU: recommendations are non-empty strings", () => {
  const mhu = new MHU_5_ProtoODC();
  const r = mhu.execute_pipeline("invest in gold");
  assert.ok(r.recommendations.length > 0);
  for (const rec of r.recommendations) {
    assert.equal(typeof rec, "string");
    assert.ok(rec.length > 0);
  }
});

test("MHU: tool_synthesis emits a non-empty descriptor", () => {
  const mhu = new MHU_5_ProtoODC();
  const r = mhu.execute_pipeline("summarize this paper");
  assert.ok(r.tool_synthesis);
  const asString = JSON.stringify(r.tool_synthesis);
  assert.ok(asString.length > 0);
});

test("MHU: the headless-server MHU context block serializes correctly", () => {
  // Replicates exactly what headless-server.mjs builds and asserts
  // the block is well-formed JSON-encodable.
  const mhu = new MHU_5_ProtoODC();
  const r = mhu.execute_pipeline("plan a research expedition");
  const block = `[MHU 5.0 COGNITIVE ORCHESTRATION]
- Causal Analysis: ${JSON.stringify(r.causal_analysis)}
- Universal Laws Applied: ${r.universal_laws.join(", ")}
- Strategic Plan: ${JSON.stringify(r.strategic_plan)}
- Recommendations: ${r.recommendations.join(", ")}
- Counterfactuals: ${JSON.stringify(r.counterfactuals)}`;
  const wrapped = { role: "system", content: block };
  const json = JSON.stringify(wrapped);
  const parsed = JSON.parse(json);
  assert.equal(parsed.role, "system");
  assert.match(parsed.content, /MHU 5\.0 COGNITIVE ORCHESTRATION/);
  assert.match(parsed.content, /Causal Analysis:/);
  assert.match(parsed.content, /Universal Laws Applied:/);
  assert.match(parsed.content, /Strategic Plan:/);
  assert.match(parsed.content, /Recommendations:/);
  assert.match(parsed.content, /Counterfactuals:/);
});

test("MHU: bayesian_posterior is a valid probability after each call", () => {
  const mhu = new MHU_5_ProtoODC();
  for (let i = 0; i < 3; i++) {
    const r = mhu.execute_pipeline(`trial ${i}`);
    assert.ok(r.bayesian_posterior >= 0 && r.bayesian_posterior <= 1,
      `trial ${i}: posterior=${r.bayesian_posterior}`);
  }
});

test("MHU: pipeline runs in < 200ms for trivial inputs", () => {
  const mhu = new MHU_5_ProtoODC();
  const t0 = Date.now();
  mhu.execute_pipeline("trivial");
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 200, `MHU took ${elapsed}ms, expected < 200ms`);
});

test("MHU: counterfactuals and unknown_variables are well-formed", () => {
  const mhu = new MHU_5_ProtoODC();
  const r = mhu.execute_pipeline("what if X?");
  assert.equal(typeof r.counterfactuals, "object");
  assert.ok(Array.isArray(r.unknown_variables));
  for (const v of r.unknown_variables) {
    assert.equal(typeof v, "string");
  }
});
