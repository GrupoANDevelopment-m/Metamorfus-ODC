// Demo: prove the builtin skills registry + adapters work end-to-end.
// Starts the headless server, asks for the builtin catalog, invokes
// each one, and reports what worked vs what needs installation.

import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const PORT = Number(process.argv[2] ?? 3457);
const AUTH = "Bearer dev-secret-local";

async function call(p, opts = {}) {
  const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    ...opts,
  });
  return await r.json();
}

// Start the server
console.log("[demo] starting headless server on", PORT);
const serverProc = spawn("./node_modules/.bin/tsx", ["server/headless-server.mjs"], {
  cwd: "/workspace/metamorfus-opencode/packages/metamorfus-src",
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});

const cleanup = async () => {
  try { serverProc.kill("SIGTERM"); } catch {}
};

// Give it a moment to bind
await new Promise((r) => setTimeout(r, 6000));
const health = await fetch(`http://127.0.0.1:${PORT}/api/health`).then((r) => r.json()).catch(() => null);
console.log("[demo] health:", JSON.stringify(health));
if (!health) { console.error("[demo] server failed to start"); await cleanup(); process.exit(1); }

try {
  // 1. List builtin skills + summary
  console.log("\n\x1b[36m━━━ BUILTIN SKILLS REGISTRY ━━━\x1b[0m\n");
  const summary = await call("/api/skills/builtin-summary");
  console.log(`Total: ${summary.total} builtin adapters`);
  console.log(`\x1b[32mInstalled (${summary.installed.length}):\x1b[0m ${summary.installed.join(", ") || "(none)"}`);
  console.log(`\x1b[33mMissing (${summary.missing.length}):\x1b[0m`);
  for (const m of summary.missing) {
    console.log(`  • ${m.id}`);
    console.log(`    → ${m.installHint}`);
  }

  // 2. Full list with availability
  const all = await call("/api/skills/builtin");
  console.log("\n\x1b[36m━━━ DETAIL ━━━\x1b[0m\n");
  for (const s of all.skills) {
    const dot = s.available ? "\x1b[32m●\x1b[0m" : "\x1b[31m○\x1b[0m";
    console.log(`${dot} ${s.id.padEnd(20)} ${s.kind.padEnd(12)} ${s.name}`);
    console.log(`  ${s.description.slice(0, 110)}${s.description.length > 110 ? "…" : ""}`);
  }

  // 3. Try invoking one that works without external tools (nginx_agent reads files)
  console.log("\n\x1b[36m━━━ INVOCATION TESTS ━━━\x1b[0m\n");

  const tests = [
    {
      label: "nginx_agent (reads references — no install needed)",
      skill: "builtin_nginx_agent_protocol",
      context: { question: "what are nginx directive inheritance gotchas?" },
    },
    {
      label: "browser_use (returns clean install hint — package not installed)",
      skill: "builtin_browser_use_protocol",
      context: { task: "open nvidia.com" },
    },
    {
      label: "agent_reach (returns clean install hint — package not installed)",
      skill: "builtin_agent_reach_protocol",
      context: { url: "https://example.com" },
    },
    {
      label: "github_mcp (returns clean error — binary not built + no GITHUB_TOKEN)",
      skill: "builtin_github_mcp_protocol",
      context: { action: "list_tools" },
    },
    {
      label: "nginx_skill (graceful when nginx binary missing)",
      skill: "builtin_nginx_skill_protocol",
      context: { action: "test_config" },
    },
    {
      label: "archify (graceful when archify binary missing)",
      skill: "builtin_archify_protocol",
      context: { action: "doctor" },
    },
    {
      label: "browser_harness (graceful when CLI missing)",
      skill: "builtin_browser_harness_protocol",
      context: { action: "info" },
    },
  ];

  for (const t of tests) {
    const r = await call(`/api/skills/${t.skill}/invoke`, {
      method: "POST",
      body: JSON.stringify({ context: t.context }),
    });
    const ok = r.ok === true;
    const dot = ok ? "\x1b[32m●\x1b[0m" : "\x1b[33m△\x1b[0m";
    console.log(`${dot} ${t.label}`);
    if (ok && r.result) {
      const summary = typeof r.result === "object" ? JSON.stringify(r.result).slice(0, 200) : String(r.result).slice(0, 200);
      console.log(`  → ${summary}`);
    } else if (r.error) {
      console.log(`  → error: ${String(r.error).slice(0, 200)}`);
    }
    console.log("");
  }

  // 5. Verify all 9 builtin_*.py are on disk and the registry sees them
  console.log("\x1b[36m━━━ VERIFYING DNA LIBRARY ━━━\x1b[0m\n");
  const allSkills = await call("/api/skills");
  const builtins = allSkills.skills.filter((s) => s.startsWith("builtin_"));
  console.log(`Builtin skill files in DNA library: ${builtins.length}`);
  for (const s of builtins) {
    const size = (await fs.stat(`/workspace/metamorfus-opencode/packages/metamorfus-src/dna_library/${s}.py`).catch(() => null))?.size ?? 0;
    console.log(`  ${s}.py (${size} bytes)`);
  }

} finally {
  await cleanup();
}
process.exit(0);