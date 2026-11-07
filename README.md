# Metamorfus ODC

A cognitive organism. Python skills executed for real, an LLM that can
write new ones, and a test battery that measures whether any of it works
instead of asserting that it does.

OpenCode (`anomalyco/opencode`) is vendored in `packages/opencode-src/`
and reachable over HTTP. Metamorfus talks to it through
`server/odc-opencode-bridge.ts` and degrades to NVIDIA direct when it is
not running.

The bridge used to speak a protocol OpenCode does not serve — wrong health
path, wrong response shape, a `model` sent as a string where a `ModelRef`
is required. Every mismatch was silent, so the sidecar was reported
unreachable, `/api/chat` always fell back to the local LLM library, and
the OpenCode path never engaged at all. It now speaks the server's actual
schema, verified against the vendored source, and
`server/__tests__/opencode-bridge.test.mjs` serves those exact shapes from
a fake server — the test fails on the old bridge and passes on the new
one.

---

## What this actually does

Ask for something. The organism classifies the intent, picks skills for
the active profession, executes them as Python subprocesses, fuses the
results, and explains the answer. When it finds a gap in what it can do,
it writes a new skill, validates it on held-out data, and keeps it only
if it measurably wins.

```
request
  └─ classify intent (LLM)
      └─ select skills   ── complementarity (Pearson/Spearman)
          │                   meta-orchestrator (signal taxonomy)
          │                   ensemble cache (past winners)
          └─ execute        ── python3 server/skills/invoker.py <skill>.py
              └─ fuse       ── synthesis (cross-pattern detection)
                  └─ explain
                       └─ if gap: auto-forge ── LLM writes Python
                                               ── compile() validates
                                               ── k-fold CV on held-out
                                               ── keep only if it wins
```

## Running it

### Docker (both services)

```bash
export NVIDIA_API_KEY=nvapi-...
docker compose up --build
```

- OpenCode on `:4096`
- Metamorfus on `:3457` — health at `/api/health`

The `metamorfus-dna` volume holds forged skills, usage history, and the
ensemble cache. Without it the organism forgets what it learned on every
rebuild.

### Local

```bash
cd packages/metamorfus-src
npm install

# the organism alone — talks to NVIDIA directly
npx tsx server/headless-server.mjs

# optionally, OpenCode as well
cd ../opencode-src/packages/opencode && bun install && bun run dev serve
```

`tsx` is not optional. The `.mjs` tests and the server import
`server/odc-opencode-bridge.ts`, which plain `node` cannot resolve.

### Tests

```bash
# offline — no key needed (92 tests)
npx tsx --test \
  server/__tests__/cognitive.test.mjs \
  server/__tests__/archaeology.test.mjs \
  server/__tests__/identity.test.mjs \
  server/__tests__/constitution-memory.test.mjs \
  server/__tests__/llm-library.test.mjs \
  server/__tests__/model-liveness.test.mjs \
  server/__tests__/capability-forge.test.mjs \
  server/__tests__/opencode-bridge.test.mjs \
  server/__tests__/skill-runtimes.test.mjs \
  server/__tests__/skill-contracts.test.mjs \
  server/__tests__/tool-registry.test.ts

# live battery — needs a key, ~5 min
bash .run-battery.sh
```

CI runs the offline suite on every push and the battery on `main`.

---

## The part that matters: skills really run

There was a bug where the runner spawned `python3 dna_library/SKILL.py`.
Python defined `def skill()`, exited 0, printed nothing, and the runner
parsed an empty string as success. Every test in T1–T11 passed for the
wrong reason.

T17 exists because of the same class of bug: a skill that is *in the
manifest* is not a skill that *works*. `server/cognitive/reachability.mjs`
invokes all 54 and reports what actually happened.

`server/skills/runner.mjs` now spawns `server/skills/invoker.py`, which
imports the module, calls `skill(organism, context)`, and prints the
result as JSON. A skill that raises returns `ok: false` with the
traceback rather than exiting quietly.

A second bug lived in the same family: `executeBridgeTool` was called
with the workspace root in the wrong shape in six places, so
`ctx.workspaceRoot` was `undefined` and the bridge silently fell back to
its own directory. Every forged skill — including the ones written
through the HTTP API — landed in the installed package instead of the
tenant's library, and nothing said so. The call sites are fixed, and the
bridge now rejects a malformed context instead of guessing.

Contexts over 64 KB go through a temp file instead of an env var. Passing
1000 transactions as `METAMORFUS_CONTEXT` hit the kernel's `ARG_MAX` and
the spawn died with `E2BIG` — which is why diagnosis once reported
`caught=0` while k-fold CV reported `F1=0.967` on the same data.

---

## The bug that was hiding in plain sight

