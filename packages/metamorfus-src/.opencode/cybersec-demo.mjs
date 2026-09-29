// Realistic demo: user asks the organism to become a cybersecurity
// system. We use the real NVIDIA NIM kimi-k3 endpoint (if a key is
// available) OR a stub that returns what a typical LLM would plan
// for this domain. Then we show: (a) the plan, (b) the actual
// skills on disk after execution, and (c) whether those skills can
// actually do anything useful.

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? 3457);
const STUB_PORT = Number(process.argv[3] ?? 3458);
const AUTH = "Bearer dev-secret-local";

// ─── stub LLM that returns a typical cybersecurity plan ─────────────
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    const sysMsg = parsed.messages.find((m) => m.role === "system")?.content ?? "";
    const userMsg = parsed.messages[parsed.messages.length - 1].content;
    let result;
    if (sysMsg.includes("MARKER:INTENT_CLASSIFIER")) {
      result = JSON.stringify({ intent: "metamorphose", args: { systemPrompt: userMsg }, reply: "Vou planejar e executar a cibersegurança." });
    } else {
      result = JSON.stringify({
        id: `morph-cybersec-${Date.now().toString(36)}`,
        domain: "cybersec",
        rationale: "Tornar o organismo um sistema de cibersegurança ofensiva e passiva.",
        capabilities: ["recon de hosts", "scan de portas", "detecção de anomalias", "log de incidentes"],
        plan: {
          steps: [
            { stepId: "s1", kind: "forge_skill", skillKey: "recon_protocol",
              pythonSource: [
                'def skill(organism, context):',
                '    """Passivo: WHOIS + DNS lookup do alvo."""',
                '    import socket',
                '    host = context.get("host", "")',
                '    try:',
                '        ip = socket.gethostbyname(host)',
                '    except Exception as e:',
                '        return {"action": "RECON_FAILED", "intensity": 0.0, "version": 1, "params": {"error": str(e)}}',
                '    return {"action": "RECON_DONE", "intensity": 0.4, "version": 1, "params": {"host": host, "ip": ip}}',
              ].join("\n"),
              rationale: "recon passivo (DNS reverso)" },
            { stepId: "s2", kind: "forge_skill", skillKey: "port_scan_protocol",
              pythonSource: [
                'def skill(organism, context):',
                '    """Ativo: scan TCP Connect em portas comuns."""',
                '    import socket',
                '    host = context.get("host", "127.0.0.1")',
                '    ports = context.get("ports", [22, 80, 443, 8080, 3306])',
                '    open_ports = []',
                '    for p in ports:',
                '        try:',
                '            with socket.create_connection((host, p), timeout=1):',
                '                open_ports.append(p)',
                '        except Exception:',
                '            pass',
                '    return {"action": "PORT_SCAN_DONE", "intensity": 0.6, "version": 1, "params": {"host": host, "open": open_ports}}',
              ].join("\n"),
              rationale: "scan ativo (apenas TCP connect)" },
            { stepId: "s3", kind: "forge_skill", skillKey: "incident_log_protocol",
              pythonSource: [
                'def skill(organism, context):',
                '    """Registra incidente em arquivo JSON."""',
                '    import json, time',
                '    event = context.get("event", {})',
                '    return {"action": "INCIDENT_LOGGED", "intensity": 0.2, "version": 1, "params": {"ts": time.time(), "event": event}}',
              ].join("\n"),
              rationale: "log de incidentes passivo" },
            { stepId: "s4", kind: "pip_install", package: "requests", rationale: "HTTP client" },
            { stepId: "s5", kind: "record_metamorphose", rationale: "registrar a metamorfose" },
          ],
        },
        estimatedTime: "20s",
      });
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: result } }], usage: {} }));
  });
});
await new Promise((r) => stub.listen(STUB_PORT, "127.0.0.1", r));
console.log(`[stub] listening on ${STUB_PORT}`);

// ─── seed LLM library ───────────────────────────────────────────────
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

// ─── the user asks for cybersecurity ────────────────────────────────
const systemPrompt = "vire um sistema de cibersegurança ofensiva e passiva com capacidade de reconhecimento, varredura e resposta a incidentes";
console.log(`\n\x1b[33m  USER>\x1b[0m morph — ${systemPrompt}\n`);

const r = await call("/api/nl/dispatch", {
  method: "POST",
  body: JSON.stringify({ message: `morph — ${systemPrompt}` }),
});
const action = r.action;
if (!action) { console.error("no action:", JSON.stringify(r, null, 2)); process.exit(1); }
const llmResponse = action.payload.plan?.plan ?? {};
const report = action.payload.report;

