/**
 * Package root resolution.
 *
 * Every cognitive module, identity module, and test needs to reach the
 * package's own files — dna_library, manifest.json, baselines,
 * ensemble_cache.json. Those paths used to be a hardcoded literal
 * pointing at one developer's sandbox. It worked there and nowhere else:
 * not on CI, not on a fresh clone, and not in the Docker image, where
 * that directory does not exist at all. 19 production modules were
 * affected.
 *
 * Resolution is layered so the organism can still be pointed at an
 * explicit workspace when one is supplied (that is how the battery and
 * the test harness run against an isolated copy):
 *
 *   1. explicit argument, when a caller passes one
 *   2. METAMORFUS_PACKAGE_ROOT, for deployment layouts that differ
 *   3. this file's own location — correct for any checkout, any name
 *   4. process.cwd() walking up to the directory holding dna_library
 *
 * Layer 3 is the important one: it is derived from import.meta.url, so it
 * keeps working when the repo is cloned under a different name, mounted
 * at a different depth, or copied into a container.
 */

import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Directory holding this helper — server/. */
const SERVER_DIR = HERE;

/**
 * True when a directory looks like the Metamorfus package root — it must
 * contain both the server code and the DNA library, otherwise a stray
 * match higher up the tree would send us somewhere useless.
 */
function looksLikePkgRoot(dir) {
  try {
    return (
      fs.existsSync(path.join(dir, "dna_library")) &&
      fs.existsSync(path.join(dir, "server"))
    );
  } catch {
    return false;
  }
}

function detectFromCwd() {
  let dir = process.cwd();
  // Bounded walk — 12 levels is far more than any sane checkout depth.
  for (let i = 0; i < 12; i++) {
    if (looksLikePkgRoot(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cached = null;

/** @param {string} [override] explicit workspace/package root */
export function packageRoot(override) {
  if (override) return override;

  if (cached) return cached;

  const fromEnv = process.env.METAMORFUS_PACKAGE_ROOT;
  if (fromEnv && looksLikePkgRoot(fromEnv)) {
    cached = fromEnv;
    return cached;
  }

  // server/package-root.mjs -> package root is one level up.
  const fromFile = path.resolve(SERVER_DIR, "..");
  if (looksLikePkgRoot(fromFile)) {
    cached = fromFile;
    return cached;
  }

  const fromCwd = detectFromCwd();
  if (fromCwd) {
    cached = fromCwd;
    return cached;
  }

  // Last resort: trust the file location even if the tree looks unusual.
  // A probably-right guess beats a hardcoded foreign path.
  cached = fromFile;
  return cached;
}

/** Absolute path to a file inside the package. */
export function packagePath(...segments) {
  return path.join(packageRoot(), ...segments);
}

/** Absolute path to the DNA library directory. */
export function dnaLibrary() {
  return packagePath("dna_library");
}

/** Test hook — forces a root and clears the cache. */
export function __setPackageRoot(dir) {
  cached = dir ?? null;
  return cached;
}
