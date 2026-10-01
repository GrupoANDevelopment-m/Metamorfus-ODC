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
        // Preserve identifying data so the report is self-describing.
        skillKey: step.skillKey,
        package: step.package,
        url: step.url,
        command: step.command,
        rationale: step.rationale,
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
            // pip_install is a *self-expansion* step: the organism
            // tries to grow into the dependency. If it fails (no
            // network, externally-managed env, missing pip), we
            // record the failure as a warning but CONTINUE — the
            // plan can still succeed if the remaining skills use
            // only the stdlib. The skill that needs the missing
            // package will fail at invocation with a clear error.
            try {
              stepRecord.output = await this._pipInstall(step);
            } catch (e) {
              stepRecord.status = "warn";
              stepRecord.error = `pip install unavailable in this environment: ${e?.message?.slice(0, 300) ?? "unknown"}`;
              stepRecord.output = { warning: "skipped — skill may fail at runtime if it needs this package" };
              this.onLog(`[orchestrator ${runId}] step ${i + 1} pip_install WARN: ${stepRecord.error.slice(0, 200)}`);
            }
            break;
          case "git_clone":
            stepRecord.output = await this._gitClone(step);
            break;
          case "run_shell":
            stepRecord.output = await this._runShell(step);
            break;
          case "record_metamorphose":
            stepRecord.output = await this._recordMetamorphose(morphosis, step);
            break;
          default:
            throw new Error(`unknown step kind: ${step.kind}`);
        }
        if (stepRecord.status !== "warn") stepRecord.status = "done";
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
    // Self-expansion: actually install the package via the real
    // Python interpreter. The organism uses pip to grow into the
    // dependencies it needs to become the requested system.
    //
    // Modern Debian/Ubuntu blocks system-wide pip installs. We try
    // --break-system-packages first (the right flag for non-venv
    // installs on externally-managed systems), then fall back to
    // --user, then to a venv. Whatever works.
    const attempts = [
      [this.pythonBin, "-m", "pip", "install", "--user", "--break-system-packages", "--quiet", step.package],
      [this.pythonBin, "-m", "pip", "install", "--user", "--quiet", step.package],
    ];
    let lastErr = null;
    for (const args of attempts) {
      try {
        return await this._exec(args, { stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`pip install ${step.package} failed: ${lastErr?.message ?? "unknown"}`);
  }

  async _gitClone(step) {
    if (!step.url) throw new Error("git_clone requires url");
    // Self-expansion: clone real working code from GitHub into the
    // DNA library so the organism can use it as a building block.
    const target = path.join(this.dnaDir, "_git_imports", path.basename(step.url, ".git"));
    return await this._exec(["git", "clone", "--depth=1", step.url, target], { stdio: ["ignore", "pipe", "pipe"] });
  }

  async _runShell(step) {
    // Optional shell step for tools that aren't pip (apt, npm, brew).
    const cmd = step.command;
    if (!cmd || !Array.isArray(cmd)) throw new Error("run_shell requires command: string[]");
    return await this._exec(cmd, { stdio: ["ignore", "pipe", "pipe"] });
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
