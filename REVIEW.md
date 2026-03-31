# CashClaw Repository Review

**Date:** 2026-03-31
**Methodology:** Multi-agent parallel review (structure, code quality, testing/CI, security)

---

## Executive Summary

CashClaw is a well-architected autonomous work agent built with TypeScript/React for the Moltlaunch marketplace. The codebase demonstrates strong separation of concerns, good security fundamentals, and clean module design. However, it has significant gaps in testing coverage, CI/CD infrastructure, and developer tooling that should be addressed before production deployment.

**Overall Grade: B-** — Strong architecture, needs hardening in testing and DevOps.

---

## 1. Architecture & Structure

### Strengths
- **Clean module separation**: Memory, tools, LLM providers, agent loop, and UI are well-isolated
- **Registry pattern** for tools with conditional AgentCash inclusion
- **Multi-provider LLM abstraction** (Anthropic, OpenAI, OpenRouter) via raw fetch — no SDK lock-in
- **BM25+ search with temporal decay** for knowledge retrieval
- **Atomic file operations** using write-then-rename pattern across persistence layer
- **Dual-mode HTTP server**: setup wizard for unconfigured state, dashboard API for running state

### Structure Overview
```
src/
├── agent.ts          # HTTP server (600+ lines — largest module)
├── config.ts         # Config management with secure file permissions
├── heartbeat.ts      # Polling, WebSocket, study scheduler
├── index.ts          # Entry point
├── llm/              # Multi-provider LLM abstraction
├── loop/             # Agent loop, prompts, context, study sessions
├── tools/            # 13 tools (marketplace, utility, AgentCash)
├── memory/           # BM25+ search, knowledge, feedback, chat, logs
├── moltlaunch/       # CLI wrapper for marketplace interaction
└── ui/               # React 19 + Vite + Tailwind dashboard
```

---

## 2. Code Quality Findings

### Critical Bug

| Issue | File | Line | Severity |
|-------|------|------|----------|
| `crypto` module used but never imported | `src/loop/study.ts` | 113 | **HIGH** |

`crypto.randomUUID()` is called in `generateId()` but `crypto` is not imported. This will crash at runtime when study sessions generate IDs. **Fix:** Add `import crypto from "node:crypto"` at the top.

### Medium Issues

| Issue | File | Lines | Details |
|-------|------|-------|---------|
| Loose type assertions | `src/tools/agentcash.ts` | 71, 84-85 | `input.url as string` without validation |
| Loose type assertions | `src/tools/utility.ts` | 38, 80 | `input.limit as number` — string "5" would be falsy |
| No timeout on chat LLM request | `src/agent.ts` | 597-673 | Hangs indefinitely if LLM API is unresponsive |
| Cache invalidation by reference equality | `src/tools/registry.ts` | 40-52 | Fails silently if config is spread/copied |
| Unhandled promise in index invalidation | `src/memory/knowledge.ts` | 48-50 | Fire-and-forget async with only console.error |
| Code duplication | `src/memory/` | chat, knowledge, feedback | Identical atomic-write pattern repeated 3+ times |

### Positive Patterns
- Defensive stringification of CLI responses in `moltlaunch/cli.ts`
- Memory resource caps: events (200), chat (100), knowledge (50), feedback (100)
- Tool execution timeouts (15s-120s depending on operation)
- `customInstructions` capped at 2000 chars to prevent prompt bloat

---

## 3. Security Review

### Security Grade: C+ (acceptable for local dev, needs hardening for production)

### Strengths
- **File permissions**: Config at `0o600`, directory at `0o700`
- **API key masking**: Returns `"***"` in API responses
- **CORS**: Locked to `localhost:3777` — proper same-origin restriction
- **Request body limit**: 1MB max (`MAX_BODY_BYTES`)
- **Path traversal protection**: Validates resolved path under UI directory (`agent.ts:707-715`)
- **SSRF protection**: AgentCash domain whitelist (9 allowed domains)
- **XSS protection**: React JSX auto-escaping, no `dangerouslySetInnerHTML`
- **Shell injection prevention**: Uses `execFile()` instead of `exec()`
- **Atomic file writes**: UUID-based temp files prevent corruption

### Vulnerabilities

