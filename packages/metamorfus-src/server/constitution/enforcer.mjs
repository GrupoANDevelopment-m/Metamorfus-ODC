// server/constitution/enforcer.mjs
// Real constitutional enforcement. The organism has a constitution
// stored in manifest.constitution — a list of immutable rules and
// protected modules. Every proposed action (skill invoke, plan, or
// chat answer) is checked against the constitution. When a violation
// is detected, the action is rejected with the specific rule that
// fired.
//
// The constitution is loaded from the manifest on disk. It is built
// up over time as the operator adds rules (or it defaults to a small
// baseline that mirrors the original Metamorfus design — no forget(),
// append-only DNA library, protected metamorphosis).

export const DEFAULT_CONSTITUTION = {
  rules: [
    {
      id: "no-delete",
      kind: "structural",
      text: "DNA library is append-only. No skill may be deleted, only retired (marked archaeology) and superseded by a new version.",
    },
    {
      id: "no-forget",
      kind: "structural",
      text: "There is no forget() function. Past skills remain in the manifest with their usage_history and archaeology intact.",
    },
    {
      id: "metamorphosis-record",
      kind: "structural",
      text: "Every metamorphosis must be recorded in state.history with a timestamp and prior/new profession.",
    },
    {
      id: "no-unsafe-shell",
      kind: "safety",
      text: "Skills must not execute shell commands that mutate or destroy data outside their working directory.",
    },
    {
      id: "no-pii-exfil",
      kind: "ethics",
      text: "Skills must not transmit personally identifiable information, credentials, or system secrets to external endpoints.",
    },
    {
      id: "no-coercion",
      kind: "ethics",
      text: "Skills must not coerce, threaten, or impersonate real persons or institutions.",
    },
    {
      id: "provenance",
      kind: "epistemic",
      text: "When a skill makes a factual claim about the external world, it must cite its source or report uncertainty.",
    },
  ],
  protected_modules: [
    "metamorfus-core/metamorph.ts",
    "metamorfus-core/seed-sources.ts",
    "metamorfus-core/professions.ts",
  ],
  ethics: [
    "do not generate content that targets protected groups",
    "do not provide instructions that enable mass harm",
    "honor user consent and explain what data is leaving the system",
  ],
};

let _llmJudge = null;
async function getJudge() {
  if (_llmJudge) return _llmJudge;
  // Lazy import so the constitution module is not coupled to the
  // llm-library at module-load time.
  const { LlmLibraryStore } = await import("../llm-library/store.mjs");
  const { LlmRouter } = await import("../llm-library/router.mjs");
  const fs = await import("node:fs");
  const path = "/tmp/metamorfus-constitution-library.json";
  try { if (fs.existsSync(path)) fs.unlinkSync(path); } catch {}
  const store = new LlmLibraryStore(path);
  await store.load();
  if (process.env.NVIDIA_API_KEY) {
    const hasReasoning = store.list({ category: "reasoning" }).length > 0;
    if (!hasReasoning) {
      store.add({
        name: "Constitution judge (env)",
        provider: "nvidia-direct",
        category: "reasoning",
        endpoint: "https://integrate.api.nvidia.com/v1/chat/completions",
        apiKey: process.env.NVIDIA_API_KEY,
        model: "moonshotai/kimi-k3",
        priority: 5,
        metadata: { contextWindow: 128000, source: "constitution-enforcer" },
      });
      await store.save();
    }
  }
  _llmJudge = new LlmRouter(store);
  return _llmJudge;
}

/**
 * Apply the default constitution to a manifest if the manifest doesn't
 * already have one. Idempotent.
 */
export function ensureConstitution(manifest) {
  if (!manifest.constitution) {
    manifest.constitution = JSON.parse(JSON.stringify(DEFAULT_CONSTITUTION));
  }
  return manifest.constitution;
}

/**
 * Structural rules are checked in code (cheap, deterministic). Each
 * returns { ok, violated }.
 */