`analyze_pressure_gradient_protocol` reads
`stations[{ id, pressure, lat, lon }]`. Every caller in the repository sent
`{ station_id, pressure_hpa }`.

So the pressure arrived as `0`. Every gradient came out as `0`. The field
looked perfectly flat. And the call returned `ok: true`, because nothing had
crashed — the skill was answering a question nobody had asked it.

`engineer_load_calc_protocol` had the same shape: it reads
`loads{ moment, shear, axial, length }` and
`section{ type, depth, width }`, and its callers sent
`distributed_kg_m2`, `span_m`, `depth_m`, `width_m`. It fell back to its
defaults every time and reported a utilisation of `0`.

This was the machinery behind the old fake "64.7% cross-domain gain": two of
the three domains were contributing nothing while reporting success. A test
that asserts "the fusion beats the baseline" cannot see that two of its three
inputs are zero — the fusion still beats the baseline, just for the wrong
reason.

The adapters now speak the contracts the skills actually implement, and
`server/__tests__/skill-contracts.test.mjs` closes the class of bug: it sends
each documented context and asserts the output is **not degenerate** —
gradients computed, utilisation above zero, RSI in range, temperatures
actually read. Rewrite a skill, rename a field, or let an adapter drift, and
the test fails instead of quietly returning zeros.

---

## Battery results

Real numbers from real runs. Where a result was not significant, it says
so.

| Test | What it measures | Result |
|---|---|---|
| T1 | Identity preservation | IPS 93.33, transferability 33.33 |
| T4 | Precision under load | 0.9999, RSI matches Wilder's reference |
| T6 | Self-modification | LLM wrote 2922 bytes of Python, compiles and runs |
| T12 | Does cross-domain help? | MAE 4.365 → 0.878 (79.9%) — beats every single domain |
| T13 | Auto-forged skill on held-out data | F1 0.571 → 1.000 |
| T14 | Significance | baseline 0.147 [0.000, 0.398] vs forged 0.434 [0.248, 0.620] — **not significant** |
| T15 | PaySim-like data, k=10 | F1 0.933 [0.833, 1.000] |
| T16 | Directional forge | baseline 0.967 [0.891, 1.000], forge had nothing to add |
| T17 | Are the skills real? | 44 of 53 live skills execute and return values, **0 broken** |
| T18 | Can the organism grow a capability? | forged, registered, executed — and it landed in the workspace, not the package |

T14 is the honest one. The forged skill scored higher, but the confidence
intervals overlap, so it is reported as not significant rather than as a
win.

T12 used to claim 64.7%. It was false: the "gain" was the trader RSI skill
alone, while the meteorology and engineering skills were being fed inputs
they do not read and their outputs were read through keys that do not
exist. Both failed silently and contributed nothing.

It now measures against skills that really answer:

| | baseline | trader only | best single | 2-domain | 3-domain |
|---|---|---|---|---|---|
| domains agree | 4.365 | 3.570 | 3.570 | 1.185 | **0.878 (−79.9%)** |
| trader confidently wrong | 1.778 | 2.670 | 1.252 | 0.325 | **0.764 (−57.1%)** |

On the disagreement case the trader **abstains** on purpose: its RSI is
pinned at 100, but the meteorology profile shows the field is building
energy, and the range that RSI assumes is not there. The meteorology domain
then votes the direction, engineering modulates the magnitude (headroom
0.41, ×1.21), and the fusion lands closer to the truth than any single
domain does. The test asserts that the fusion beats every single domain on
both cases — a weaker assertion would let two inert domains hide behind
one good one again.

T17 counts no files. It invokes every skill in the manifest through the
real invoker and sorts the outcomes into executed / needs-input /
needs-tool / degraded / broken. The distinction that matters:

- **broken** — the skill raised. That is a bug.
- **degraded** — the skill ran and reported a condition honestly, like
  `{"error": "playwright failed: Executable doesn't exist"}`. That is the
  skill *working*, telling the truth about its environment.

The invoker prefixes its own faults with `invoker:`, which is how the two
are told apart. Today: **44 executed, 1 degraded, 8 need an external
program** (`nginx`, `archify`, `bsk`, `browser_use`, `browser-harness`,
`agent_reach`, `github-mcp-server`, a live HTTP server), **0 broken**.

One skill is **retired** rather than deleted: `test_realskill_protocol`
was a stub that returned a constant dict and computed nothing. The
constitution is explicit — *"No skill may be deleted, only retired (marked
archaeology) and superseded by a new version"* — so it stays in the
manifest and on disk with its history, marked `archaeology`.

### Growing a capability

`POST /api/capabilities/forge` asks the organism to implement a
capability it does not have. It takes a description of what is missing,
nothing else — no template, no source, no domain hint — and then:

