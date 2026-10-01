// Realistic cybersec morph test — no stubs, no templates.
// Uses the new planner that takes the system prompt + env probe,
// asks the LLM to research real materials, then produces REAL
// executable Python (using scapy/requests/etc) and REAL pip packages.
//
// The stub LLM simulates what a real LLM (kimi-k3) would produce
// given the new system prompt + env probe. We use it because we
// don't have an NVIDIA key in this env.

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
        reply: "Vou morfar o organismo num sistema de cibersegurança real.",
      });
    } else {
      // Planner: REAL plan with REAL Python code.
      // The LLM uses environment probe to know what's installed.
      result = JSON.stringify({
        id: `morph-realcybersec-${Date.now().toString(36)}`,
        domain: "cybersecurity",
        research: "Um sistema de cibersegurança ofensiva/passiva precisa de: descoberta de hosts, varredura de portas (nmap ou socket TCP), análise de headers HTTP, detecção de CVEs via NVD API, logging estruturado de eventos para cadeia de custódia.",
        rationale: "Auto-expansão: instalar pacotes reais (requests, scapy quando disponível), clonar repositórios reais (seahax, nvd-cve), forjar skills com código real que consulta APIs e abre sockets.",
        capabilities: [
          "scan TCP em hosts remotos",
          "auditoria de headers HTTP de segurança",
          "consulta à NVD API para CVEs por CPE",
          "WHOIS / DNS passivo",
          "log estruturado de incidentes",
        ],
        external_materials: {
          github_repos: [
            { url: "https://github.com/rapid7/metasploit-framework", purpose: "framework de segurança ofensiva" },
            { url: "https://github.com/wapiti-scanner/wapiti", purpose: "scanner de vulnerabilidades web" },
          ],
          pypi_packages: [
            { name: "requests", purpose: "HTTP client para APIs de threat intel" },
            { name: "python-nmap", purpose: "wrapper para o nmap CLI" },
          ],
          cli_tools: [{ name: "nmap", install_via: "apt" }],
        },
        plan: {
          steps: [
            { stepId: "s1", kind: "pip_install", package: "requests", rationale: "HTTP client for threat intel APIs" },
            { stepId: "s2", kind: "forge_skill", skillKey: "real_port_scanner_protocol",
              pythonSource: [
                '"""Real async TCP port scanner — scans a host for open ports."""',
                'import asyncio, socket, json, time',
                '',
                'def skill(organism, context):',
                '    """Scan a host for open TCP ports.',
                '    context: {"host": "scanme.nmap.org", "ports": [22,80,443]}',
                '    """',
                '    host = context.get("host", "127.0.0.1")',
                '    ports = context.get("ports", [21,22,23,25,53,80,110,143,443,445,3306,3389,5432,5900,8080])',
                '    timeout = float(context.get("timeout", 1.0))',
                '    ',
                '    async def check(p):',
                '        try:',
                '            r, w = await asyncio.wait_for(asyncio.open_connection(host, p), timeout=timeout)',
                '            w.close()',
                '            try: await w.wait_closed()',
                '            except Exception: pass',
                '            return p',
                '        except Exception: return None',
                '    ',
                '    async def run_all():',
                '        results = await asyncio.gather(*(check(p) for p in ports))',
                '        return [p for p in results if p]',
                '    ',
                '    t0 = time.time()',
                '    open_ports = asyncio.run(run_all())',
                '    return {',
                '        "host": host,',
                '        "scanned_ports": len(ports),',
                '        "open_ports": open_ports,',
                '        "open_count": len(open_ports),',
                '        "duration_ms": int((time.time() - t0) * 1000),',
                '        "summary": f"{len(open_ports)}/{len(ports)} ports open on {host}",',
                '    }',
              ].join("\n"),
              rationale: "real async TCP scanner using stdlib asyncio" },

            { stepId: "s3", kind: "forge_skill", skillKey: "real_http_header_audit_protocol",
              pythonSource: [
                '"""Real HTTP security header auditor."""',
                'import urllib.request, urllib.error, json',
                '',
                'SECURITY_HEADERS = {',
                '    "strict-transport-security": "Force HTTPS",',
                '    "content-security-policy":   "XSS / injection",',
                '    "x-frame-options":           "Clickjacking",',
                '    "x-content-type-options":    "MIME sniffing",',
                '    "referrer-policy":           "Referrer leakage",',
                '    "permissions-policy":        "Feature abuse",',
                '}',
                '',
                'def skill(organism, context):',
                '    """Audit HTTP security headers of a target URL."""',
                '    url = context.get("url", "")',
                '    if not url: return {"error": "url is required"}',
                '    findings = []',
                '    try:',
                '        req = urllib.request.Request(url, headers={"User-Agent": "metamorfus/1.0"})',
                '        with urllib.request.urlopen(req, timeout=10) as resp:',
                '            headers = {k.lower(): v for k, v in resp.headers.items()}',
                '            for header, purpose in SECURITY_HEADERS.items():',
                '                findings.append({"header": header, "present": header in headers, "purpose": purpose})',
                '            present = sum(1 for f in findings if f["present"])',
                '            return {"url": url, "status": resp.status, "score": round(present / len(findings), 2), "findings": findings}',
                '    except urllib.error.HTTPError as e:',
                '        return {"url": url, "status": e.code, "error": e.reason, "findings": findings}',
                '    except Exception as e:',
                '        return {"url": url, "error": str(e), "findings": findings}',
              ].join("\n"),
              rationale: "real HTTP header audit using urllib stdlib" },

            { stepId: "s4", kind: "forge_skill", skillKey: "real_cve_lookup_protocol",
              pythonSource: [
                '"""Real NVD CVE lookup via the public NVD API."""',
                'def skill(organism, context):',
                '    """Look up CVEs by keyword or CPE from the NVD API.',
                '    context: {"keyword": "log4j", "limit": 5}',
                '    """',
                '    keyword = context.get("keyword", "")',
                '    limit = int(context.get("limit", 5))',
                '    if not keyword: return {"error": "keyword is required"}',
                '    try:',
                '        import requests',
                '    except ImportError:',
                '        return {"error": "requests not installed. Run: pip install requests"}',
                '    try:',
                '        url = "https://services.nvd.nist.gov/rest/json/cves/2.0"',
                '        params = {"keywordSearch": keyword, "resultsPerPage": min(limit, 20)}',
                '        r = requests.get(url, params=params, timeout=15, headers={"User-Agent": "metamorfus/1.0"})',
                '        r.raise_for_status()',
                '        data = r.json()',
                '        vulns = []',
                '        for v in data.get("vulnerabilities", []):',
                '            cve = v.get("cve", {})',
                '            desc = ""',
                '            for d in cve.get("descriptions", []):',
                '                if d.get("lang") == "en":',
                '                    desc = d.get("value", "")[:300]; break',
                '            metrics = cve.get("metrics", {})',
                '            cvss = None',
                '            for vtype in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):',
                '                if vtype in metrics:',
                '                    cvss = metrics[vtype][0]["cvssData"].get("baseScore")',
                '                    break',
                '            vulns.append({',
                '                "id": cve.get("id"),',
                '                "description": desc,',
                '                "cvss_v3": cvss,',
                '                "published": cve.get("published"),',
                '            })',
                '        return {"keyword": keyword, "total": data.get("totalResults", 0), "vulnerabilities": vulns}',
                '    except Exception as e:',
                '        return {"keyword": keyword, "error": str(e)}',
              ].join("\n"),
              rationale: "real NVD API client" },

            { stepId: "s5", kind: "forge_skill", skillKey: "real_incident_logger_protocol",
              pythonSource: [
                '"""Real structured incident logger with WORM-style append-only storage."""',
                'import json, os, time, hashlib',
                '',
                'def skill(organism, context):',
                '    """Append a security incident to an immutable log file.',
                '    context: {"event": {"type": "port_scan", "src": "1.2.3.4"}, "log_path": "/var/log/metamorfus/incidents.ndjson"}',
                '    """',
                '    event = context.get("event", {})',
                '    log_path = context.get("log_path", "/tmp/metamorfus-incidents.ndjson")',
                '    ts = time.time()',
                '    entry = {',
                '        "ts": ts,',
                '        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),',
                '        "event": event,',
                '    }',
                '    # Hash chain: prev_hash + this entry\'s payload',
                '    prev_hash = ""',
                '    if os.path.exists(log_path):',
                '        try:',
                '            with open(log_path, "rb") as f:',
                '                prev_hash = hashlib.sha256(f.read()).hexdigest()',
                '        except Exception: pass',
                '    payload = json.dumps(entry, sort_keys=True).encode() + prev_hash.encode()',
                '    entry["hash"] = hashlib.sha256(payload).hexdigest()',
                '    entry["prev_hash"] = prev_hash',
                '    try:',
                '        os.makedirs(os.path.dirname(log_path) or ".", exist_ok=True)',
                '        with open(log_path, "a") as f:',
                '            f.write(json.dumps(entry) + "\\n")',
                '        return {"logged": True, "path": log_path, "hash": entry["hash"]}',
                '    except Exception as e:',
                '        return {"logged": False, "error": str(e)}',
              ].join("\n"),
              rationale: "real WORM-style hash-chained incident log" },

            { stepId: "s6", kind: "record_metamorphose", rationale: "registrar metamorfose" },
          ],
        },
        estimatedTime: "20s",
      });
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: result } }] }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
console.log(`[stub] on ${STUB_PORT}`);

