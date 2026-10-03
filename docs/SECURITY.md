# Security & Threat Model

**Status:** Round 3 (post domain-agnostic refactor)
**Last reviewed:** 2026-09-29

## Scope

This document covers the security surface of the **Metamorfus ODC** organism — the headless server, swarm nodes, MHU engine, and DNA library persistence. The dashboard UI (React) is treated as a trusted client; risks there are not analyzed here.

The organism is designed to be a **defensive security framework** in its primary use case, but the same architecture powers arbitrary domains (biology, design, trading, etc.). The threat model applies to all deployments, regardless of the active profession.

## Trust Boundaries

```
┌──────────────────────────────────────────────────────────────┐
│  EXTERNAL: Untrusted                                         │
│  - Operator input (chat messages, system prompts)          │
│  - LLM responses (NVIDIA NIM, OpenAI, Anthropic, etc.)     │
│  - Tenant API keys from env / config file                  │
│  - Skills downloaded from `pip install` / `git clone`      │
└────────────────────┬─────────────────────────────────────────┘
                     │ Tenant auth + scope check
┌────────────────────▼─────────────────────────────────────────┐
│  HEADLESS SERVER (Express + Socket.IO)                      │
│  - Multi-tenant auth (tenant-auth.mjs)                     │
│  - Per-tenant DNA library directory                         │
│  - LLM library (provider keys, model config)                │
│  - Orchestrator: executes forge_skill, pip_install, etc.   │
└────────────────────┬─────────────────────────────────────────┘
                     │ spawn() with timeout
┌────────────────────▼─────────────────────────────────────────┐
│  SWARM (subprocess Python / Node / Bash)                     │
│  - Each node runs in a separate OS process                  │
│  - Per-node timeout (default 30s)                          │
│  - Per-node env filtering (PATH only by default)            │
└──────────────────────────────────────────────────────────────┘
```

## Threats (STRIDE)

### S — Spoofing

| Threat | Mitigation | Residual risk |
|---|---|---|
| Attacker steals tenant API key | Keys stored in env or `tenants.json`; never logged; `listPublic` masks keys in API responses | Operator must rotate on suspicion; no automatic rotation |
| Operator impersonation via bearer token | Tokens are shared secrets; HTTP `Authorization: Bearer` only; no JWT/session | Token leak = full tenant access until rotation |
| LLM API key leak in LLM library responses | `apiKey` field is masked in `publicView()` (4 + … + 4 chars) | Server-side, so trusted operator still has full key |
| Skill provenance forgery | `forge_skill` writes to local disk; no remote fetch by default | If `pip_install` / `git_clone` is used, remote is trusted |

### T — Tampering

| Threat | Mitigation | Residual risk |
|---|---|---|
| Tenant modifies another tenant's DNA library | Each tenant has its own `dnaDir`; auth middleware enforces `req.tenant.id` | Path traversal in tenant id (validated by normalization) |
| LLM response injects malicious skill source | `forge_skill` validates Python source: requires `def skill(organism, context)` and `action:` field | Bypass via JavaScript / shell / wasm runtimes (added round 3) |
| Manifest JSON corrupted on disk | Atomic write via `tmpPath` + `rename`; `loadManifest` falls back to empty on parse error | Manifest data loss, not code execution |
| Swarm node injects malicious output | Each node runs in separate process; timeout enforced; no shared mutable state | Output is trusted — caller must validate response shape |

### R — Repudiation

| Threat | Mitigation | Residual risk |
|---|---|---|
| Operator denies a destructive action | Every state change persists with `metamorphosis_log` (chronological); each entry has timestamp, from/to professions, forged/retained skills | Log itself isn't signed — operator with disk access can edit it |
| Forged skill origin attribution | `foraged_by` field in `SkillManifest` records who created it | If `foraged_by` is not enforced, can be spoofed by direct manipulation |

### I — Information disclosure

| Threat | Mitigation | Residual risk |
|---|---|---|
| LLM API key leaked in logs | `maskKey()` in `publicView()` returns first 4 + ellipsis + last 4; logging should use the public view | Direct `console.log(config)` would leak; use `listPublic()` for logs |
| Tenant data cross-contamination | Per-tenant `dnaDir`; queries always include `req.tenant` | Bug in middleware could leak — covered by `tenant-auth.test.mjs` |
| Skill source in DNA library readable by anyone with disk access | Library stored in plain JSON; no encryption at rest | Disk-level access = full read; documented expectation |
| LLM prompt leaks skill source to provider | The system prompt + history is sent to NVIDIA/OpenAI/etc | Acceptable risk for LLM use; document to operator |

### D — Denial of Service

