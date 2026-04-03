import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface LLMConfig {
  provider: "anthropic" | "openai" | "openrouter";
  model: string;
  apiKey: string;
}

export interface PricingConfig {
  strategy: "fixed" | "complexity";
  baseRateEth: string;
  maxRateEth: string;
}

export interface PollingConfig {
  intervalMs: number;
  urgentIntervalMs: number;
}

export interface PersonalityConfig {
  tone: "professional" | "casual" | "friendly" | "technical";
  responseStyle: "concise" | "detailed" | "balanced";
  customInstructions?: string;
}

export interface MarketplacesConfig {
  near?: {
    apiKey: string;
    agentId?: string;
    baseUrl?: string;
  };
  fetchai?: {
    apiKey: string;
    agentAddress?: string;
    baseUrl?: string;
  };
  autonolas?: {
    privateKey?: string;
    mechAddress?: string;
    rpcUrl?: string;
  };
  singularitynet?: {
    daemonRunning?: boolean;
    orgId?: string;
    serviceId?: string;
  };
  freelancer?: {
    accessToken: string;
    userId?: string;
    searchKeywords?: string[];
    maxBidUsd?: number;
  };
}

export interface MelistaConfig {
  agentId: string;
  llm: LLMConfig;
  polling: PollingConfig;
  pricing: PricingConfig;
  specialties: string[];
  autoQuote: boolean;
  autoWork: boolean;
  maxConcurrentTasks: number;
  maxLoopTurns?: number;
  declineKeywords: string[];
  personality?: PersonalityConfig;
  learningEnabled: boolean;
  studyIntervalMs: number;
  agentCashEnabled: boolean;
  marketplaces?: MarketplacesConfig;
  revenueGoals?: RevenueGoals;
  auth?: AuthConfig;
}

export interface AuthConfig {
  /** Bcrypt-hashed password for dashboard login */
  passwordHash: string;
  /** Session token secret */
  sessionSecret: string;
}

export interface RevenueGoals {
  /** Monthly revenue target in USD */
  monthlyTargetUsd: number;
  /** Monthly stretch goal in USD */
  monthlyStretchUsd: number;
  /** Operating cost estimate per month in USD */
  monthlyOperatingCostUsd: number;
}

// Use persistent /data volume on Fly.io, local ~/.melista otherwise
const CONFIG_DIR = process.env.FLY_APP_NAME
  ? "/data/melista"
  : path.join(os.homedir(), ".melista");
const CONFIG_PATH = path.join(CONFIG_DIR, "melista.json");
// Fallback: read from old .cashclaw path if .melista doesn't exist yet
const LEGACY_CONFIG_PATH = path.join(os.homedir(), ".cashclaw", "cashclaw.json");
// Also check the Fly /data path for moltlaunch wallet
const FLY_MOLTLAUNCH_DIR = "/data/moltlaunch";

const DEFAULT_CONFIG: Omit<MelistaConfig, "agentId" | "llm"> = {
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
  specialties: [],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 1,
  declineKeywords: [],
  learningEnabled: true,
  studyIntervalMs: 1_800_000, // 30 minutes
  agentCashEnabled: false,
};

export function loadConfig(): MelistaConfig | null {
  let configPath = CONFIG_PATH;
  if (!fs.existsSync(configPath)) {
    // Try legacy path
    if (fs.existsSync(LEGACY_CONFIG_PATH)) {
      configPath = LEGACY_CONFIG_PATH;
    } else {
      return null;
    }
  }
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as MelistaConfig;
    if (!parsed || typeof parsed !== "object") return null;
    // Migrate to new path if reading from legacy
    if (configPath === LEGACY_CONFIG_PATH) {
      saveConfig(parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function requireConfig(): MelistaConfig {
  const config = loadConfig();
  if (!config) {
    throw new Error(
      "No config found. Complete setup at the dashboard first.",
    );
  }
  return config;
}

export function saveConfig(config: MelistaConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  fs.chmodSync(CONFIG_PATH, 0o600);
}

/** Check if config has all required fields for running the agent */
export function isConfigured(): boolean {
  const config = loadConfig();
  if (!config) return false;
  return Boolean(config.agentId && config.llm?.apiKey && config.llm?.provider);
}

/** Save partial config fields, merging with existing config or defaults */
export function savePartialConfig(partial: Partial<MelistaConfig>): MelistaConfig {
  const existing = loadConfig();
  const config = {
    ...DEFAULT_CONFIG,
    agentId: "",
    llm: { provider: "anthropic" as const, model: "", apiKey: "" },
    ...existing,
    ...partial,
  };
  saveConfig(config);
  return config;
}

export function initConfig(opts: {
  agentId: string;
  provider: LLMConfig["provider"];
  model?: string;
  apiKey: string;
  specialties?: string[];
}): MelistaConfig {
  const modelDefaults: Record<LLMConfig["provider"], string> = {
    anthropic: "claude-sonnet-4-20250514",
    openai: "gpt-4o",
    openrouter: "anthropic/claude-sonnet-4-20250514",
  };

  const config: MelistaConfig = {
    ...DEFAULT_CONFIG,
    agentId: opts.agentId,
    llm: {
      provider: opts.provider,
      model: opts.model ?? modelDefaults[opts.provider],
      apiKey: opts.apiKey,
    },
    specialties: opts.specialties ?? [],
  };

  saveConfig(config);
  return config;
}

export function getConfigDir(): string {
  return CONFIG_DIR;
}

/** Check if AgentCash CLI wallet exists on disk */
export function isAgentCashAvailable(): boolean {
  const walletPath = path.join(os.homedir(), ".agentcash", "wallet.json");
  return fs.existsSync(walletPath);
}
