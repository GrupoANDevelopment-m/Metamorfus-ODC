// Multi-domain morph test — proves the organism is domain-agnostic.
// Same planner, same orchestrator, same invoker. Different system
// prompt → different REAL skills. No templates involved.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 3457);
const STUB_PORT = Number(process.argv[3] ?? 3458);
const AUTH = "Bearer dev-secret-local";

const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const sysMsg = parsed.messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = parsed.messages[parsed.messages.length - 1].content;

    let result;
    if (sysMsg.includes("MARKER:INTENT_CLASSIFIER")) {
      result = JSON.stringify({
        intent: "metamorphose",
        args: { systemPrompt: userMsg },
        reply: "Vou morfar.",
      });
    } else {
      // Domain-aware plan: the stub uses the system prompt to pick
      // which REAL Python code + REAL pip packages to write. This
      // mimics what a real LLM would do given the new planner's
      // "research real materials" instructions.
      const m = userMsg.toLowerCase();
      if (m.includes("pesquisa") || m.includes("research") || m.includes("paper")) {
        result = researchPlan(userMsg);
      } else if (m.includes("trading") || m.includes("crypto") || m.includes("bot")) {
        result = tradingPlan(userMsg);
      } else {
        result = genericPlan(userMsg);
      }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: result } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
console.log(`[stub] on ${STUB_PORT}`);

function researchPlan(prompt) {
  return JSON.stringify({
    id: `morph-research-${Date.now().toString(36)}`,
    domain: "research",
    research: "Um sistema de pesquisa científica precisa de: busca de papers (arxiv), extração de texto de PDFs, sumarização, e formatação de citações.",
    rationale: "Auto-expansão: arxiv + pypdf + transformers. Skills em stdlib quando possível.",
    capabilities: ["buscar papers no arXiv", "extrair texto de PDFs", "sumarizar texto"],
    plan: { steps: [
      { stepId: "s1", kind: "forge_skill", skillKey: "arxiv_search_v2_protocol",
        pythonSource: [
          '"""Real arxiv search using urllib (no external deps)."""',
          'import urllib.request, urllib.parse, json, re',
          '',
          'def skill(organism, context):',
          '    """Search arxiv.org for papers.',
          '    context: {"query": "transformer", "max_results": 5}',
          '    """',
          '    query = context.get("query", "")',
          '    max_results = min(int(context.get("max_results", 5)), 20)',
          '    if not query: return {"error": "query is required"}',
          '    url = ("http://export.arxiv.org/api/query?"',
          '           f"search_query={urllib.parse.quote(query)}&max_results={max_results}")',
          '    try:',
          '        with urllib.request.urlopen(url, timeout=15) as resp:',
          '            xml = resp.read().decode("utf-8", errors="replace")',
          '    except Exception as e:',
          '        return {"error": f"arxiv fetch failed: {e}"}',
          '    # Naive XML parsing — extract <entry> blocks',
          '    entries = re.findall(r"<entry>(.*?)</entry>", xml, re.DOTALL)',
          '    papers = []',
          '    for e in entries[:max_results]:',
          '        title_m = re.search(r"<title>(.*?)</title>", e, re.DOTALL)',
          '        id_m = re.search(r"<id>(.*?)</id>", e)',
          '        sum_m = re.search(r"<summary>(.*?)</summary>", e, re.DOTALL)',
          '        if title_m and id_m:',
          '            papers.append({',
          '                "title": re.sub(r"\\s+", " ", title_m.group(1)).strip(),',
          '                "url": id_m.group(1).strip(),',
          '                "summary_preview": (sum_m.group(1).strip()[:200] if sum_m else ""),',
          '            })',
          '    return {"query": query, "count": len(papers), "papers": papers}',
        ].join("\n"),
        rationale: "Real arxiv search via the public arxiv API (no API key needed)" },
      { stepId: "s2", kind: "forge_skill", skillKey: "text_summarizer_v2_protocol",
        pythonSource: [
          '"""Real text summarizer using simple frequency analysis."""',
          'import re, collections',
          '',
          'STOP_WORDS = set("""a an the and or but if then else when where why how what which who',
          'i me my we us our you your he she it they them his hers its their this that these those',
          'is are was were be been being have has had do does did will would shall should may might can could',
          'as at by for from in into of on to with about above below over under up down out off through""".split())',
          '',
          'def skill(organism, context):',
          '    """Summarize text by extracting the top-N most important sentences.',
          '    context: {"text": "...", "sentences": 3}',
          '    """',
          '    text = context.get("text", "")',
          '    n = int(context.get("sentences", 3))',
          '    if not text: return {"error": "text is required"}',
          '    # Split into sentences (naive)',
          '    sents = [s.strip() for s in re.split(r"[.!?]+", text) if len(s.strip()) > 10]',
          '    if not sents: return {"summary": text[:200], "method": "truncation"}',
          '    # Score each sentence by word frequency',
          '    words = [w.lower() for w in re.findall(r"\\b\\w+\\b", text.lower()) if w not in STOP_WORDS and len(w) > 2]',
          '    freq = collections.Counter(words)',
          '    scored = []',
          '    for i, s in enumerate(sents):',
          '        s_words = [w for w in re.findall(r"\\b\\w+\\b", s.lower()) if w not in STOP_WORDS]',
          '        score = sum(freq.get(w, 0) for w in s_words) / max(len(s_words), 1)',
          '        scored.append((score, i, s))',
          '    scored.sort(reverse=True)',
          '    top = sorted(scored[:n], key=lambda x: x[1])',
          '    return {"summary": " ".join(s for _, _, s in top), "method": "frequency"}',
        ].join("\n"),
        rationale: "Real extractive summarizer (no external deps)" },
      { stepId: "s3", kind: "record_metamorphose", rationale: "registrar metamorfose" },
    ]},
    estimatedTime: "10s",
  });
}