async function call(p, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    ...opts,
  });
  return await r.json();
}

// Seed LLM library
await call("/api/llm-library", {
  method: "POST",
  body: JSON.stringify({
    name: "stub", provider: "openai-compatible", category: "reasoning",
    endpoint: `http://127.0.0.1:${STUB_PORT}/v1/chat/completions`,
    apiKey: "k", model: "stub", priority: 10,
  }),
});

console.log("\n\x1b[33m  USER>\x1b[0m morph — vire um sistema de cibersegurança ofensivo e passivo\n");

const r = await call("/api/nl/dispatch", {
  method: "POST",
  body: JSON.stringify({ message: "morph — vire um sistema de cibersegurança ofensivo e passivo" }),
});

if (!r.action) {
  console.error("FAILED:", JSON.stringify(r, null, 2));
  process.exit(1);
}

const plan = r.action.payload.plan?.plan ?? {};
const report = r.action.payload.report;

console.log(`\x1b[36m  CORTEX>\x1b[0m ${plan.research || plan.rationale}`);
console.log(`\n  Status: ${report.status} · ${report.steps.length} steps\n`);

const DNA_DIR = path.resolve(__dirname, "../dna_library");

console.log("─── O QUE FOI FORJADO (código REAL, executável) ───\n");
for (const step of report.steps) {
  const skillKey = step.skillKey || step.package || step.kind;
  if (step.kind === "forge_skill") {
    const file = path.join(DNA_DIR, `${step.skillKey}.py`);
    let exists = false;
    let content = "";
    let bytes = 0;
    try {
      content = await fs.readFile(file, "utf8");
      bytes = content.length;
      exists = true;
    } catch { /* */ }
    console.log(`  [${step.status === "done" ? "✓" : "✗"}] forge_skill ${step.skillKey} (${bytes} bytes)`);
    if (exists && step.status === "done") {
      // Print just the docstring + first 8 lines to show it's real
      const lines = content.split("\n");
      const preview = lines.slice(0, 8).join("\n");
      console.log(`      ${preview.split("\n").join("\n      ")}\n`);
    }
  } else if (step.kind === "pip_install") {
    const out = (step.output?.stdout || step.output?.stderr || "").slice(0, 80).trim();
    console.log(`  [${step.status === "done" ? "✓" : "✗"}] pip_install ${step.package} ${out ? `(${out})` : ""}`);
  } else {
    console.log(`  [${step.status === "done" ? "✓" : "✗"}] ${step.kind} ${skillKey}`);
  }
}

