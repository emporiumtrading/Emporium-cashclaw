# CashClaw Repository Review

## Overview

**CashClaw** is an autonomous work agent (~6,000 lines of TypeScript) that connects to the Moltlaunch marketplace. It evaluates tasks, quotes prices, executes work using LLMs, submits deliverables, and self-improves over time. It features a React dashboard (Vite + Tailwind), multi-provider LLM support (Anthropic/OpenAI/OpenRouter), and a BM25-based memory system.

**Stack**: TypeScript 5.7, Node.js 20+, React 19, Vite 6, Vitest, only 3 production deps (minisearch, viem, ws).

---

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Architecture** | 8/10 | Clean modular design, good separation of concerns |
| **Type Safety** | 9/10 | Strict mode, minimal type escaping (3 instances) |
| **Dependencies** | 9/10 | Minimal footprint, zero LLM SDK deps |
| **Error Handling** | 7/10 | Good coverage, some silent failures |
| **Security** | 7/10 | API keys protected, CORS locked, no rate limiting |
| **Code Quality** | 7/10 | Some duplication, magic numbers, missing linting |
| **Testing** | 3/10 | Only agent loop tested, <10% coverage |
| **Documentation** | 6/10 | Good README, no architecture docs |

**Overall: 7/10** — Production-ready with gaps in testing and monitoring.

---

## Architecture

### Directory Structure

```
src/
├── index.ts              # Entry point (CLI bin: cashclaw)
├── agent.ts              # HTTP server, dual-mode handler (setup + API)
├── config.ts             # Config management (load/save/defaults)
├── heartbeat.ts          # Polling, WebSocket, study scheduling
├── moltlaunch/           # Marketplace integration (CLI wrapper + types)
├── loop/                 # Core agent execution engine
│   ├── index.ts          # Multi-turn LLM agent loop
│   ├── prompt.ts         # System prompt builder
│   ├── context.ts        # Task context formatter
│   └── study.ts          # Self-study session generator
├── tools/                # Tool definitions and execution (13 tools)
│   ├── registry.ts       # Tool registration + conditional AgentCash
│   ├── marketplace.ts    # 7 marketplace tools
│   ├── utility.ts        # 4 utility tools
│   └── agentcash.ts      # 2 AgentCash tools
├── memory/               # Persistent state and knowledge base
│   ├── search.ts         # BM25+ search with temporal decay
│   ├── knowledge.ts      # Knowledge CRUD (max 50 entries)
│   ├── feedback.ts       # Client ratings (max 100 entries)
│   ├── chat.ts           # Operator chat history
│   └── log.ts            # Daily activity logs
├── llm/                  # Provider abstraction (Anthropic, OpenAI, OpenRouter)
└── ui/                   # React dashboard (Vite + Tailwind)
    ├── pages/            # Dashboard, Tasks, Chat, Settings, Setup wizard
    └── lib/              # API client, ETH price helper
```

### Data Flow

1. **Inbound**: WebSocket + REST polling from Moltlaunch API -> Heartbeat processes tasks
2. **Processing**: LLM agent loop with multi-turn tool use -> Executes marketplace/utility/AgentCash tools
3. **Outbound**: Tool results -> mltl CLI or HTTP APIs (Anthropic, OpenAI, AgentCash)
4. **Storage**: Task metadata, feedback, knowledge, logs persisted to `~/.cashclaw/`
5. **Frontend**: React dashboard consumes `/api/*` endpoints for real-time status + config

### Key Design Decisions

- No database: all state in JSON files on disk with atomic writes
- No web framework: raw Node.js HTTP for minimal dependencies
- No SDK dependencies: raw fetch() for LLM providers, CLI wrappers for marketplace
- Temporal decay in search: recent knowledge weighted higher
- Concurrent task limit prevents resource exhaustion
- Tool allowlist for AgentCash prevents SSRF
- Deduplication in heartbeat handles WS + polling race conditions

---

## Key Strengths

1. **Minimal dependencies** — Only 3 production deps; LLM providers use raw `fetch()`
2. **Atomic file writes** — Temp file + rename prevents corruption on crash
3. **Security fundamentals** — `execFile()` (not `exec()`), config files mode 0o600, URL allowlist, path traversal guards
4. **Self-learning loop** — BM25 search with temporal decay, study sessions every 30min
5. **Clean tool architecture** — 13 tools in a registry pattern, conditionally loaded
6. **Type safety** — Strict TypeScript, only 3 instances of type escaping in entire codebase

---

## Issues Found

### Critical

#### 1. Testing coverage is very low (~10%)
- Only `test/loop.test.ts` exists (7 test cases for agent loop)
- HTTP API, config, memory, heartbeat, WebSocket, LLM providers — all untested
- **Recommendation**: Add integration tests for API endpoints and unit tests for memory/config

#### 2. No rate limiting on HTTP endpoints
- Chat, config update, knowledge deletion endpoints could be abused
- **Recommendation**: Add rate limiter middleware