| Issue | Severity | File | Details |
|-------|----------|------|---------|
| No authentication on API endpoints | **MEDIUM** | `agent.ts:62-88` | All endpoints publicly accessible on local network |
| No rate limiting | **MEDIUM** | `agent.ts` | `/api/stop`, `/api/chat`, `/api/config-update` can be abused |
| Private key via plaintext POST | **MEDIUM** | `agent.ts:284-289` | Wallet import accepts private key in request body |
| npm dependency vulnerabilities | **HIGH** | `package.json` | picomatch ReDoS (CVSS 7.5), esbuild CORS issue |
| No security headers | **LOW** | `agent.ts` | Missing CSP, X-Frame-Options, X-Content-Type-Options |
| Hardcoded AgentCash domain list | **LOW** | `tools/agentcash.ts:10-20` | Requires code change to add new domains |

### Input Validation (Positive)
- ETH pricing: regex `/^\d+(\.\d{1,18})?$/` with baseRate/maxRate comparison
- `maxConcurrentTasks`: integer 1-20
- `studyIntervalMs`: 60000-86400000
- Image upload: 5MB limit, JPEG/PNG only via regex
- Base64 data URL validation

---

## 4. Testing & CI/CD Review

### Testing
- **Framework**: Vitest v2.1.0 — all 7 tests pass (~400ms)
- **Coverage**: **~4%** — only `test/loop.test.ts` (233 lines) exists
- **Tested**: Agent loop execution, tool calls, token usage, max turns, decline/submit flows
- **NOT tested**: `agent.ts`, `heartbeat.ts`, `tools/`, `llm/`, `memory/`, `moltlaunch/`, `ui/`
- **No integration or E2E tests**

### CI/CD
- **No CI/CD pipeline configured** — no GitHub Actions, no workflows
- **No automated testing on PRs**

### Developer Tooling
- **No ESLint** — no linting rules enforced
- **No Prettier** — no formatting rules enforced
- **No pre-commit hooks** — no Husky/lint-staged
- **No Docker** — no containerization support

### Build System (Working)
- `tsup` for CLI bundle (Node 20, ESM, ~75KB)
- `vite` for UI bundle (React, Tailwind, ~265KB JS)
- `tsc --noEmit` for type checking (strict mode, passes clean)

---

## 5. Dependency Analysis

| Package | Version | Status |
|---------|---------|--------|
| `viem` | 2.47.0 | Current, secure |
| `ws` | 8.19.0 | Current, secure |
| `minisearch` | 7.2.0 | Current, secure |
| `typescript` | 5.9.3 | Current |
| `vite` | 6.4.1 | Current |
| `vitest` | 2.1.9 | Has transitive vulnerability |
| `picomatch` | 4.0.x (transitive) | **ReDoS vulnerability (CVSS 7.5)** |
| `esbuild` | ≤0.24.2 (transitive) | **CORS misconfiguration (CVSS 5.3)** |

---

## 6. Recommendations

### Priority 1 — Immediate Fixes
1. **Fix `crypto` import bug** in `src/loop/study.ts` — runtime crash
2. **Add timeout to chat LLM request** in `src/agent.ts:handleChat`
3. **Run `npm audit fix`** to address dependency vulnerabilities

### Priority 2 — Short Term
4. **Add ESLint + Prettier** with scripts in `package.json`
5. **Expand test coverage** to at least memory, tools, config, and LLM modules
6. **Add GitHub Actions CI** — run `typecheck`, `test`, `build` on PRs
7. **Add authentication** for sensitive API endpoints (token-based)
8. **Add rate limiting** on mutation endpoints

### Priority 3 — Medium Term
9. **Add security headers** (CSP, X-Frame-Options, X-Content-Type-Options)
10. **Add pre-commit hooks** (Husky + lint-staged)
11. **Extract shared atomic-write utility** from memory modules
12. **Add integration tests** for heartbeat/WebSocket flows
13. **Validate tool inputs** with runtime schema validation instead of type assertions
14. **Add Docker support** for deployment

### Priority 4 — Ongoing
15. Regular `npm audit` checks
16. Monitor CVE databases for viem, ws, minisearch
17. Expand E2E test coverage as features grow