| Threat | Mitigation | Residual risk |
|---|---|---|
| Tenant exhausts disk via massive DNA library | `HiveMemory` capped at 1000 items (FIFO eviction) | DNA library append-only — no cap, can grow unboundedly |
| Slow LLM provider holds tenant hostage | `LlmRouter` tracks per-provider `cooldownUntil`; skips rate-limited configs | If all providers cooldown, chat stalls indefinitely |
| Swarm DOS via spawn storm | Swarm node spawn cost (~30-80ms each); not currently rate-limited | A malicious tenant could spawn 1000s of nodes |
| `forge_skill` infinite loop in `def skill(organism, context)` | Python subprocess has `EXEC_TIMEOUT_MS` (default 30s) | A skill running on a different runtime (JS, shell) has no timeout — gap |

### E — Elevation of Privilege

| Threat | Mitigation | Residual risk |
|---|---|---|
| Tenant escapes `dnaDir` via path traversal in `skillKey` | `skillKey` validated to end with `_protocol` | Skill bodies themselves can use `..` paths — not validated |
| Skill runs arbitrary Python via `def skill()` | Python has no sandbox beyond subprocess timeout | **Critical** — see Open Items |
| Skill runs arbitrary bash via `shell` runtime | Subprocess has timeout; env filtered to PATH only | Bypass via setting `PATH=/tmp/evil:$PATH` — not blocked |
| LLM prompt injection escalates tenant | System prompt constrains LLM; router validates JSON output | Bypass via long prompts that overflow context |

## Runtime Capability Matrix

| Runtime | Sandboxing | File access | Network | Risk |
|---|---|---|---|---|
| `python` | Subprocess timeout | Same as swarm node | Same as swarm node | High (PyPI ecosystem) |
| `javascript` | Subprocess timeout | Same as swarm node | Same as swarm node | Medium (Node ecosystem) |
| `shell` | Subprocess timeout | Same as swarm node | Same as swarm node | **Critical** (executes bash) |
| `wasm` | Not implemented | n/a | n/a | n/a |
| `spec` | None (data only) | n/a | n/a | None |

## Open Items (gaps to fix)

1. **Shell runtime has no command allowlist** — any bash runs. Mitigation: add an `ALLOWED_SHELL_COMMANDS` config that rejects patterns like `rm -rf /`, `curl | sh`, `chmod 777 /`. (Tracked: TODO)
2. **Python skills run with no syscall filtering** — recommend `seccomp` profile on Linux. (Tracked: TODO)
3. **WASM runtime is a placeholder** — returns error. To make it real, embed `wasmer-js` or `@bytecodealliance/wasmtime-js`. (Tracked: TODO in `swarm-node.mjs`)
4. **No rate limiting on the API** — add `express-rate-limit` per tenant. (Tracked: TODO)
5. **No API authentication between dashboard and headless server** — currently relies on `TENANTS_JSON` shared secret. (Tracked: TODO)
6. **DNA-git-sync has no signing** — anyone with write access to the remote can push a malicious manifest. Add SSH key per tenant + signed commits. (Tracked: TODO)
7. **LLM response is trusted by the orchestrator** — `forge_skill` validates Python syntax but not semantics. A malicious LLM could return code that reads env vars and exfiltrates. Mitigation: never pass secrets to the swarm, run in isolated user, no outbound network. (Tracked: TODO)
8. **`pip install` runs as root** — supply chain attack via typosquatting. Mitigation: pin versions, use a venv per tenant. (Tracked: TODO)
9. **No audit log of who ran what** — `metamorphosis_log` captures organism actions but not "which tenant triggered this". Add tenant attribution. (Tracked: TODO)
10. **Test suite has no security tests** — no fuzzing, no malicious payload testing. (Tracked: TODO)

## Safe Deployment Checklist

- [ ] Generate fresh tenant keys (do not use `dev-secret-local`)
- [ ] Run the headless server behind a reverse proxy (nginx/caddy) with TLS
- [ ] Set `TENANTS_JSON` or `tenants.json` with at least 32-char random keys
- [ ] Set `DNA_GIT_AUTHOR_NAME` / `DNA_GIT_AUTHOR_EMAIL` for audit
- [ ] Restrict `SWARM_DISABLE_RUNTIMES=wasm,shell` if not needed
- [ ] Restrict `EXEC_TIMEOUT_MS=30000` (or lower)
- [ ] Set `RATE_LIMIT_PER_TENANT_PER_MINUTE` (TODO: not implemented)
- [ ] Enable audit logging to external sink (Splunk, Loki)
- [ ] Run headless server as a non-root user
- [ ] Configure firewall: only the headless port exposed; swarm on localhost

## Reporting Issues

Security issues should NOT be opened as public GitHub issues. Contact the maintainer directly via the channel listed in the project README.