function tradingPlan(prompt) {
  return JSON.stringify({
    id: `morph-trading-${Date.now().toString(36)}`,
    domain: "trading",
    research: "Um sistema de trading precisa de: feed de preços, cálculo de indicadores técnicos, simulação de ordens, e log de trades.",
    rationale: "Skills stdlib: HTTP para exchanges que têm API pública, JSON para parse, sem precisar de ccxt.",
    capabilities: ["obter preço de crypto via API pública", "calcular RSI/SMA", "simular ordem"],
    plan: { steps: [
      { stepId: "s1", kind: "forge_skill", skillKey: "crypto_price_v2_protocol",
        pythonSource: [
          '"""Real crypto price fetcher using public CoinGecko API."""',
          'import urllib.request, urllib.parse, json',
          '',
          'def skill(organism, context):',
          '    """Fetch current price for a crypto symbol.',
          '    context: {"symbol": "bitcoin"}  or  {"ids": "bitcoin,ethereum"}',
          '    """',
          '    base = "https://api.coingecko.com/api/v3/simple/price"',
          '    params = {',
          '        "vs_currencies": "usd",',
          '        "include_24hr_change": "true",',
          '        "include_market_cap": "true",',
          '    }',
          '    if "ids" in context:',
          '        params["ids"] = context["ids"]',
          '    elif "symbol" in context:',
          '        params["ids"] = context["symbol"]',
          '    else:',
          '        return {"error": "symbol or ids required"}',
          '    try:',
          '        url = base + "?" + urllib.parse.urlencode(params)',
          '        with urllib.request.urlopen(url, timeout=15) as resp:',
          '            data = json.loads(resp.read().decode())',
          '        return {"prices": data, "fetched_at": __import__("time").time()}',
          '    except Exception as e:',
          '        return {"error": str(e)}',
        ].join("\n"),
        rationale: "Real CoinGecko API call (no API key, stdlib only)" },
      { stepId: "s2", kind: "forge_skill", skillKey: "rsi_calculator_v2_protocol",
        pythonSource: [
          '"""Real RSI (Relative Strength Index) calculator."""',
          'def skill(organism, context):',
          '    """Calculate RSI from a list of closing prices.',
          '    context: {"prices": [44, 44.34, 44.09, ...], "period": 14}',
          '    """',
          '    prices = context.get("prices", [])',
          '    period = int(context.get("period", 14))',
          '    if len(prices) < period + 1:',
          '        return {"error": f"need at least {period + 1} prices, got {len(prices)}"}',
          '    gains, losses = [], []',
          '    for i in range(1, len(prices)):',
          '        change = prices[i] - prices[i-1]',
          '        gains.append(max(change, 0))',
          '        losses.append(max(-change, 0))',
          "    # Wilder's smoothing",
          '    avg_gain = sum(gains[:period]) / period',
          '    avg_loss = sum(losses[:period]) / period',
          '    for i in range(period, len(gains)):',
          '        avg_gain = (avg_gain * (period - 1) + gains[i]) / period',
          '        avg_loss = (avg_loss * (period - 1) + losses[i]) / period',
          '    if avg_loss == 0:',
          '        rsi = 100',
          '    else:',
          '        rs = avg_gain / avg_loss',
          '        rsi = 100 - (100 / (1 + rs))',
          '    return {',
          '        "rsi": round(rsi, 2),',
          '        "period": period,',
          '        "signal": "overbought" if rsi > 70 else "oversold" if rsi < 30 else "neutral",',
          '        "samples": len(prices),',
          '    }',
        ].join("\n"),
        rationale: "Real RSI with Wilder's smoothing" },
      { stepId: "s3", kind: "record_metamorphose", rationale: "registrar metamorfose" },
    ]},
    estimatedTime: "10s",
  });
}

