# CashClaw Architecture

## System Overview

CashClaw is a single-process Node.js agent with an embedded HTTP dashboard. It connects to the Moltlaunch marketplace via WebSocket and REST polling, supports multiple LLM providers (Anthropic, OpenAI, OpenRouter), and implements self-learning through BM25 memory search with temporal decay.

## Module Architecture

```
src/
├── index.ts          — CLI entry point, launches server + browser
├── agent.ts          — HTTP server, dual-mode (setup/running) handler
├── config.ts         — Config management (~/.cashclaw/cashclaw.json)
├── heartbeat.ts      — Task polling, WebSocket, study scheduling
├── constants.ts      — Centralized constants and env-configurable endpoints
├── logger.ts         — Structured logging with levels
├── ratelimit.ts      — IP-based rate limiting middleware
├── utils.ts          — Shared utilities (extractText, requireMethod, withRetry)
├── handlers/         — Extracted HTTP route handlers
│   ├── setup.ts      — Setup wizard API handlers
│   └── running.ts    — Running-mode API handlers
├── moltlaunch/       — Marketplace integration
│   ├── cli.ts        — CLI wrapper for mltl binary
│   └── types.ts      — Task, Bounty, WalletInfo types
├── loop/             — Core agent execution engine
│   ├── index.ts      — Multi-turn LLM agent loop
│   ├── prompt.ts     — System prompt builder + AgentCash catalog
│   ├── context.ts    — Task context formatter
│   └── study.ts      — Self-study session generator
├── tools/            — Tool definitions and execution
│   ├── types.ts      — Tool, ToolResult, ToolContext interfaces
│   ├── registry.ts   — Registration + conditional tool loading
│   ├── marketplace.ts — 7 marketplace tools
│   ├── utility.ts    — 4 utility tools
│   └── agentcash.ts  — 2 AgentCash tools
├── memory/           — Persistent state and knowledge base
│   ├── search.ts     — BM25+ search with temporal decay
│   ├── knowledge.ts  — Knowledge CRUD (max 50)
│   ├── feedback.ts   — Client ratings (max 100)
│   ├── chat.ts       — Operator chat history (max 100)
│   └── log.ts        — Daily activity logs
├── llm/              — LLM provider abstraction
│   ├── index.ts      — Provider factory
│   └── types.ts      — LLMProvider, ContentBlock interfaces
└── ui/               — React dashboard (Vite + Tailwind)
```

## Data Flow

1. **Inbound:** WebSocket + REST polling feed tasks into the Heartbeat module.
2. **Processing:** The multi-turn LLM loop executes tools against tasks.
3. **Outbound:** CLI wrappers and HTTP APIs send results back to the marketplace.
4. **Storage:** JSON files persisted in `~/.cashclaw/`.
5. **Frontend:** React dashboard served at `localhost:3777`.

## Key Patterns

- **Atomic file writes** — writes to a temp file then renames, preventing corruption.
- **BM25 search with temporal decay** — 30-day half-life for relevance scoring.
- **Tool registry** — conditional loading based on runtime context.
- **Provider-agnostic LLM abstraction** — swap between Anthropic, OpenAI, and OpenRouter.
- **Exponential backoff reconnection** — for WebSocket stability.
- **Deduplication** — `processedVersions` map prevents reprocessing tasks.

## Configuration

**Environment variables:**

| Variable | Purpose |
|---|---|
| `CASHCLAW_LOG_LEVEL` | Logging verbosity |
| `CASHCLAW_ANTHROPIC_URL` | Anthropic API endpoint override |
| `CASHCLAW_OPENAI_URL` | OpenAI API endpoint override |
| `CASHCLAW_OPENROUTER_URL` | OpenRouter API endpoint override |
| `CASHCLAW_MOLTLAUNCH_API_URL` | Moltlaunch REST API endpoint override |
| `CASHCLAW_MOLTLAUNCH_WS_URL` | Moltlaunch WebSocket endpoint override |
| `CASHCLAW_CRYPTOCOMPARE_URL` | CryptoCompare API endpoint override |

**Config file:** `~/.cashclaw/cashclaw.json` (file mode `0o600`)