// Now ACTUALLY INVOKE the skills to prove they work
console.log("\n─── TESTE PRÁTICO: invocando skills REAIS ───\n");

async function invokeSkill(skillKey, context) {
  return await call(`/api/skills/${skillKey}/invoke`, {
    method: "POST",
    body: JSON.stringify({ context }),
  });
}
void invokeSkill; // suppress unused warning

// 1. port scanner: scan localhost
console.log("  real_port_scanner_protocol em scanme.nmap.org:22,80,443...");
const ps = await call("/api/skills/real_port_scanner_protocol/invoke", {
  method: "POST",
  body: JSON.stringify({
    context: { host: "scanme.nmap.org", ports: [22, 80, 443], timeout: 3.0 },
  }),
});
console.log(`    ok=${ps?.ok} · ${JSON.stringify(ps?.result ?? ps).slice(0, 300)}`);

// 2. HTTP header audit: example.com
console.log("  real_http_header_audit_protocol em https://example.com...");
const ha = await call("/api/skills/real_http_header_audit_protocol/invoke", {
  method: "POST",
  body: JSON.stringify({ context: { url: "https://example.com" } }),
});
console.log(`    ok=${ha?.ok} · status=${ha?.result?.status ?? "?"} · score=${ha?.result?.score ?? "?"} · findings=${ha?.result?.findings?.length ?? "?"}`);

// 3. CVE lookup: log4j
console.log("  real_cve_lookup_protocol com keyword=log4j...");
const cve = await call("/api/skills/real_cve_lookup_protocol/invoke", {
  method: "POST",
  body: JSON.stringify({ context: { keyword: "log4j", limit: 3 } }),
});
console.log(`    ok=${cve?.ok} · ${JSON.stringify(cve?.result ?? cve?.error ?? cve).slice(0, 300)}`);

// 4. Incident logger
console.log("  real_incident_logger_protocol gravando em /tmp/incidents.ndjson...");
const il = await call("/api/skills/real_incident_logger_protocol/invoke", {
  method: "POST",
  body: JSON.stringify({
    context: { event: { type: "port_scan", src: "scanme.nmap.org", open: [22, 80] }, log_path: "/tmp/incidents.ndjson" },
  }),
});
console.log(`    ok=${il?.ok} · ${JSON.stringify(il?.result ?? il).slice(0, 300)}`);

console.log("\n─── ESTADO FINAL ───\n");
const skills = await call("/api/skills");
console.log(`  ${skills.body?.skills?.length ?? "?"} skills no DNA library`);

stub.close();
process.exit(0);
