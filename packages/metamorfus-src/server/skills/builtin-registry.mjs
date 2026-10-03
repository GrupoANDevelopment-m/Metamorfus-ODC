// Builtin Skill Registry — the catalog of skill packages the operator
// has installed in /workspace/skill-pkgs/. Each skill becomes a
// real Python adapter in the DNA library that the organism can
// invoke via /api/skills/:name/invoke.
//
// Three categories:
//   • cli        — external binary on PATH; adapter runs it via subprocess
//   • python_lib — Python package; adapter imports it and calls APIs
//   • mcp        — MCP server; adapter speaks JSON-RPC over stdio
//
// Availability is probed at runtime via probeSkill() so the registry
// stays honest: a skill shows up as "installed" only if its
// underlying tool actually works on this machine.

import { spawn, spawnSync } from "node:child_process";

const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

export const BUILTIN_SKILLS = [
  {
    id: "browser_harness",
    name: "Browser Harness",
    kind: "cli",
    description: "Direct browser control via CDP. Visit pages, scrape, fill forms, run interactions.",
    skillKey: "builtin_browser_harness_protocol",
    cli: "browser-harness",
    installHint: "cd /workspace/skill-pkgs/extracted/browser-harness-main/browser-harness-main && pip install -e .",
    docUrl: "https://github.com/browser-use/browser-harness",
  },
  {
    id: "browser_use",
    name: "Browser Use",
    kind: "python_lib",
    description: "Python library for AI-driven browser automation. High-level agent API.",
    skillKey: "builtin_browser_use_protocol",
    importName: "browser_use",
    installHint: "cd /workspace/skill-pkgs/extracted/browser-use-main/browser-use-main && pip install -e .",
    docUrl: "https://github.com/browser-use/browser-use",
  },
  {
    id: "browser_skill",
    name: "Browser Skill (bsk)",
    kind: "cli",
    description: "Drive the user's real Chromium browser with their logins/cookies via the bsk CLI + extension.",
    skillKey: "builtin_browser_skill_protocol",
    cli: "bsk",
    installHint: "Install via cargo: cargo install --path /workspace/skill-pkgs/extracted/BrowserSkill-main/BrowserSkill-main/apps/bsk-cli",
    docUrl: "https://github.com/anthropics/browser-skill",
  },
  {
    id: "archify",
    name: "Archify",
    kind: "cli",
    description: "Generate validated architecture/workflow/sequence/data-flow/state diagrams as self-contained HTML with inline SVG.",
    skillKey: "builtin_archify_protocol",
    cli: "archify",
    cliPath: "/workspace/skill-pkgs/extracted/archify-main/archify-main/bin/archify.mjs",
    interpreter: "node",
    installHint: "No install needed. node bin/archify.mjs <command>",
    docUrl: "https://github.com/tt-a1i/archify",
  },
  {
    id: "nginx_skill",
    name: "Nginx Site Manager",
    kind: "cli",
    description: "Configure, manage and troubleshoot nginx: create sites, reload safely, enable/disable.",
    skillKey: "builtin_nginx_skill_protocol",
    cli: "nginx",
    scriptsDir: "/workspace/skill-pkgs/extracted/nginx-skill-main/nginx-skill-main/scripts",
    installHint: "apt install nginx",
    docUrl: "https://github.com/GrupoAN/nginx-skill",
  },
  {
    id: "nginx_agent",
    name: "Nginx & OpenResty Agent",
    kind: "doc",
    description: "Knowledge base for Nginx/OpenResty/Lua configuration. Reads reference docs to answer directives questions.",
    skillKey: "builtin_nginx_agent_protocol",
    docsDir: "/workspace/skill-pkgs/extracted/nginx-agent-skills-main/nginx-agent-skills-main",
    installHint: "No install — knowledge skill, reads references/ on demand.",
    docUrl: "https://github.com/GrupoAN/nginx-agent-skills",
  },
  {
    id: "playwright",
    name: "Playwright (browser automation)",
    kind: "python_lib",
    description: "Cross-browser automation via the Playwright Python SDK.",
    skillKey: "builtin_playwright_protocol",
    importName: "playwright",
    installHint: "pip install playwright && playwright install chromium",
    docUrl: "https://github.com/microsoft/playwright-python",
  },
  {
    id: "github_mcp",
    name: "GitHub MCP Server",
    kind: "mcp",
    description: "MCP server for GitHub: issues, PRs, repos, code search, actions, releases.",
    skillKey: "builtin_github_mcp_protocol",
    interpreter: "/workspace/skill-pkgs/extracted/github-mcp-server-main/github-mcp-server-main/cmd/github-mcp-server/github-mcp-server",
    installHint: "go build ./cmd/github-mcp-server",
    docUrl: "https://github.com/github/github-mcp-server",
  },
  {
    id: "agent_reach",
    name: "Agent Reach (13 internet platforms)",
    kind: "python_lib",
    description: "Read/search access to Twitter/X, Reddit, YouTube, GitHub, Bilibili, etc. via upstream tools.",
    skillKey: "builtin_agent_reach_protocol",
    importName: "agent_reach",
    installHint: "cd /workspace/skill-pkgs/extracted/Agent-Reach-main/Agent-Reach-main && pip install -e .",
    docUrl: "https://github.com/Panniantong/Agent-Reach",
  },
];

// Probe which skills are actually available on this machine.
function probeCli(cli, interpreter) {
  try {
    const cmd = interpreter ?? cli;
    const args = interpreter ? [cli, "--help"] : ["--help"];
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 5_000 });
    // Most CLIs exit 0 or 1 on --help. Either is fine — the binary exists.
    return r.status !== null && r.status !== 127;
  } catch {
    return false;
  }
}

function probePythonImport(name) {
  try {
    const r = spawnSync(PYTHON_BIN, ["-c", `import importlib.util; print('yes' if importlib.util.find_spec(${JSON.stringify(name)}) else 'no')`], { encoding: "utf8", timeout: 5_000 });
    return r.stdout.trim() === "yes";
  } catch {
    return false;
  }
}

function probeFile(path) {
  try {
    return require("node:fs").existsSync(path);
  } catch {
    return false;
  }
}

function probeMcpServer(interpreter) {
  if (!probeFile(interpreter)) return false;
  try {
    const r = spawnSync(interpreter, ["--help"], { encoding: "utf8", timeout: 3_000 });
    return r.status !== null;
  } catch {
    return false;
  }
}

export function probeSkill(skill) {
  switch (skill.kind) {
    case "cli":
      if (skill.cliPath) return probeFile(skill.cliPath);
      return probeCli(skill.cli, skill.interpreter);
    case "python_lib":
      return probePythonImport(skill.importName);
    case "mcp":
      return probeMcpServer(skill.interpreter);
    case "doc":
      return probeFile(skill.docsDir);
    default:
      return false;
  }
}

export function listSkills() {
  return BUILTIN_SKILLS.map((s) => ({ ...s, available: probeSkill(s) }));
}

export function getSkill(id) {
  return BUILTIN_SKILLS.find((s) => s.id === id) ?? null;
}
