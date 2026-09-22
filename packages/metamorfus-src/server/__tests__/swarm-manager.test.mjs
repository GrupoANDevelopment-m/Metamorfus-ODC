// Integration test: SwarmManager (botnet control without Docker).
// Real subprocess spawning, real Python execution, real broadcast.

import { test } from "node:test";
import assert from "node:assert/strict";
import { SwarmManager } from "../swarm/swarm-manager.mjs";

test("swarm: spawns N nodes, each has unique pid", async (t) => {
  const mgr = new SwarmManager({ count: 3 });
  t.after(() => mgr.close());
  await new Promise((r) => setTimeout(r, 100));
  const list = mgr.listNodes();
  assert.equal(list.length, 3);
  const pids = new Set(list.map((n) => n.pid));
  assert.equal(pids.size, 3, "all pids must be distinct");
  for (const n of list) {
    assert.ok(n.alive);
    assert.ok(n.pid > 0);
  }
});

test("swarm: PING round-trip on a node", async (t) => {
  const mgr = new SwarmManager({ count: 1 });
  t.after(() => mgr.close());
  const node = mgr.listNodes()[0];
  // Use the broadcast path to test single-node too.
  const r = await mgr.broadcast(
    `import sys
print("hello-from-python")
print("pid=", __import__('os').getpid())`,
  );
  assert.equal(r.length, 1);
  assert.ok(r[0].ok);
  assert.match(r[0].stdout, /hello-from-python/);
  assert.match(r[0].stdout, /pid=\s*\d+/);
});

test("swarm: broadcast executes Python on all live nodes", async (t) => {
  const mgr = new SwarmManager({ count: 4 });
  t.after(() => mgr.close());
  const r = await mgr.broadcast(
    `import socket, json
print(json.dumps({"host": socket.gethostname(), "noop": True}))`,
  );
  assert.equal(r.length, 4);
  for (const nodeResult of r) {
    assert.ok(nodeResult.ok, `node ${nodeResult.nodeId} failed: ${nodeResult.stderr}`);
    assert.match(nodeResult.stdout, /"host":/);
  }
});

test("swarm: killed node rejects subsequent requests", async (t) => {
  const mgr = new SwarmManager({ count: 2 });
  t.after(() => mgr.close());
  const list = mgr.listNodes();
  const target = list[0];
  assert.ok(mgr.killNode(target.id));
  await new Promise((r) => setTimeout(r, 200));
  const after = mgr.listNodes();
  const killed = after.find((n) => n.id === target.id);
  assert.ok(killed);
  assert.equal(killed.alive, false);
  await assert.rejects(
    () => mgr.execOnNode(target.id, "print(1)"),
    /dead|exited/,
  );
});

test("swarm: per-node timing is reasonable (<2s for trivial code)", async (t) => {
  const mgr = new SwarmManager({ count: 3 });
  t.after(() => mgr.close());
  const r = await mgr.broadcast("print('ok')");
  for (const x of r) {
    assert.ok(x.durationMs < 2000, `slow node: ${x.nodeId} (${x.durationMs}ms)`);
    assert.ok(x.ok);
  }
});

test("swarm: a Python exception in the payload is captured, not crash", async (t) => {
  const mgr = new SwarmManager({ count: 2 });
  t.after(() => mgr.close());
  const r = await mgr.broadcast(`raise RuntimeError("intentional")`);
  assert.equal(r.length, 2);
  for (const x of r) {
    assert.equal(x.ok, false);
    assert.match(x.stderr, /intentional/);
  }
});

test("swarm: spawning a new node increases fleet size", async (t) => {
  const mgr = new SwarmManager({ count: 1 });
  t.after(() => mgr.close());
  const before = mgr.listNodes().length;
  mgr.spawn();
  const after = mgr.listNodes().length;
  assert.equal(after, before + 1);
});
