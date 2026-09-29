// Metamorphose Orchestrator — takes a system prompt and EXECUTES the
// plan the cortex generates. Each step (forge_skill, pip_install,
// git_clone, etc.) is run in order with progress reported to the
// caller. Failures halt the plan and report which step failed.
//
// Why this exists: the dashboard's "Profession" panel lets the
// operator type a system prompt. Before this module, the cortex
// would generate a beautiful plan and then nothing happened. Now the
// orchestrator runs each step in sequence so the organism actually
// morphs.

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

/**
 * @typedef {Object} MetamorphoseStep
 * @property {string} stepId
 * @property {"forge_skill"|"pip_install"|"git_clone"|"record_metamorphose"} kind
 * @property {string} [skillKey]
 * @property {string} [pythonSource]
 * @property {string} [package]
 * @property {string} [url]
 * @property {string} [rationale]
 */

/**
 * @typedef {Object} OrchestratorDeps
 * @property {Function} forgeSkill     ({skillKey, pythonSource}) => Promise<any>
 * @property {string}   dnaDir         DNA library root
 * @property {string}   [pythonBin]    python interpreter to use (default: "python3")
 * @property {number}   [stepTimeoutMs] per-step timeout (default: 60s)
 * @property {(line: string) => void} [onLog]  log line callback
 */

export class MetamorphoseOrchestrator {
  /** @param {OrchestratorDeps} deps */
  constructor(deps) {
    if (!deps?.forgeSkill) throw new Error("forgeSkill dependency required");
    if (!deps?.dnaDir) throw new Error("dnaDir required");
    this.forgeSkill = deps.forgeSkill;
    this.dnaDir = deps.dnaDir;
    this.pythonBin = deps.pythonBin ?? "python3";
    this.stepTimeoutMs = deps.stepTimeoutMs ?? 60_000;
    this.onLog = deps.onLog ?? (() => {});
  }

  /**
   * Run a plan end-to-end. Returns the run report with per-step
   * status. Halts on the first failure.
   * @param {{ id: string, systemPrompt: string, plan: { steps: MetamorphoseStep[] } }} morphosis
   */
  async run(morphosis) {
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const report = {
      runId,
      morphosisId: morphosis.id,
      systemPrompt: morphosis.systemPrompt,
      startedAt,
      finishedAt: null,
      steps: [],
      status: "running",
    };
    this.onLog(`[orchestrator ${runId}] start metamorphosis ${morphosis.id}`);

    for (let i = 0; i < morphosis.plan.steps.length; i++) {
      const step = morphosis.plan.steps[i];
      const stepRecord = {
        stepId: step.stepId ?? `step-${i + 1}`,
        index: i + 1,
        kind: step.kind,
        status: "running",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        error: null,
        output: null,
      };
      try {
        this.onLog(`[orchestrator ${runId}] step ${i + 1}/${morphosis.plan.steps.length}: ${step.kind}`);
        switch (step.kind) {
          case "forge_skill":
            stepRecord.output = await this._forgeSkill(step);
            break;
          case "pip_install":
            stepRecord.output = await this._pipInstall(step);
            break;
          case "git_clone":
            stepRecord.output = await this._gitClone(step);
            break;
          case "record_metamorphose":
            stepRecord.output = await this._recordMetamorphose(morphosis, step);
            break;
          default:
            throw new Error(`unknown step kind: ${step.kind}`);
        }
        stepRecord.status = "done";
      } catch (e) {
        stepRecord.status = "failed";
        stepRecord.error = e?.message ?? String(e);
        report.status = "failed";
        this.onLog(`[orchestrator ${runId}] FAIL at step ${i + 1}: ${stepRecord.error}`);
        report.steps.push(stepRecord);
        break;
      } finally {
        stepRecord.finishedAt = new Date().toISOString();
      }
      report.steps.push(stepRecord);
    }
    if (report.status === "running") report.status = "done";
    report.finishedAt = new Date().toISOString();
    this.onLog(`[orchestrator ${runId}] end status=${report.status} steps=${report.steps.length}`);
    return report;
  }

  async _forgeSkill(step) {
    if (!step.skillKey || !step.pythonSource) {
      throw new Error("forge_skill requires skillKey + pythonSource");
    }
    return await this.forgeSkill({
      skillKey: step.skillKey,
      pythonSource: step.pythonSource,
    });
  }

  async _pipInstall(step) {
    if (!step.package) throw new Error("pip_install requires package");
    // Use --user to avoid touching system packages. In production,
    // this should run inside a per-tenant venv; for now the dry-run
    // flag in forge_skill keeps tests hermetic.
    const args = ["-m", "pip", "install", "--user", "--quiet", step.package];
    return await this._exec(args, { stdio: ["ignore", "pipe", "pipe"] });
  }

  async _gitClone(step) {
    if (!step.url) throw new Error("git_clone requires url");
    const target = path.join(this.dnaDir, "_git_imports", path.basename(step.url, ".git"));
    return await this._exec(["git", "clone", "--depth=1", step.url, target], { stdio: ["ignore", "pipe", "pipe"] });
  }

  async _recordMetamorphose(morphosis, step) {
    // Persist a log entry under dnaDir/_metamorphosis_log.json so the
    // organism remembers what it became. Append-only — never overwrites.
    const logFile = path.join(this.dnaDir, "_metamorphosis_log.json");
    await fs.mkdir(this.dnaDir, { recursive: true });
    let entries = [];
    try {
      const raw = await fs.readFile(logFile, "utf8");
      entries = JSON.parse(raw);
      if (!Array.isArray(entries)) entries = [];
    } catch { /* first entry */ }
    entries.push({
      id: morphosis.id,
      ts: new Date().toISOString(),
      systemPrompt: morphosis.systemPrompt,
      note: step.rationale ?? null,
    });
    await fs.writeFile(logFile, JSON.stringify(entries, null, 2));
    return { recorded: true, logFile, count: entries.length };
  }

  _exec(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.stepTimeoutMs);
      const proc = spawn(args[0], args.slice(1), { ...opts, signal: controller.signal });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (c) => { stdout += c.toString(); });
      proc.stderr?.on("data", (c) => { stderr += c.toString(); });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`spawn ${args[0]} failed: ${err.message}`));
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (controller.signal.aborted) {
          return reject(new Error(`${args.join(" ")} timed out after ${this.stepTimeoutMs}ms`));
        }
        if (code === 0) {
          resolve({ code, stdout: stdout.slice(0, 2000), stderr: stderr.slice(0, 2000) });
        } else {
          reject(new Error(`${args.join(" ")} exited ${code}: ${stderr.slice(0, 500)}`));
        }
      });
    });
  }
}

/**
 * Read the persisted metamorphosis log so the dashboard can show the
 * history of transformations the organism has undergone.
 */
export async function readMetamorphosisLog(dnaDir) {
  const logFile = path.join(dnaDir, "_metamorphosis_log.json");
  try {
    const raw = await fs.readFile(logFile, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
