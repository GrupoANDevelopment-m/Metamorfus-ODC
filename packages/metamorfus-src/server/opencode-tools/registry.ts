/**
 * In-process tool registry for the OpenCode agents.
 *
 * OpenCode can be configured (via opencode.jsonc → `tools` block, or by
 * placing modules under a `tools/` directory) to load custom tool modules
 * at startup. Each module exports a ToolDefinition with `name`,
 * `description`, a JSON Schema `parameters` object, and an `execute`
 * function.
 *
 * The bridge code (`odc-opencode-bridge.ts`) also has a fallback path:
 * when a tool name here matches a known handler, the bridge can call
 * `executeTool(name, params)` directly without round-tripping through
 * the OpenCode sidecar. This means the same code is usable in two modes:
 *
 *   • OpenCode sidecar mode — tools are defined in opencode.jsonc, the
 *     sidecar invokes them when the agent decides to call them.
 *   • Direct mode          — server.ts invokes `executeTool(name, params)`
 *     from the chat path. The result is fed back into the conversation
 *     as a tool message.
 *
 * Adding a new tool = adding one file under server/opencode-tools/ and
 * registering it in the array below.
 */

import { describeImage } from "../vision-tool.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolContext {
  /** Absolute or workspace-relative root for filesystem tools. */
  workspaceRoot: string;
  /** Caller-supplied env (NVIDIA_API_KEY, etc.). */
  env: NodeJS.ProcessEnv;
  /** Optional override; default `packages/metamorfus-src/dna_library`. */
  dnaDir?: string;
}

export interface ToolResult {
  /** Short user-facing summary. */
  output: string;
  /** Structured data the agent can reason about. */
  data?: unknown;
  /** Optional energy/entropy hint for the organism. */
  energyDelta?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ---------------------------------------------------------------------------
// vision_describe — image URL → textual description
// ---------------------------------------------------------------------------

const visionDescribe: ToolDefinition = {
  name: "vision_describe",
  description:
    "Describe an image using the NVIDIA NIM moonshotai/kimi-k3 vision model. " +
    "Returns a natural-language description and the model's reasoning. " +
    "Use this when the user provides an image URL or asks 'what is in this image'.",
  parameters: {
    type: "object",
    properties: {
      imageUrl: {
        type: "string",
        description: "Public URL of the image to describe.",
      },
      prompt: {
        type: "string",
        description: "Optional question or instruction. Default: 'Describe this image in detail.'",
      },
    },
    required: ["imageUrl"],
  },
  async execute(args, ctx) {
    const imageUrl = String(args.imageUrl ?? "");
    if (!imageUrl) throw new Error("vision_describe: imageUrl is required");
    if (!ctx.env.NVIDIA_API_KEY) {
      throw new Error("vision_describe: NVIDIA_API_KEY not configured");
    }
    // Temporarily put the env in place for the wrapper to read.
    const previous = process.env.NVIDIA_API_KEY;
    process.env.NVIDIA_API_KEY = ctx.env.NVIDIA_API_KEY;
    try {
      const result = await describeImage({
        imageUrl,
        ...(typeof args.prompt === "string" ? { prompt: args.prompt } : {}),
      });
      return {
        output: result.description,
        data: { reasoning: result.reasoning, model: result.model, usage: result.usage },
        energyDelta: -1.0,
      };
    } finally {
      if (previous === undefined) delete process.env.NVIDIA_API_KEY;
      else process.env.NVIDIA_API_KEY = previous;
    }
  },
};

// ---------------------------------------------------------------------------
// scan_codebase — directory tree → file summary
// ---------------------------------------------------------------------------

const SCAN_EXCLUDE = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
]);

const MAX_FILE_BYTES = 200_000; // 200 KB cap per file when reading
const MAX_TREE_ENTRIES = 1500;

async function walk(root: string, base = root, acc: string[] = []): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const entries = await fs.readdir(base, { withFileTypes: true });
  for (const entry of entries) {
    if (acc.length >= MAX_TREE_ENTRIES) return acc;
    if (SCAN_EXCLUDE.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".opencode" && entry.name !== ".env.example") {
      continue;
    }
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, acc);
    } else if (entry.isFile()) {
      acc.push(path.relative(root, full));
    }
  }
  return acc;
}

