# Metamorfus ODC

A cognitive organism. Python skills executed for real, an LLM that can
write new ones, and a test battery that measures whether any of it works
instead of asserting that it does.

OpenCode (`anomalyco/opencode`) is vendored in `packages/opencode-src/`
and reachable over HTTP. Metamorfus talks to it through
`server/odc-opencode-bridge.ts` and degrades to NVIDIA direct when it is
not running.

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
# offline — no key needed
npx tsx --test \
  server/__tests__/cognitive.test.mjs \
  server/__tests__/archaeology.test.mjs \
  server/__tests__/identity.test.mjs \
  server/__tests__/constitution-memory.test.mjs \
  server/__tests__/llm-library.test.mjs \
  server/__tests__/tool-registry.test.ts

# live battery — needs a key, ~10-20 min
bash .run-battery.sh
```

CI runs the offline suite on every push and the battery on `main`.

---

## The part that matters: skills really run

There was a bug where the runner spawned `python3 dna_library/SKILL.py`.
Python defined `def skill()`, exited 0, printed nothing, and the runner
parsed an empty string as success. Every test in T1–T11 passed for the
wrong reason.

`server/skills/runner.mjs` now spawns `server/skills/invoker.py`, which
imports the module, calls `skill(organism, context)`, and prints the
result as JSON. A skill that raises returns `ok: false` with the
traceback rather than exiting quietly.

Contexts over 64 KB go through a temp file instead of an env var. Passing
1000 transactions as `METAMORFUS_CONTEXT` hit the kernel's `ARG_MAX` and
the spawn died with `E2BIG` — which is why diagnosis once reported
`caught=0` while k-fold CV reported `F1=0.967` on the same data.

---

## Battery results

Real numbers from real runs. Where a result was not significant, it says
so.

| Test | What it measures | Result |
|---|---|---|
| T1 | Identity preservation | IPS 93.33, transferability 33.33 |
| T4 | Precision under load | 0.9999, RSI matches Wilder's reference |
| T6 | Self-modification | LLM wrote 1000 bytes of Python, compiles and runs |
| T12 | Does cross-domain help? | MAE 1.638 → 0.578 (61.5%) |
| T13 | Auto-forged skill on held-out data | F1 0.571 → 1.000 |
| T14 | Significance | baseline 0.350 [0.052, 0.649] vs forged 0.431 [0.338, 0.523] — **not significant** |
| T15 | PaySim-like data, k=10 | F1 0.967 [0.891, 1.000] |
| T16 | Directional forge | baseline already 1.000, forge had nothing to add |

T14 is the honest one. The forged skill scored higher, but the confidence
intervals overlap, so it is reported as not significant rather than as a
win.

---

## Models

`moonshotai/kimi-k3` was hardcoded everywhere and reached end of life on
2026-10-15. Every forge path was returning `410 Gone`.

`server/llm-library/model-registry.mjs` lists what was verified live by
probing real completions, and — importantly — by compiling and executing
the Python each one produces. Listing in `/v1/models` is not
availability; `moonshotai/kimi-k2.6` is still catalogued and still dead.

| Model | Status |
|---|---|
| `nvidia/nemotron-3-super-120b-a12b` | primary — generates Python that runs |
| `nvidia/nemotron-3-ultra-550b-a55b` | fallback |
| `nvidia/nemotron-3.5-lightning-30b-a3b` | fallback |
| `moonshotai/kimi-k3` | 410 Gone |
| `moonshotai/kimi-k2.6` | 404, ghost catalog entry |

NVIDIA is registered under all three categories. The router filters by
category before trying anything, so a key registered only as
`multimodal` leaves the forge with nothing to call.

---

## Layout

```
packages/metamorfus-src/
  server/
    skills/         invoker.py, runner.mjs — real Python execution
    cognitive/      23 modules: forge, complementarity, statistics, ...
    llm-library/    router, providers, store, model-registry
    identity/       constitution, archaeology, persistence
    __tests__/
  dna_library/      40 skills + manifest.json
packages/opencode-src/   vendored OpenCode
```

`server/cognitive/` is where the interesting parts live:
`auto-forge.mjs` (gap → LLM → validate → keep or discard),
`complementarity.mjs` (correlation between skills),
`statistical-eval.mjs` (k-fold, t-distribution CI, honest ROC),
`directional-forge.mjs` (feed real baseline failures back into the prompt).

---

## License

Metamorfus ODC: see repository. Vendored OpenCode retains its own
license under `packages/opencode-src/`.