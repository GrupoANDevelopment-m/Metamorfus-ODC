// Prompt Planner — converts a free-form system prompt into a structured
// metamorphosis plan. The cortex LLM does the heavy lifting; this module
// wraps the LLM call with the right system prompt and JSON extraction.
//
// The output is the same shape the dashboard's "Profession" panel
// already renders, but it's the version the orchestrator can EXECUTE.

import crypto from "node:crypto";

const PLAN_SYSTEM = `//MARKER:METAMORPH_PLANNER//
You are the cortex of the Metamorfos ODC organism. A user wants to metamorph the organism into a new system. Produce a JSON-only plan describing the steps to make it real.

Output ONLY valid JSON of this shape:
{
  "id": "<morphosis-uuid>",
  "domain": "<snake_case identifier>",
  "rationale": "<1-2 sentences in Portuguese (BR) explaining what the organism must become>",
  "capabilities": ["<capability 1>", "<capability 2>", "..."],
  "plan": {
    "steps": [
      {
        "stepId": "step-<n>",
        "kind": "forge_skill" | "pip_install" | "git_clone" | "record_metamorphose",
        "skillKey": "<snake_case>_protocol",
        "pythonSource": "<python source string>",
        "package": "<pip package name>",
        "url": "<git url>",
        "rationale": "<one-line explanation in pt-BR>"
      }
    ]
  },
  "estimatedTime": "<short estimate>"
}

Constraints:
- Use kind "forge_skill" for any skill the organism needs to write (it goes into DNA library).
- Each forge_skill step MUST include a valid pythonSource for the skill(organism, context) function.
- Use kind "pip_install" for Python packages the new skills need.
- End with a "record_metamorphose" step that records this transformation in the organism's history.
- Do NOT include any prose, markdown fences, or explanation. Output only JSON.`;

export class PromptPlanner {
  /**
   * @param {import("../llm-library/router.mjs").LlmRouter} router  LLM router
   * @param {"text"|"reasoning"} [category]  which category to use
   */
  constructor(router, category = "reasoning") {
    this.router = router;
    this.category = category;
  }

  /**
   * Plan a metamorphosis from a free-form system prompt.
   * @param {string} systemPrompt
   * @returns {Promise<{id: string, systemPrompt: string, plan: any, raw: string, attempts: any[]}>}
   */
  async plan(systemPrompt) {
    if (typeof systemPrompt !== "string" || systemPrompt.trim().length === 0) {
      throw new Error("systemPrompt is required");
    }
    const result = await this.router.complete(this.category, {
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: systemPrompt.trim() },
      ],
      temperature: 0.4,
      maxTokens: 4096,
    });
    // Extract the JSON block from the LLM response.
    const m = (result.content || "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("cortex did not return a JSON plan");
    let parsed;
    try {
      parsed = JSON.parse(m[0]);
    } catch (e) {
      throw new Error(`cortex returned invalid JSON: ${e.message}`);
    }
    // Normalize: ensure id + step ids exist.
    if (!parsed.id) parsed.id = `morph-${crypto.randomUUID()}`;
    (parsed.plan?.steps ?? []).forEach((s, i) => {
      if (!s.stepId) s.stepId = `step-${i + 1}`;
    });
    return {
      id: parsed.id,
      systemPrompt,
      plan: parsed,
      raw: result.content,
      model: result.model,
      provider: result.provider,
      attempts: result.attempts ?? [],
    };
  }
}

/**
 * Default skill templates the planner can use when it doesn't know
 * what code to write. Each template is a Python function body.
 */
export const SKILL_TEMPLATES = {
  arxiv_search_protocol:
`def skill(organism, context):
    """Search arxiv for papers matching the query."""
    import urllib.request, urllib.parse, json
    q = context.get("query", "")
    url = f"http://export.arxiv.org/api/query?search_query={urllib.parse.quote(q)}&max_results=5"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            data = resp.read().decode("utf-8", errors="ignore")
        return {"action": "ARXIV_SEARCH", "intensity": 0.6, "version": 1, "params": {"query": q, "fetched_bytes": len(data)}}
    except Exception as e:
        return {"action": "ARXIV_SEARCH_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}
`,
  pdf_extract_protocol:
`def skill(organism, context):
    """Extract text from a PDF."""
    pdf_path = context.get("path", "")
    try:
        import PyPDF2
        with open(pdf_path, "rb") as f:
            reader = PyPDF2.PdfReader(f)
            text = "".join(p.extract_text() or "" for p in reader.pages)
        return {"action": "PDF_EXTRACT", "intensity": 0.5, "version": 1, "params": {"path": pdf_path, "pages": len(reader.pages), "chars": len(text)}}
    except Exception as e:
        return {"action": "PDF_EXTRACT_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}
`,
  market_data_protocol:
`def skill(organism, context):
    """Fetch market data for a symbol."""
    symbol = context.get("symbol", "BTC/USDT")
    try:
        import ccxt
        ex = ccxt.binance()
        ticker = ex.fetch_ticker(symbol)
        return {"action": "MARKET_DATA", "intensity": 0.5, "version": 1, "params": {"symbol": symbol, "price": ticker.get("last")}}
    except Exception as e:
        return {"action": "MARKET_DATA_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}
`,
  http_fetch_protocol:
`def skill(organism, context):
    """Fetch a URL."""
    import urllib.request, json
    url = context.get("url", "")
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="ignore")
        return {"action": "HTTP_FETCH", "intensity": 0.4, "version": 1, "params": {"url": url, "bytes": len(body)}}
    except Exception as e:
        return {"action": "HTTP_FETCH_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}
`,
  port_scan_protocol:
`def skill(organism, context):
    """Scan a host for open ports."""
    host = context.get("host", "127.0.0.1")
    ports = context.get("ports", [22, 80, 443])
    import socket
    open_ports = []
    for p in ports:
        try:
            with socket.create_connection((host, p), timeout=1):
                open_ports.append(p)
        except Exception:
            pass
    return {"action": "PORT_SCAN", "intensity": 0.6, "version": 1, "params": {"host": host, "open": open_ports}}
`,
  generic_skill_protocol:
`def skill(organism, context):
    """Generic skill body — emits a CUSTOM_ACTION with the provided params."""
    target = context.get("target", "")
    return {
        "action": "CUSTOM_ACTION",
        "intensity": 0.5,
        "required_attributes": {"cpu": 10},
        "version": 1,
        "params": {"target": target},
    }
`,
};