const scanCodebase: ToolDefinition = {
  name: "scan_codebase",
  description:
    "Scan a directory tree under workspaceRoot and return a structured summary: " +
    "file list, total bytes, line counts, TODOs/FIXMEs, .ts/.py/.json module counts. " +
    "Use this to ground improvement proposals in the actual codebase state.",
  parameters: {
    type: "object",
    properties: {
      root: {
        type: "string",
        description: "Subpath under workspaceRoot to scan. Default: '.' (whole workspace).",
      },
      includeLineCounts: {
        type: "boolean",
        description: "Count lines per file. Default: true.",
      },
    },
    required: [],
  },
  async execute(args, ctx) {
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const subroot = typeof args.root === "string" && args.root.length > 0 ? args.root : ".";
    const includeLineCounts = args.includeLineCounts !== false;
    const absRoot = path.resolve(ctx.workspaceRoot, subroot);

    let stat;
    try {
      stat = await fs.stat(absRoot);
    } catch {
      throw new Error(`scan_codebase: root not found: ${absRoot}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`scan_codebase: not a directory: ${absRoot}`);
    }

    const files = await walk(absRoot);

    let totalBytes = 0;
    const extCounts: Record<string, number> = {};
    const todos: { file: string; line: number; text: string }[] = [];
    const lineCounts: Record<string, number> = {};

    for (const rel of files) {
      const full = path.join(absRoot, rel);
      const st = await fs.stat(full);
      totalBytes += st.size;
      const ext = path.extname(rel) || "(no-ext)";
      extCounts[ext] = (extCounts[ext] ?? 0) + 1;

      if (st.size > MAX_FILE_BYTES) continue;
      if (!/\.(ts|tsx|js|mjs|cjs|py|json|md|tsx?)$/i.test(rel)) continue;

      try {
        const content = await fs.readFile(full, "utf8");
        if (includeLineCounts) {
          lineCounts[rel] = content.split(/\r?\n/).length;
        }
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const m = line.match(/\b(TODO|FIXME|XXX|HACK)\b[: ]\s*(.*)/);
          if (m) {
            todos.push({ file: rel, line: i + 1, text: (m[2] ?? "").trim() });
          }
        }
      } catch {
        // Binary or unreadable — skip silently.
      }
    }

    const sortedExt = Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const summary = {
      root: absRoot,
      fileCount: files.length,
      totalBytes,
      topExtensions: Object.fromEntries(sortedExt),
      todoCount: todos.length,
      topTodos: todos.slice(0, 15),
      lineCounts: includeLineCounts
        ? Object.fromEntries(
            Object.entries(lineCounts)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .slice(0, 10),
          )
        : undefined,
    };

    const headline =
      `${summary.fileCount} files (${(summary.totalBytes / 1024).toFixed(1)} KB), ` +
      `${summary.todoCount} TODOs. Top extensions: ` +
      sortedExt.map(([e, n]) => `${e}=${n}`).join(", ");
    return { output: headline, data: summary, energyDelta: -0.5 };
  },
};

// ---------------------------------------------------------------------------
// forge_skill — write a new skill into the DNA library
// ---------------------------------------------------------------------------

const FORGE_PROTECTED = new Set([
  "mine_protocol",
  "hunt_protocol",
  "gather_protocol",
  "trade_protocol",
  "hack_protocol",
  "think_protocol",
  "scan_codebase_protocol",
  "propose_improvement_protocol",
  "vision_describe_protocol",
  "forge_skill_protocol",
]);

const forgeSkill: ToolDefinition = {
  name: "forge_skill",
  description:
    "Write a new skill into the organism's DNA library. Supports multiple " +
    "runtimes (python, javascript, shell, wasm, spec). For python/javascript " +
    "the skill body must define a function that returns an intention dict. " +
    "For shell the body is a bash command. For spec it's reference data. " +
    "The skill key MUST end with `_protocol`.",
  parameters: {
    type: "object",
    properties: {
      skillKey: {
        type: "string",
        description: "Snake_case key, must end with _protocol. Example: web_search_protocol.",
      },
      pythonSource: {
        type: "string",
        description: "(legacy: python runtime) The full Python source of the new skill.",
      },
      runtime: {
        type: "string",
        enum: ["python", "javascript", "shell", "wasm", "spec"],
        description: "Runtime of the skill. Defaults to 'python' when pythonSource is provided.",
      },
      payload: {
        description:
          "Runtime-specific payload. " +
          "python/javascript: { source: string } | " +
          "shell: { command: string } | " +
          "wasm: { bytes_ref: string, exports: string[] } | " +
          "spec: { content: unknown, format: string }",
      },
      dryRun: {
        type: "boolean",
        description: "If true, do not write the file — just validate. Default: false.",
      },
    },
    required: ["skillKey"],
  },
  async execute(args, ctx) {
    const skillKey = String(args.skillKey ?? "");
    const runtime = String(args.runtime ?? (args.pythonSource ? "python" : "python"));
    const dryRun = args.dryRun === true;

    if (!skillKey.endsWith("_protocol")) {
      throw new Error(`forge_skill: skillKey must end with _protocol, got ${skillKey}`);
    }
    if (FORGE_PROTECTED.has(skillKey)) {
      throw new Error(`forge_skill: ${skillKey} is a protected built-in skill`);
    }

    // Resolve payload by runtime.
    let bodyText = "";
    let ext = ".py";
    let executable = false;
    const payload: any = args.payload ?? null;

    switch (runtime) {
      case "python": {
        const src =
          args.pythonSource ??
          (payload && typeof payload.source === "string" ? payload.source : "");
        if (typeof src !== "string" || src.length < 10) {
          throw new Error("forge_skill[python]: pythonSource looks empty");
        }
        if (!/def\s+skill\s*\(\s*organism\s*,\s*context\s*\)/.test(src)) {
          throw new Error("forge_skill[python]: source must define `def skill(organism, context)`");
        }
        if (!/"action"\s*:/.test(src)) {
          throw new Error("forge_skill[python]: source must return an intention dict with `action`");
        }
        bodyText = src;
        ext = ".py";
        break;
      }
      case "javascript": {
        const src =
          args.pythonSource ??
          (payload && typeof payload.source === "string" ? payload.source : "");
        if (typeof src !== "string" || src.length < 10) {
          throw new Error("forge_skill[javascript]: source looks empty");
        }
        if (!/function\s+skill\s*\(\s*organism\s*,\s*context\s*\)/.test(src) &&
            !/const\s+skill\s*=\s*\(/.test(src)) {
          throw new Error("forge_skill[javascript]: must define function skill(organism, context)");
        }
        bodyText = src;
        ext = ".js";
        break;
      }
      case "shell": {
        const cmd =
          (payload && typeof payload.command === "string" ? payload.command : "") ||
          (typeof args.pythonSource === "string" ? args.pythonSource : "");
        if (typeof cmd !== "string" || cmd.length < 1) {
          throw new Error("forge_skill[shell]: command required");
        }
        bodyText = `#!/usr/bin/env bash\nset -euo pipefail\n${cmd}\n`;
        ext = ".sh";
        executable = true;
        break;
      }
      case "wasm": {
        if (!payload || typeof payload.bytes_ref !== "string") {
          throw new Error("forge_skill[wasm]: payload.bytes_ref required");
        }
        // We do NOT execute wasm; we just record a reference manifest.
        bodyText = JSON.stringify(
          { kind: "wasm", bytes_ref: payload.bytes_ref, exports: payload.exports ?? [] },
          null,
          2,
        );
        ext = ".wasm.json";
        break;
      }
      case "spec": {
        if (!payload || payload.content === undefined) {
          throw new Error("forge_skill[spec]: payload.content required");
        }
        bodyText = JSON.stringify(payload.content, null, 2);
        ext = ".spec.json";
        break;
      }
      default:
        throw new Error(`forge_skill: unknown runtime "${runtime}"`);
    }

    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    // Convention: write to <workspaceRoot>/<ctx.dnaDir|fallback>/<key>.<ext>
    // The metamorph engine passes a custom dnaDir; ad-hoc callers fall
    // back to packages/metamorfus-src/dna_library.
    const dnaDir = (ctx as any).dnaDir
      ? path.join(ctx.workspaceRoot, (ctx as any).dnaDir)
      : path.join(ctx.workspaceRoot, "packages", "metamorfus-src", "dna_library");
    const target = path.join(dnaDir, `${skillKey}${ext}`);

    if (dryRun) {
      return {
        output: `Would write ${target} (${bodyText.length} bytes, runtime=${runtime}). Validation passed.`,
        data: { skillKey, bytes: bodyText.length, runtime, dryRun: true },
        energyDelta: -0.1,
      };
    }

    await fs.mkdir(dnaDir, { recursive: true });
    await fs.writeFile(target, bodyText, "utf8");
    if (executable) {
      try {
        await fs.chmod(target, 0o755);
      } catch {
        // chmod may fail on some FS; not fatal.
      }
    }
    return {
      output: `Wrote ${skillKey} (${runtime}) to ${target} (${bodyText.length} bytes).`,
      data: { skillKey, path: target, bytes: bodyText.length, runtime },
      energyDelta: -2.0,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TOOL_REGISTRY: readonly ToolDefinition[] = Object.freeze([
  visionDescribe,
  scanCodebase,
  forgeSkill,
]);

const TOOL_BY_NAME = new Map(TOOL_REGISTRY.map((t) => [t.name, t]));

export function listTools(): Array<Pick<ToolDefinition, "name" | "description">> {
  return TOOL_REGISTRY.map(({ name, description }) => ({ name, description }));
}

export function getTool(name: string): ToolDefinition | undefined {
  return TOOL_BY_NAME.get(name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const tool = TOOL_BY_NAME.get(name);
  if (!tool) {
    throw new Error(`executeTool: unknown tool "${name}". Known: ${[...TOOL_BY_NAME.keys()].join(", ")}`);
  }
  return tool.execute(args, ctx);
}
