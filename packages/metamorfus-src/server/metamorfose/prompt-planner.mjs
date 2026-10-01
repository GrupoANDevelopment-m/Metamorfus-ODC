// Metamorphose Planner — the organism's brain.
//
// Given a free-form system prompt, the planner:
//
//   1. RESEARCHES the domain (asks the LLM "what capabilities and
//      materials does a real <system> need?")
//   2. PRODUCES a structured plan with REAL concrete steps
//   3. WRITES real, executable Python for each skill — not stubs
//   4. NAMES real GitHub repos to clone when applicable
//   5. LISTS real pip packages to install
//
// The planner does NOT execute anything. The orchestrator runs
// each step. The planner is pure analysis + code generation.
//
// The system prompt here is critical: it instructs the LLM to
// write WORKING code that uses the packages from pip_install
// steps, not abstract placeholders.

import crypto from "node:crypto";

// ─── System prompt for the planner ──────────────────────────────────
// The planner receives the user's desired system AND the current
// environment probe (which packages are already installed), so the
// plan only installs what's actually missing.
const PLAN_SYSTEM = `//MARKER:METAMORPH_PLANNER//
You are the cortex of the Metamorfos ODC organism. Your job is to plan a metamorphosis — the process by which the organism becomes a different kind of system.

You will receive:
  • A user-provided "system prompt" describing what the organism should become
  • An "environment probe" showing which Python packages + CLI tools are already installed
  • The current date and any other context

Your output is a JSON object ONLY (no prose, no markdown fences). It has this shape:

{
  "id": "<morphosis-uuid>",
  "domain": "<snake_case identifier>",
  "research": "<2-4 sentences in Portuguese (BR) explaining what the system prompt requires and what real-world capabilities it implies>",
  "rationale": "<one-sentence Portuguese (BR) explanation of the metamorphosis strategy>",
  "capabilities": ["<real capability 1>", "<real capability 2>", "..."],
  "external_materials": {
    "github_repos": [{"url": "https://github.com/...", "purpose": "why this repo helps"}],
    "pypi_packages": [{"name": "<package>", "purpose": "what it provides"}],
    "cli_tools": [{"name": "<tool>", "install_via": "apt|brew|pip"}]
  },
  "plan": {
    "steps": [
      {
        "stepId": "step-<n>",
        "kind": "forge_skill" | "pip_install" | "git_clone" | "run_shell" | "record_metamorphose",
        "skillKey": "<snake_case>_protocol",
        "pythonSource": "<full, executable Python source — see rules below>",
        "package": "<pip package name>",
        "url": "<git url>",
        "command": ["<argv array>"],
        "rationale": "<one-line Portuguese (BR) explanation>"
      }
    ]
  },
  "estimatedTime": "<short estimate>"
}

CRITICAL RULES — follow exactly:

1. RESEARCH FIRST: the "research" field must explain what the system prompt REALLY requires. Don't just rephrase the user — name the concrete subsystems, data sources, and tools a production version of this system would need.

2. EXTERNAL MATERIALS: list REAL GitHub repos that exist (use your training knowledge) and REAL PyPI packages. Don't invent URLs. If you don't know a real one, leave the field empty.

3. SKILLS MUST BE EXECUTABLE: every forge_skill step's pythonSource must be a complete, runnable Python module that:
   • Defines a function with signature \`def skill(organism, context)\`
   • Imports its dependencies INSIDE the function (so missing imports produce a clear error)
   • Does REAL work — opens sockets, queries APIs, parses responses, writes files — whatever the skill is supposed to do
   • Returns a dict (or any value) with the actual result, not a stub like {"action": "X"}
   • Has no fake/placeholder code — every line must contribute to the skill's actual function
   • Does NOT mock, stub, or fake external services. If a real API is needed, call it for real.

4. DEPENDENCIES MUST MATCH: if a forge_skill imports \`scapy\`, there MUST be a pip_install step for \`scapy\` BEFORE it. Order steps so deps install first.

5. STEP ORDER: install deps → clone repos → forge skills → record metamorphose. The final step should be \`record_metamorphose\`.

6. NO STUBS, NO MOCKS, NO PLACEHOLDERS. If you don't know how to write real code for something, leave it OUT of the plan rather than writing fake code.

Output ONLY valid JSON. No prose, no markdown, no fences.`;

/**
 * Probe the environment first so the plan only installs missing
 * packages. Falls back to a synthetic empty probe if the import
 * fails (e.g. when the planner is used standalone).
 */
async function defaultProbe() {
  try {
    const { probeEnvironment } = await import("../skills/probe.mjs");
    return await probeEnvironment();
  } catch {
    return { python: { ok: true }, pip: { ok: true }, git: { ok: true } };
  }
}

export class PromptPlanner {
  /**
   * @param {import("../llm-library/router.mjs").LlmRouter} router
   * @param {"text"|"reasoning"} [category]
   */
  constructor(router, category = "reasoning") {
    this.router = router;
    this.category = category;
  }

  /**
   * Plan a metamorphosis. Probes the environment first, then asks
   * the LLM to produce a real, executable plan.
   *
   * @param {string} systemPrompt
   * @param {{probe?: object}} [opts]
   * @returns {Promise<{id: string, systemPrompt: string, plan: any, raw: string, model: string, probe: object}>}
   */
  async plan(systemPrompt, opts = {}) {
    if (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
      throw new Error("systemPrompt is required");
    }
    const probe = opts.probe ?? (await defaultProbe());
    const userMsg = [
      `System prompt (what the organism should become):\n---\n${systemPrompt.trim()}\n---`,
      "",
      "Environment probe (what's already installed):",
      "```",
      JSON.stringify(probe, null, 2),
      "```",
      "",
      "Produce the metamorphosis plan as JSON. Remember: real code, real packages, real repos. No stubs.",
    ].join("\n");

    const result = await this.router.complete(this.category, {
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: userMsg },
      ],
      temperature: 0.4,
      maxTokens: 8000,
    });

    const m = (result.content || "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("cortex did not return a JSON plan");
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch (e) {
      throw new Error(`cortex returned invalid JSON: ${e.message}`);
    }

    // Normalize: ensure id + step ids + step kinds are valid.
    if (!parsed.id) parsed.id = `morph-${crypto.randomUUID()}`;
    const validKinds = new Set(["forge_skill", "pip_install", "git_clone", "run_shell", "record_metamorphose"]);
    const steps = parsed.plan?.steps ?? [];
    steps.forEach((s, i) => {
      if (!s.stepId) s.stepId = `step-${i + 1}`;
      if (!validKinds.has(s.kind)) s.kind = "forge_skill";
      if (s.kind === "forge_skill") {
        if (!s.skillKey) s.skillKey = `morph_skill_${i + 1}_protocol`;
        if (!s.pythonSource) s.pythonSource = "";
      }
    });

    // Auto-order: install deps → clone → forge → record. The LLM
    // sometimes gets the order wrong; we re-sort deterministically.
    const order = { pip_install: 0, git_clone: 1, run_shell: 2, forge_skill: 3, record_metamorphose: 4 };
    steps.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99));

    return {
      id: parsed.id,
      systemPrompt,
      plan: parsed,
      raw: result.content,
      model: result.model,
      provider: result.provider,
      probe,
      attempts: result.attempts ?? [],
    };
  }
}