#### 3. No ESLint or Prettier configured
- No code style enforcement across the project
- **Recommendation**: Add `@typescript-eslint` + Prettier

#### 4. Silent failures in async operations
- Search index invalidation errors are caught and logged but not surfaced (`knowledge.ts:48-50`)
- WebSocket malformed messages silently dropped (`heartbeat.ts:115-117`)

### Moderate

#### 5. Code duplication
- Message text extraction (`filter -> map -> join`) repeated 3 times across `llm/index.ts`, `loop/index.ts`, and `agent.ts`
- Tool result extraction duplicated between `llm/index.ts` and `agent.ts`
- Method validation pattern (`if (req.method !== "POST")`) repeated 6+ times
- **Fix**: Extract utility functions

#### 6. Magic numbers scattered
- `MAX_BODY_BYTES = 1048576`, reconnect delays, expiry times, decay half-life
- **Fix**: Consolidate in constants file

#### 7. `agent.ts` is oversized (740 lines)
- Mixes HTTP routing, setup logic, config validation, and static file serving
- **Fix**: Extract handler groups into separate files

#### 8. No retry logic for transient failures
- fetch() calls to external APIs (ETH price, agent lookup) fail immediately
- **Fix**: Add retry with exponential backoff for transient network errors

#### 9. Hardcoded API endpoints
- `api.anthropic.com`, `api.moltlaunch.com`, `wss://api.moltlaunch.com/ws` not configurable
- **Fix**: Make endpoints configurable via environment variables

#### 10. No structured logging
- Only ~5 console.log statements; no timestamps or log levels
- Activity logging system exists but is underutilized in core modules

### Minor

#### 11. Mutable global state in heartbeat
- Processing tasks tracked via closures over mutable Sets
- Makes testing difficult; should encapsulate in state manager

#### 12. Config hot-swap race condition
- LLM provider can be swapped mid-operation (`agent.ts:486-506`)
- Concurrent requests could see inconsistent state during swap

#### 13. No input size limits on some fields
- Send message content and knowledge entries have no length limits
- Could cause memory issues on long-running agents

---

## Security Assessment

### Good Practices
- `execFile()` used (not `exec()`) — prevents command injection
- Arguments passed as arrays, not string concatenation
- Config file permissions: 0o600 (owner read/write only)
- API keys masked as `"***"` in API responses
- CORS locked to `localhost:3777` (same-origin only)
- Path traversal guard on static file serving (`agent.ts:711`)
- URL allowlist for AgentCash (9 domains) prevents SSRF
- Custom instructions capped at 2000 chars (limits prompt injection)
- Private keys never stored locally; managed by mltl CLI

### Concerns
- No CSRF token validation (mitigated by CORS, but defense-in-depth)
- No rate limiting on any endpoint
- No request body logging guard (API keys could leak if middleware added)
- Image uploads have no mime-type restrictions
- Temp file cleanup could fail silently (images remain in /tmp)

---

## API Endpoints Summary

### Setup Mode
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/setup/wallet` | Show wallet info |
| POST | `/api/setup/wallet/import` | Import private key |
| GET | `/api/setup/agent-lookup` | Lookup agent by wallet |
| POST | `/api/setup/register` | Register agent onchain |
| POST | `/api/setup/llm` | Save LLM config |
| POST | `/api/setup/llm/test` | Test LLM connection |
| POST | `/api/setup/specialization` | Save pricing + skills |
| POST | `/api/setup/complete` | Finalize setup |
| POST | `/api/setup/reset` | Reset to setup mode |

### Running Mode
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/status` | Heartbeat state |
| GET | `/api/tasks` | Active tasks + events |
| GET | `/api/config` | Config (key masked) |
| POST | `/api/config-update` | Hot-reload config |
| GET | `/api/knowledge` | Knowledge entries |
| GET | `/api/feedback` | Feedback entries |
| GET | `/api/stats` | Aggregate statistics |
| GET/POST | `/api/chat` | Operator chat |
| POST | `/api/start` / `/api/stop` | Control heartbeat |
| GET | `/api/wallet` | Cached wallet balance |
| GET | `/api/eth-price` | ETH/USD price |

---

## Recommendations (Priority Order)

| Priority | Action | Effort |
|----------|--------|--------|
| **HIGH** | Add test coverage for HTTP API, config, and memory modules | Large |
| **HIGH** | Add rate limiting middleware | Small |
| **HIGH** | Configure ESLint + Prettier | Small |
| **MEDIUM** | Extract repeated patterns (text extraction, error responses) | Small |
| **MEDIUM** | Add structured logging with levels and timestamps | Medium |
| **MEDIUM** | Extract `agent.ts` handlers into separate files | Medium |
| **MEDIUM** | Add retry logic for transient network failures | Small |
| **LOW** | Create constants file for magic numbers | Small |
| **LOW** | Make API endpoints configurable via environment | Small |
| **LOW** | Add architecture documentation | Small |
