/**
 * Centralized constants for CashClaw agent.
 * Eliminates magic numbers scattered across the codebase.
 */

// --- HTTP Server ---
export const PORT = 3777;
export const MAX_BODY_BYTES = 1_048_576; // 1 MB

// --- Rate Limiting ---
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 60; // per window

// --- Caching TTLs ---
export const WALLET_CACHE_TTL_MS = 60_000; // 1 minute
export const ETH_PRICE_CACHE_TTL_MS = 60_000; // 1 minute

// --- WebSocket ---
export const WS_INITIAL_RECONNECT_MS = 5_000;
export const WS_MAX_RECONNECT_MS = 300_000; // 5 minute cap
export const WS_POLL_INTERVAL_MS = 120_000; // sync check when WS connected

// --- Heartbeat ---
export const TASK_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MAX_EVENTS = 200;

// --- Memory ---
export const MAX_KNOWLEDGE_ENTRIES = 50;
export const MAX_FEEDBACK_ENTRIES = 100;
export const MAX_CHAT_MESSAGES = 100;

// --- Search ---
export const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// --- Agent Loop ---
export const DEFAULT_MAX_TURNS = 10;
export const MAX_STUDY_TURNS = 3;
export const LLM_MAX_TOKENS = 4096;

// --- CLI Timeouts ---
export const CLI_DEFAULT_TIMEOUT_MS = 30_000;
export const CLI_REGISTER_TIMEOUT_MS = 120_000;
export const AGENTCASH_FETCH_TIMEOUT_MS = 60_000;
export const AGENTCASH_BALANCE_TIMEOUT_MS = 15_000;

// --- Validation ---
export const MAX_CONCURRENT_TASKS_MIN = 1;
export const MAX_CONCURRENT_TASKS_MAX = 20;
export const MAX_CUSTOM_INSTRUCTIONS_LENGTH = 2000;
export const MIN_STUDY_INTERVAL_MS = 60_000; // 1 minute
export const MAX_STUDY_INTERVAL_MS = 86_400_000; // 24 hours

// --- API Endpoints (configurable via environment) ---
export const ANTHROPIC_API_URL =
  process.env.CASHCLAW_ANTHROPIC_URL ?? "https://api.anthropic.com/v1";
export const OPENAI_API_URL =
  process.env.CASHCLAW_OPENAI_URL ?? "https://api.openai.com/v1";
export const OPENROUTER_API_URL =
  process.env.CASHCLAW_OPENROUTER_URL ?? "https://openrouter.ai/api/v1";
export const MOLTLAUNCH_API_URL =
  process.env.CASHCLAW_MOLTLAUNCH_API_URL ?? "https://api.moltlaunch.com";
export const MOLTLAUNCH_WS_URL =
  process.env.CASHCLAW_MOLTLAUNCH_WS_URL ?? "wss://api.moltlaunch.com/ws";
export const CRYPTOCOMPARE_API_URL =
  process.env.CASHCLAW_CRYPTOCOMPARE_URL ??
  "https://min-api.cryptocompare.com/data/price";
