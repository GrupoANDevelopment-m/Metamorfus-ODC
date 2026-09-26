// Tests for the multi-tenant auth middleware.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tenantAuth, reloadTenants, listTenants, getTenant } from "../auth/tenant-auth.mjs";

const previousEnv = { ...process.env };
let tmp;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "auth-"));
  process.env.TENANTS_JSON = JSON.stringify([
    {
      id: "alpha",
      displayName: "Alpha Co",
      apiKey: "alpha-secret",
      dnaDir: "tenants/alpha/dna_library",
      scopes: ["chat", "vision", "tools", "metamorph", "swarm", "sync"],
    },
    {
      id: "beta",
      displayName: "Beta Labs",
      apiKey: "beta-secret",
      dnaDir: "tenants/beta/dna_library",
      scopes: ["chat", "vision"],
    },
  ]);
  await reloadTenants();
});

after(async () => {
  process.env = previousEnv;
  await fs.rm(tmp, { recursive: true, force: true });
});

function mockReq(path, headers = {}) {
  return { path, headers };
}
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test("auth: missing Authorization header returns 401", async () => {
  const mw = tenantAuth();
  const req = mockReq("/api/chat");
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /missing Authorization/);
  assert.equal(nextCalled, false);
});

test("auth: wrong scheme returns 401", async () => {
  const mw = tenantAuth();
  const req = mockReq("/api/chat", { authorization: "Basic xyz" });
  const res = mockRes();
  await mw(req, res, () => {});
  assert.equal(res.statusCode, 401);
});

test("auth: unknown api key returns 403", async () => {
  const mw = tenantAuth();
  const req = mockReq("/api/chat", { authorization: "Bearer wrong" });
  const res = mockRes();
  await mw(req, res, () => {});
  assert.equal(res.statusCode, 403);
});

test("auth: valid api key attaches tenant and calls next", async () => {
  const mw = tenantAuth();
  const req = mockReq("/api/chat", { authorization: "Bearer alpha-secret" });
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.tenant.id, "alpha");
  assert.deepEqual(req.tenant.scopes, ["chat", "vision", "tools", "metamorph", "swarm", "sync"]);
});

test("auth: missing scope returns 403", async () => {
  const mw = tenantAuth({ requiredScopes: ["sync"] });
  const req = mockReq("/api/admin/sync", { authorization: "Bearer beta-secret" });
  const res = mockRes();
  await mw(req, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /missing scopes: sync/);
});

test("auth: present scope allows access", async () => {
  const mw = tenantAuth({ requiredScopes: ["sync"] });
  const req = mockReq("/api/admin/sync", { authorization: "Bearer alpha-secret" });
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test("auth: /api/health is open (no auth required for liveness)", async () => {
  const mw = tenantAuth();
  const req = mockReq("/api/health");
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.tenant, null);
});

test("auth: listTenants returns the configured tenants", () => {
  const tenants = listTenants();
  assert.equal(tenants.length, 2);
  assert.equal(tenants[0].id, "alpha");
  assert.equal(tenants[1].id, "beta");
});

test("auth: getTenant retrieves a specific tenant", () => {
  const t = getTenant("beta");
  assert.ok(t);
  assert.equal(t.displayName, "Beta Labs");
});

test("auth: TENANTS_JSON env var overrides file-based config", async () => {
  process.env.TENANTS_JSON = JSON.stringify([
    { id: "solo", apiKey: "solo-key", dnaDir: "x", scopes: ["chat"] },
  ]);
  await reloadTenants();
  assert.equal(listTenants().length, 1);
  assert.equal(getTenant("solo").id, "solo");
});
