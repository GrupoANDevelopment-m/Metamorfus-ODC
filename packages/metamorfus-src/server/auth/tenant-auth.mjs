// Multi-tenant auth middleware for the Metamorfus ODC headless server.
//
// Each request must carry a bearer token in `Authorization: Bearer <key>`.
// Tokens are resolved against a tenant registry. Each tenant has:
//   • id           — opaque identifier (e.g. "tenant-foo")
//   • displayName  — human-readable label
//   • apiKey       — shared secret used to authenticate
//   • dnaDir       — per-tenant DNA library directory
//   • scopes       — array of granted capabilities
//
// The middleware exposes a typed `req.tenant` for downstream handlers.
// If auth fails, it short-circuits with the right HTTP code:
//   • missing Authorization -> 401
//   • wrong scheme          -> 401
//   • unknown key           -> 403
//   • insufficient scope    -> 403
//
// Tenant registry sources (in priority order):
//   1. TENANTS_JSON env var (JSON object)
//   2. tenants.json file in the workspace root
//   3. In-memory defaults for development
//
// Real deployments should never use the in-memory defaults. This file
// exports a `reloadTenants()` hook so an operator can hot-reload after
// rotating keys.

import fs from "node:fs/promises";
import path from "node:path";

/**
 * @typedef {Object} Tenant
 * @property {string} id
 * @property {string} displayName
 * @property {string} apiKey
 * @property {string} dnaDir
 * @property {string[]} scopes
 */

const DEFAULT_TENANTS = [
  {
    id: "tenant-local",
    displayName: "Local Development",
    apiKey: "dev-secret-local",
    dnaDir: "packages/metamorfus-src/dna_library",
    scopes: ["chat", "vision", "tools", "metamorph", "swarm", "sync"],
  },
];

let tenants = [];

function asStringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function normalize(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t) => t && typeof t === "object" && typeof t.id === "string" && typeof t.apiKey === "string")
    .map((t) => ({
      id: String(t.id),
      displayName: typeof t.displayName === "string" ? t.displayName : String(t.id),
      apiKey: String(t.apiKey),
      dnaDir: typeof t.dnaDir === "string" ? t.dnaDir : `tenants/${t.id}/dna_library`,
      scopes: asStringArray(t.scopes),
    }));
}

export async function reloadTenants(opts = {}) {
  // Source 1: TENANTS_JSON env var.
  if (process.env.TENANTS_JSON) {
    try {
      tenants = normalize(JSON.parse(process.env.TENANTS_JSON));
      return;
    } catch (e) {
      console.error("[auth] TENANTS_JSON parse failed:", (e && e.message) || e);
    }
  }

  // Source 2: tenants.json in workspace root.
  const candidates = [];
  if (opts.tenantsJsonPath) candidates.push(opts.tenantsJsonPath);
  if (opts.workspaceRoot) candidates.push(path.join(opts.workspaceRoot, "tenants.json"));
  for (const c of candidates) {
    try {
      const raw = await fs.readFile(c, "utf8");
      tenants = normalize(JSON.parse(raw));
      console.log(`[auth] loaded ${tenants.length} tenant(s) from ${c}`);
      return;
    } catch {
      // not present or invalid — try next
    }
  }

  // Source 3: in-memory default for development.
  tenants = DEFAULT_TENANTS;
  console.warn(
    "[auth] using in-memory default tenant; configure TENANTS_JSON or tenants.json for production",
  );
}

function extractBearer(req) {
  const h = req?.headers?.authorization ?? req?.headers?.Authorization;
  if (typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(\S+)\s*$/i);
  return m ? m[1] : null;
}

/**
 * Express-compatible middleware. Attaches `req.tenant` and calls
 * next() on success, or short-circuits with the right HTTP code.
 */
export function tenantAuth(opts = {}) {
  return async function authMiddleware(req, res, next) {
    if (tenants.length === 0) {
      await reloadTenants();
    }

    // Allow unauthenticated probe on the health endpoint so liveness
    // checks don't need a token. The route handler decides whether to
    // actually expose anything sensitive.
    if (req.path === "/api/health") {
      req.tenant = null;
      return next();
    }

    const token = extractBearer(req);
    if (!token) {
      return res.status(401).json({
        error: "missing Authorization: Bearer <key>",
        auth: "tenant",
      });
    }

    const tenant = tenants.find((t) => t.apiKey === token);
    if (!tenant) {
      return res.status(403).json({
        error: "unknown api key",
      });
    }

    if (opts.requiredScopes && opts.requiredScopes.length > 0) {
      const missing = opts.requiredScopes.filter((s) => !tenant.scopes.includes(s));
      if (missing.length > 0) {
        return res.status(403).json({
          error: `missing scopes: ${missing.join(", ")}`,
        });
      }
    }

    req.tenant = tenant;
    return next();
  };
}

export function listTenants() {
  return tenants.slice();
}

export function getTenant(id) {
  return tenants.find((t) => t.id === id);
}
