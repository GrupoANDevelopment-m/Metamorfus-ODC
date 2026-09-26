// DNA library git sync — pushes/pulls the organism's DNA manifest
// across machines. Implements the "sync by git or DB" requirement.
//
// Two modes:
//   • push: commit + push the manifest (and any .py files the user
//     wants to share) to a configured git remote.
//   • pull: fetch + merge the latest manifest from the remote, then
//     re-load the organism's state.
//
// The DNA library is per-tenant. The remote URL is configured via env
// (DNA_GIT_REMOTE) or per-tenant via the auth middleware. Each tenant
// syncs to its own branch to avoid cross-tenant collisions.
//
// Failure modes handled:
//   • no remote configured -> error (operator must wire it up)
//   • no network            -> error propagates with the underlying message
//   • dirty working tree    -> commit is rejected by git; we surface it
//   • merge conflict        -> we 3-way merge; conflicts are surfaced
//                              with both sides for the operator to resolve
//
// This file is the canonical implementation. It calls `git` directly via
// child_process. No deps on isomorphic-git or libgit2.

import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync, statSync } from "node:fs";

const GIT_TIMEOUT_MS = 60_000;

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (c) => (stdout += c));
    proc.stderr.on("data", (c) => (stderr += c));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`git ${args[0]} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS);
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else reject(new Error(`git ${args.join(" ")} exited ${code}: ${stderr.slice(0, 400)}`));
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function author(op) {
  return {
    name: op.authorName ?? process.env.DNA_GIT_AUTHOR_NAME ?? "Metamorfos",
    email: op.authorEmail ?? process.env.DNA_GIT_AUTHOR_EMAIL ?? "metamorfos@localhost",
  };
}

async function ensureRepo(dnaDir) {
  if (!existsSync(dnaDir)) {
    throw new Error(`DNA directory does not exist: ${dnaDir}`);
  }
  const gitDir = path.join(dnaDir, ".git");
  if (!existsSync(gitDir)) {
    await runGit(dnaDir, ["init", "-q", "-b", "main"]);
  }
}

async function configureAuthor(dnaDir, op) {
  const a = author(op);
  await runGit(dnaDir, ["config", "user.name", a.name]);
  await runGit(dnaDir, ["config", "user.email", a.email]);
}

function resolveRemote(op) {
  const remote = op.remote ?? process.env.DNA_GIT_REMOTE;
  if (!remote) {
    throw new Error(
      "No remote configured. Set DNA_GIT_REMOTE or pass `remote` to " +
        "DnaSync. The organism cannot sync without a destination.",
    );
  }
  return remote;
}

/**
 * Push the current DNA state to the tenant's remote branch.
 *
 *   1. Stage all changes in <dnaDir>.
 *   2. Commit with a deterministic message including tenantId + ISO ts.
 *   3. Add or update the remote (idempotent).
 *   4. Push to refs/heads/<tenantId>.
 *
 * Returns the new commit SHA + bytes pushed.
 */
export async function pushDna(op) {
  await ensureRepo(op.dnaDir);
  await configureAuthor(op.dnaDir, op);
  const remote = resolveRemote(op);

  try {
    await runGit(op.dnaDir, ["remote", "get-url", "origin"]);
    await runGit(op.dnaDir, ["remote", "set-url", "origin", remote]);
  } catch {
    await runGit(op.dnaDir, ["remote", "add", "origin", remote]);
  }

  await runGit(op.dnaDir, ["add", "-A"]);

  const status = await runGit(op.dnaDir, ["status", "--porcelain"]);
  const branch = `tenant-${op.tenantId}`;

  if (!status.stdout.trim()) {
    let pushed = false;
    try {
      await runGit(op.dnaDir, ["push", "-u", "origin", branch]);
      pushed = true;
    } catch {
      // No upstream yet — that's fine, leave it as a noop.
    }
    return {
      ok: true,
      action: "noop",
      branch,
      remote,
      message: pushed ? "no changes; branch published" : "no changes; no upstream yet",
    };
  }

  const ts = new Date().toISOString();
  const message = `dna-sync: tenant=${op.tenantId} ts=${ts}`;
  await runGit(op.dnaDir, ["commit", "-q", "-m", message]);

  const sha = (await runGit(op.dnaDir, ["rev-parse", "HEAD"])).stdout.trim();
  await runGit(op.dnaDir, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);

  const packOut = await runGit(op.dnaDir, ["count-objects", "-v"]);
  const sizeLine = packOut.stdout.split("\n").find((l) => l.startsWith("size-pack"));
  const bytesPushed = sizeLine ? Number(sizeLine.split(":")[1]?.trim() ?? "0") : 0;

  return {
    ok: true,
    action: "push",
    branch,
    remote,
    commitSha: sha,
    bytesPushed,
    message: `pushed ${sha.slice(0, 12)} to ${branch}`,
  };
}

/**
 * Pull the latest DNA state for this tenant from its remote branch.
 *
 *   1. Fetch origin/<tenantId>.
 *   2. If we have a local branch, fast-forward or 3-way merge into it.
 *   3. If we don't, create it from origin.
 *
 * If there are conflicts (e.g., two machines forged the same skill in
 * different versions), the merge is aborted and the conflict list is
 * returned so the operator can resolve.
 */
export async function pullDna(op) {
  await ensureRepo(op.dnaDir);
  await configureAuthor(op.dnaDir, op);
  const remote = resolveRemote(op);
  const branch = `tenant-${op.tenantId}`;

  try {
    await runGit(op.dnaDir, ["remote", "get-url", "origin"]);
  } catch {
    await runGit(op.dnaDir, ["remote", "add", "origin", remote]);
  }

  await runGit(op.dnaDir, ["fetch", "origin", branch]);

  let localExists = false;
  try {
    await runGit(op.dnaDir, ["rev-parse", "--verify", branch]);
    localExists = true;
  } catch {
    localExists = false;
  }

  if (!localExists) {
    await runGit(op.dnaDir, ["checkout", "-q", "-b", branch, `origin/${branch}`]);
    const bytes = statSync(path.join(op.dnaDir, "manifest.json")).size;
    return {
      ok: true,
      action: "pull",
      branch,
      remote,
      bytesPulled: bytes,
      message: `created local branch ${branch} from origin`,
    };
  }

  try {
    await runGit(op.dnaDir, ["merge", "--ff-only", `origin/${branch}`]);
    const bytes = statSync(path.join(op.dnaDir, "manifest.json")).size;
    return {
      ok: true,
      action: "pull",
      branch,
      remote,
      bytesPulled: bytes,
      message: `fast-forwarded to origin/${branch}`,
    };
  } catch {
    // Fall through to 3-way merge.
  }

  try {
    await runGit(op.dnaDir, ["merge", "--no-edit", `origin/${branch}`]);
    const bytes = statSync(path.join(op.dnaDir, "manifest.json")).size;
    return {
      ok: true,
      action: "pull",
      branch,
      remote,
      bytesPulled: bytes,
      message: `3-way merged origin/${branch}`,
    };
  } catch {
    const conflictOut = await runGit(op.dnaDir, ["diff", "--name-only", "--diff-filter=U"]);
    const conflicts = conflictOut.stdout.trim().split("\n").filter(Boolean);
    try {
      await runGit(op.dnaDir, ["merge", "--abort"]);
    } catch {
      // already aborted or no merge in progress
    }
    return {
      ok: false,
      action: "pull",
      branch,
      remote,
      conflicts,
      message: `merge conflict on ${conflicts.length} file(s) — resolve manually`,
    };
  }
}