export function checkStructural(action, manifest) {
  const violations = [];
  const c = ensureConstitution(manifest);

  if (action?.type === "delete_skill") {
    const r = c.rules.find((x) => x.id === "no-delete");
    if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: "delete attempted" });
  }
  if (action?.type === "forget_skill") {
    const r = c.rules.find((x) => x.id === "no-forget");
    if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: "forget attempted" });
  }
  if (action?.type === "metamorphose" && !action.recorded) {
    const r = c.rules.find((x) => x.id === "metamorphosis-record");
    if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: "metamorphosis without history record" });
  }
  if (action?.type === "invoke_skill" && typeof action.shellCommand === "string") {
    const cmd = action.shellCommand;
    const destructive = /\b(rm\s+-rf|rm\s+-fr|mkfs|dd\s+if=|:\(\)\s*\{|>\s*\/dev\/sda)\b/;
    if (destructive.test(cmd)) {
      const r = c.rules.find((x) => x.id === "no-unsafe-shell");
      if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: `command: ${cmd}` });
    }
  }
  if (action?.type === "invoke_skill" && action.outboundUrl) {
    const url = String(action.outboundUrl);
    const piiPattern = /(api[_-]?key|password|secret|token)\s*[:=]/i;
    if (piiPattern.test(JSON.stringify(action.params ?? {}))) {
      const r = c.rules.find((x) => x.id === "no-pii-exfil");
      if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: "params look like credentials" });
    }
  }
  if (action?.text) {
    const t = String(action.text).toLowerCase();
    if (/\b(make a bomb|kill (people|them|him|her)|commit genocide|ethnic cleansing)\b/.test(t)) {
      const r = c.rules.find((x) => x.id === "no-coercion");
      if (r) violations.push({ ruleId: r.id, kind: r.kind, text: r.text, why: "explicit harm request" });
    }
  }

  return { ok: violations.length === 0, violations };
}

/**
 * Epistemic check: when a skill makes a factual claim, the LLM judge
 * evaluates whether the claim is grounded or speculative. The judge
 * is asked to return a JSON object with `grounded: bool`, `evidence`
 * (quoted snippet from the claim), and `confidence: 0-1`. This is
 * the LLM-as-judge path — it costs a real API call.
 */
export async function checkEpistemic(claim, context = {}) {
  if (!claim || typeof claim !== "string") {
    return { ok: true, reason: "no claim to check" };
  }
  const r = await getJudge();
  const result = await r.complete("reasoning", {
    messages: [
      {
        role: "system",
        content:
          "You are the organism's constitutional epistemic enforcer. " +
          "Evaluate whether the following claim is grounded (supported by " +
          "evidence the organism actually has) or speculative (fabricated). " +
          "Return STRICT JSON: {\"grounded\": <bool>, \"confidence\": <0-1>, " +
          "\"evidence\": \"<quoted snippet>\", \"reasoning\": \"<one paragraph>\"}.",
      },
      {
        role: "user",
        content: `Claim to evaluate: ${claim}\n\nContext available: ${JSON.stringify(context).slice(0, 3000)}`,
      },
    ],
    temperature: 0.1,
    maxTokens: 1024,
  });
  const text = result.content || "";
  const m = text.match(/\{[\s\S]*\}/);
  let parsed = { grounded: true, confidence: 0.5, evidence: "", reasoning: text.slice(0, 200) };
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch {}
  }
  return {
    ok: parsed.grounded !== false,
    parsed,
    usage: result.usage,
  };
}

/**
 * Composite check: structural first (cheap, deterministic), then
 * epistemic if the action involves a factual claim.
 */
export async function checkAction(action, manifest) {
  const structural = checkStructural(action, manifest);
  if (!structural.ok) {
    return { ok: false, stage: "structural", ...structural };
  }
  if (action?.claim) {
    const epistemic = await checkEpistemic(action.claim, { manifest: { profession: manifest.state?.profession } });
    if (!epistemic.ok) {
      return { ok: false, stage: "epistemic", ...epistemic };
    }
    return { ok: true, stage: "epistemic", ...epistemic };
  }
  return { ok: true, stage: "structural", ...structural };
}