1. the model writes the skill (walking the verified chain until the code
   validates, because the router's failover only sees transport errors)
2. the skill is written into **the caller's workspace**
3. it is registered in that workspace's manifest with its provenance
   (`created_by`, `forged_by_model`)
4. it is **executed** with a smoke-test context, and the real output is
   returned

`GET /api/capabilities` lists what the organism holds and where each
skill came from. T18 asserts all four steps, including that the forged
skill does **not** appear in the installed package.

---

## Models

`moonshotai/kimi-k3` was hardcoded everywhere and reached end of life on
2026-10-15. Every forge path was returning `410 Gone`.

`server/llm-library/model-registry.mjs` lists what was verified live by
probing real completions, and — importantly — by compiling and executing
the Python each one produces. Listing in `/v1/models` is not
availability; `moonshotai/kimi-k2.6` is still catalogued and still dead.

Re-probed on 2026-10-29, because the catalog churns: `z-ai/glm-5.3` was in
the chain on 2026-10-23 and was retired on 2026-10-28, which is exactly
what broke T14 on 2026-10-29.

| Model | Status |
|---|---|
| `nvidia/nemotron-3-ultra-550b-a55b` | primary — generates Python that runs |
| `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` | fallback — generates Python that runs |
| `openai/gpt-oss-20b` | fallback — generates Python that runs |
| `z-ai/glm-5.3` | 410 Gone since 2026-10-28 |
| `nvidia/nemotron-3-super-120b-a12b` | 404, ghost catalog entry |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | replies, but emits no function |
| `moonshotai/kimi-k3` | 410 Gone |
| `moonshotai/kimi-k2.6` | 404, ghost catalog entry |

NVIDIA is registered under all three categories. The router filters by
category before trying anything, so a key registered only as
`multimodal` leaves the forge with nothing to call.

**The registry heals itself now.** The chain is probed before it is used,
and a model is retired **only** on an explicit `404` or `410`. A timeout,
a `429` or a `5xx` proves nothing — retiring a working model because the
network hiccuped would be worse than the original bug — so those models
stay in the chain. Results are cached for 30 minutes. Verified against the
live API: `glm-5.3` and `nemotron-3-super` are retired, the ultra and
`gpt-oss-20b` answer.

### The runner honours the declared runtime

`sharpen_axe` is a shell skill, `navigate_forest` is JavaScript,
`weather_read` and `material_selection` are specification documents. The
runner used to look for `<key>.py` regardless, so in a fresh workspace —
where `adopt()` writes the seed in its own runtime — those four skills were
written as `.sh` / `.js` / `.spec.json` and then invoked as `.py`.
Unreachable. The runner now dispatches per runtime, and falls back to the
Python implementation only when the runtime-specific file is absent,
switching the executor along with it.

`dna_library/*.py` are *outputs* of `adopt()`; the source of truth is
`server/metamorfus-core/seed-sources.ts`. Thirty of the seeds had drifted
away from the files that actually ship, so a fresh workspace started the
organism with weaker skills than the repository ships — and neither file
showed it. The Python seed payloads are now regenerated from the `.py`
files on disk, and a fresh workspace materialises all 30 byte-identical to
what the repo ships.

---

## Layout

```
packages/metamorfus-src/
  server/
    skills/         invoker.py, runner.mjs — real Python execution
    cognitive/      25 modules: forge, capability-forge, complementarity, statistics, ...
    llm-library/    router, providers, store, model-registry
    identity/       constitution, archaeology, persistence
    __tests__/
  dna_library/      54 skills + manifest.json
packages/opencode-src/   vendored OpenCode
```

`server/cognitive/` is where the interesting parts live:
`auto-forge.mjs` (gap → LLM → validate → keep or discard),
`complementarity.mjs` (correlation between skills),
`statistical-eval.mjs` (k-fold, t-distribution CI, honest ROC),
`directional-forge.mjs` (feed real baseline failures back into the prompt).

---

## Repository size, honestly

| | |
|---|---|
| versioned content | 108.7 MB |
| `.git` history | 88 MB |
| working tree with `node_modules` | 276 MB |

The vendored OpenCode is 125 MB, and 74.6 MB of that is binary assets —
landing-page videos, desktop icons, fonts, screenshots. Removing them
would break the console build (it imports the videos) and the desktop
build (it references the icons), so they stay; they are excluded from the
container image, which is where the weight actually mattered. What could
go did go: upstream's experiment output directory (7.9 MB, referenced by
nothing) and three oversized upstream test fixtures (11.6 MB).

The clone is still larger than the source needs, because the Git history
holds blobs the working tree no longer has. Shrinking it further means
rewriting history, which changes every commit SHA — that is a decision,
not a cleanup, and it was not made silently.

## License

Metamorfus ODC: see repository. Vendored OpenCode retains its own
license under `packages/opencode-src/`.