console.log(`\x1b[36m  CORTEX>\x1b[0m ${llmResponse.rationale}`);
console.log(`\x1b[36m  CORTEX>\x1b[0m Capacidades: ${(llmResponse.capabilities ?? []).join(", ")}\n`);
console.log(`  Status: ${report.status} · ${report.steps.length} steps executados\n`);

console.log("─── O QUE O ORGANISMO FICOU SENDO ───\n");
const DNA_DIR = path.resolve(__dirname, "../dna_library");
for (const step of report.steps) {
  const skillKey = step.skillKey ?? step.package ?? step.kind;
  if (step.kind === "forge_skill") {
    const file = path.join(DNA_DIR, `${step.skillKey}.py`);
    let fileExists = false;
    let fileContent = "";
    try {
      fileContent = await fs.readFile(file, "utf8");
      fileExists = true;
    } catch { /* not on disk */ }
    console.log(`  STEP ${step.index} [forge_skill] ${step.skillKey}: ${step.status}`);
    if (fileExists) {
      const lines = fileContent.split("\n");
      console.log(`    ↳ arquivo real: dna_library/${step.skillKey}.py (${lines.length} linhas)`);
      console.log(`\n${fileContent.split("\n").map((l) => "        " + l).join("\n")}\n`);
    } else {
      console.log(`    ↳ NÃO foi gravado em disco (algum erro no forge_skill)\n`);
    }
  } else if (step.kind === "pip_install") {
    console.log(`  STEP ${step.index} [pip_install] ${step.package}: ${step.status}`);
    if (step.error) console.log(`    erro: ${step.error.slice(0, 100)}`);
  } else if (step.kind === "record_metamorphose") {
    console.log(`  STEP ${step.index} [record_metamorphose]: ${step.status}`);
  }
}

console.log("\n─── TESTE PRÁTICO: chamar o skill de port_scan ───\n");
// Try to actually USE the port_scan_protocol skill by hitting the
// swarm CMD::EXEC path the same way the botnet broadcast does.
const PORT_TO_TEST = 22;
const PORT_TARGET = "127.0.0.1";
const portScanCode = `
import socket
host = "${PORT_TARGET}"
port = ${PORT_TO_TEST}
try:
    with socket.create_connection((host, port), timeout=2):
        result = f"OPEN {host}:{port}"
except Exception as e:
    result = f"CLOSED {host}:{port} ({e})"
print(result)
`.trim();

// Use forge_skill as a dry-run to execute arbitrary Python.
const exec = await call("/api/tools/forge_skill", {
  method: "POST",
  body: JSON.stringify({
    skillKey: "test_port_scan_protocol",
    pythonSource: portScanCode,
    dryRun: true,
  }),
});
console.log(`  executado em Python real via swarm:`);
console.log(`  ${exec.body?.output?.trim() || exec.body?.error || "(no output)"}`);

console.log("\n─── VEREDICTO REALISTA ───\n");
console.log("  O organismo tem 3 skills no DNA library que:");
console.log("  • recon_protocol:      faz DNS lookup (1 chamada socket.gethostbyname)");
console.log("  • port_scan_protocol:  abre 5 sockets TCP Connect em portas comuns");
console.log("  • incident_log_protocol: retorna dict, NÃO escreve em lugar nenhum");
console.log("");
console.log("  Isso é o mesmo que qualquer script Python de 30 linhas.");
console.log("  NÃO é um sistema de cibersegurança. É um stub que");
console.log("  satisfaz o validator do forge_skill e devolve o action esperado.");
console.log("");
console.log("  Pra ser cibersegurança de verdade, faltaria:");
console.log("  ✗ Acesso a raw sockets (scapy + libpcap, precisa de root)");
console.log("  ✗ Integração com NVD/CVE API (consulta de vulnerabilidades)");
console.log("  ✗ Packet capture contínuo (zeek/suricata)");
console.log("  ✗ Regras de firewall (iptables/nftables)");
console.log("  ✗ Threat intel feeds (MISP, AlienVault OTX)");
console.log("  ✗ Sandboxing pra análise de malware");
console.log("  ✗ Camada de autorização (scan ofensivo sem scope = crime)");
console.log("  ✗ SIEM integration (Splunk/Elastic/Wazuh)");
console.log("  ✗ Auth/RBAC");
console.log("  ✗ Logging persistente (WORM storage)");

stub.close();
process.exit(0);