function genericPlan(prompt) {
  return JSON.stringify({
    id: `morph-generic-${Date.now().toString(36)}`,
    domain: "generic",
    research: "Sistema genérico — explorando capacidades do organismo.",
    rationale: "Skills stdlib.",
    capabilities: ["echo de input"],
    plan: { steps: [
      { stepId: "s1", kind: "forge_skill", skillKey: "echo_v2_protocol",
        pythonSource: 'def skill(o, c):\n    return {"echo": c, "ts": __import__("time").time()}',
        rationale: "echo" },
      { stepId: "s2", kind: "record_metamorphose", rationale: "registrar" },
    ]},
    estimatedTime: "5s",
  });
}

async function call(p, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    ...opts,
  });
  return await r.json();
}

await call("/api/llm-library", {
  method: "POST",
  body: JSON.stringify({
    name: "stub", provider: "openai-compatible", category: "reasoning",
    endpoint: `http://127.0.0.1:${STUB_PORT}/v1/chat/completions`,
    apiKey: "k", model: "stub", priority: 10,
  }),
});

const DOMAINS = [
  { name: "RESEARCH", prompt: "vire um sistema de pesquisa científica de papers de IA" },
  { name: "TRADING",   prompt: "vire um sistema de trading de crypto" },
];

const DNA_DIR = path.resolve(__dirname, "../dna_library");

for (const dom of DOMAINS) {
  console.log(`\n\x1b[36m━━━ ${dom.name} ━━━\x1b[0m`);
  console.log(`\x1b[33m  USER>\x1b[0m morph — ${dom.prompt}`);

  const r = await call("/api/nl/dispatch", {
    method: "POST",
    body: JSON.stringify({ message: `morph — ${dom.prompt}` }),
  });

  if (!r.action) { console.log("  FAILED:", JSON.stringify(r)); continue; }
  const plan = r.action.payload.plan?.plan ?? {};
  const report = r.action.payload.report;

  console.log(`\x1b[36m  CORTEX>\x1b[0m ${plan.research || plan.rationale}`);
  console.log(`  Status: ${report.status} · ${report.steps.length} steps`);

  console.log(`  Skills forjados:`);
  for (const step of report.steps) {
    if (step.kind !== "forge_skill") continue;
    const file = path.join(DNA_DIR, `${step.skillKey}.py`);
    let bytes = 0;
    try { bytes = (await fs.readFile(file, "utf8")).length; } catch { /* */ }
    console.log(`    [${step.status === "done" ? "✓" : "✗"}] ${step.skillKey} (${bytes} bytes)`);
  }

  // INVOKE the skills to prove they're real
  console.log(`  Invocando skills:`);
  for (const step of report.steps) {
    if (step.kind !== "forge_skill" || step.status !== "done") continue;
    let ctx = {};
    if (step.skillKey.includes("arxiv")) {
      ctx = { query: "transformer attention", max_results: 3 };
    } else if (step.skillKey.includes("summarizer")) {
      ctx = { text: "The transformer architecture revolutionized natural language processing. Self-attention allows the model to weigh the importance of each token. Multi-head attention captures different relationships. Positional encoding injects sequence information. The decoder uses cross-attention to consume encoder outputs. Training uses teacher forcing and label smoothing." };
    } else if (step.skillKey.includes("crypto_price")) {
      ctx = { symbol: "bitcoin" };
    } else if (step.skillKey.includes("rsi")) {
      ctx = { prices: [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64, 46.21] };
    } else if (step.skillKey.includes("echo")) {
      ctx = { msg: "hello" };
    }
    const r = await call(`/api/skills/${step.skillKey}/invoke`, {
      method: "POST",
      body: JSON.stringify({ context: ctx }),
    });
    const out = r?.result ?? r;
    const summary = typeof out === "object" ? JSON.stringify(out).slice(0, 200) : String(out).slice(0, 200);
    console.log(`    [${r?.ok ? "✓" : "✗"}] ${step.skillKey} → ${summary}`);
  }
}

console.log(`\n\x1b[36m━━━ CONCLUSÃO ━━━\x1b[0m`);
const skills = await call("/api/skills");
const allSkills = skills?.skills ?? [];
console.log(`Total skills no DNA library: ${allSkills.length}`);
console.log(`Skills novos forjados nesta sessão:`);
const newSkills = allSkills.filter((s) => s.includes("_v2_") || s.includes("echo_v2"));
newSkills.forEach((s) => console.log(`  • ${s}`));

stub.close();
process.exit(0);
