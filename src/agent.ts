import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfig,
  savePartialConfig,
  isConfigured,
  isAgentCashAvailable,
  type MelistaConfig,
  type LLMConfig,
} from "./config.js";
import { createLLMProvider } from "./llm/index.js";
import { createHeartbeat, type Heartbeat } from "./heartbeat.js";
import { readTodayLog, getRecentActivity } from "./memory/log.js";
import { getFeedbackStats, loadFeedback } from "./memory/feedback.js";
import { loadKnowledge, getRelevantKnowledge, deleteKnowledge } from "./memory/knowledge.js";
import { loadChat, appendChat, clearChat } from "./memory/chat.js";
import { agentcashBalance } from "./tools/agentcash.js";
import * as cli from "./moltlaunch/cli.js";
import { getDb, migrateFromJson } from "./db/index.js";
import * as dbSessions from "./db/sessions.js";
import * as dbTasks from "./db/tasks.js";
import * as dbRevenue from "./db/revenue.js";
import * as dbClients from "./db/clients.js";

const PORT = 3777;
const MAX_BODY_BYTES = 1_048_576; // 1 MB

// --- Auth ---
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashPassword(password: string, salt: string): string {
  return crypto.createHash("sha256").update(password + salt).digest("hex");
}

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function getAuthConfig(ctx: ServerContext): { passwordHash: string; sessionSecret: string } | null {
  // Check running config first, then fall back to disk
  if (ctx.config?.auth?.passwordHash) return ctx.config.auth;
  const diskConfig = loadConfig();
  if (diskConfig?.auth?.passwordHash) return diskConfig.auth;
  return null;
}

function isAuthenticated(req: http.IncomingMessage, ctx: ServerContext): boolean {
  // No auth configured = open access (backward compatible)
  const auth = getAuthConfig(ctx);
  if (!auth) return true;

  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/melista_session=([a-f0-9]+)/);
  if (!match) return false;

  const session = dbSessions.getSession(match[1]);
  if (!session || Date.now() > session.expires_at) {
    if (session) dbSessions.deleteSession(match[1]);
    return false;
  }
  return true;
}

function setSessionCookie(res: http.ServerResponse, token: string) {
  res.setHeader("Set-Cookie", `melista_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
}

type ServerMode = "setup" | "running";

interface ServerContext {
  mode: ServerMode;
  config: MelistaConfig | null;
  heartbeat: Heartbeat | null;
}

export async function startAgent(): Promise<http.Server> {
  // Initialize database and migrate any legacy JSON data
  const database = getDb();
  migrateFromJson(database);
  dbSessions.cleanExpiredSessions();

  const configured = isConfigured();
  const config = configured ? loadConfig() : null;

  // Auto-enable AgentCash if wallet exists and not explicitly configured
  if (config && config.agentCashEnabled === undefined) {
    if (isAgentCashAvailable()) {
      config.agentCashEnabled = true;
      savePartialConfig({ agentCashEnabled: true });
    }
  }

  const ctx: ServerContext = {
    mode: configured ? "running" : "setup",
    config,
    heartbeat: null,
  };

  // If already configured, start the heartbeat immediately
  if (ctx.mode === "running" && ctx.config) {
    const llm = createLLMProvider(ctx.config.llm);
    ctx.heartbeat = createHeartbeat(ctx.config, llm);
    ctx.heartbeat.start();
  }

  const server = createServer(ctx);
  return server;
}

function createServer(ctx: ServerContext): http.Server {
  const server = http.createServer((req, res) => {
    // Restrict CORS to same-origin only — prevents cross-site request forgery
    const allowedOrigin = `http://localhost:${PORT}`;
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    // Auth endpoints — always accessible
    if (url.pathname === "/api/auth/login") {
      handleLogin(req, res, ctx);
      return;
    }
    if (url.pathname === "/api/auth/logout") {
      handleLogout(req, res);
      return;
    }
    if (url.pathname === "/api/auth/status") {
      json(res, {
        authenticated: isAuthenticated(req, ctx),
        authRequired: Boolean(getAuthConfig(ctx)),
      });
      return;
    }
    if (url.pathname === "/api/auth/setup") {
      handleAuthSetup(req, res, ctx);
      return;
    }

    // Protect all other API routes
    if (url.pathname.startsWith("/api/")) {
      if (!isAuthenticated(req, ctx)) {
        json(res, { error: "Unauthorized" }, 401);
        return;
      }
      handleApi(url.pathname, req, res, ctx);
      return;
    }

    serveStatic(url.pathname, res);
  });

  server.keepAliveTimeout = 5000;
  server.headersTimeout = 10000;
  server.timeout = 15000;
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Dashboard: http://0.0.0.0:${PORT}`);
  });

  return server;
}

function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      body += chunk.toString();
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function parseJsonBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Invalid JSON");
  }
}

function handleApi(
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  // Setup endpoints — available in both modes
  if (pathname.startsWith("/api/setup/")) {
    handleSetupApi(pathname, req, res, ctx);
    return;
  }

  // Running-mode endpoints require config + heartbeat
  if (!ctx.config || !ctx.heartbeat) {
    json(res, { error: "Agent not configured", mode: "setup" }, 503);
    return;
  }

  switch (pathname) {
    case "/api/status":
      json(res, {
        running: ctx.heartbeat.state.running,
        activeTasks: ctx.heartbeat.state.activeTasks.size,
        totalPolls: ctx.heartbeat.state.totalPolls,
        lastPoll: ctx.heartbeat.state.lastPoll,
        startedAt: ctx.heartbeat.state.startedAt,
        uptime: ctx.heartbeat.state.running
          ? Date.now() - ctx.heartbeat.state.startedAt
          : 0,
        agentId: ctx.config.agentId,
      });
      break;

    case "/api/tasks":
      json(res, {
        tasks: [...ctx.heartbeat.state.activeTasks.values()],
        events: getRecentActivity(30),
      });
      break;

    case "/api/logs":
      json(res, { log: readTodayLog() });
      break;

    case "/api/config": {
      const maskedMarketplaces = ctx.config.marketplaces ? {
        near: ctx.config.marketplaces.near
          ? { ...ctx.config.marketplaces.near, apiKey: ctx.config.marketplaces.near.apiKey ? "***" : "" }
          : undefined,
        fetchai: ctx.config.marketplaces.fetchai
          ? { ...ctx.config.marketplaces.fetchai, apiKey: ctx.config.marketplaces.fetchai.apiKey ? "***" : "" }
          : undefined,
        autonolas: ctx.config.marketplaces.autonolas
          ? { ...ctx.config.marketplaces.autonolas, privateKey: ctx.config.marketplaces.autonolas.privateKey ? "***" : "" }
          : undefined,
        freelancer: ctx.config.marketplaces.freelancer
          ? { ...ctx.config.marketplaces.freelancer, accessToken: ctx.config.marketplaces.freelancer.accessToken ? "***" : "" }
          : undefined,
      } : undefined;
      json(res, {
        ...ctx.config,
        llm: { ...ctx.config.llm, apiKey: "***" },
        marketplaces: maskedMarketplaces,
        e2bApiKey: ctx.config.e2bApiKey ? "***" : undefined,
      });
    }
      break;

    case "/api/stats":
      json(res, {
        ...getFeedbackStats(),
        studySessions: ctx.heartbeat.state.totalStudySessions,
        knowledgeEntries: loadKnowledge().length,
      });
      break;

    case "/api/knowledge":
      json(res, { entries: loadKnowledge() });
      break;

    case "/api/knowledge/delete":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
      handleKnowledgeDelete(req, res);
      break;

    case "/api/feedback":
      json(res, { entries: loadFeedback() });
      break;

    case "/api/stop":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
      ctx.heartbeat.stop();
      json(res, { ok: true, running: false });
      break;

    case "/api/start":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
      ctx.heartbeat.start();
      json(res, { ok: true, running: true });
      break;

    case "/api/config-update":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
      handleConfigUpdate(req, res, ctx);
      break;

    case "/api/chat":
      if (req.method === "GET") {
        json(res, { messages: loadChat() });
      } else if (req.method === "POST") {
        handleChat(req, res, ctx);
      } else {
        json(res, { error: "GET or POST" }, 405);
      }
      break;

    case "/api/chat/clear":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
      clearChat();
      json(res, { ok: true });
      break;

    case "/api/wallet":
      handleWallet(res, ctx);
      break;

    case "/api/agent-info":
      handleAgentInfo(res, ctx);
      break;

    case "/api/agentcash-balance":
      handleAgentCashBalance(res, ctx);
      break;

    case "/api/eth-price":
      handleEthPrice(res);
      break;

    // --- Marketplace Connection Tests ---

    case "/api/bids/freelancer":
      handleFreelancerBids(res, ctx);
      break;

    case "/api/test/freelancer":
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); break; }
      handleTestFreelancer(res, ctx);
      break;

    case "/api/test/near": {
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); break; }
      const nearKey = ctx.config?.marketplaces?.near?.apiKey;
      if (!nearKey) { json(res, { ok: false, error: "No NEAR API key configured" }, 400); break; }
      json(res, { ok: true, message: "NEAR API key configured (connection test requires market.near.ai)" });
      break;
    }

    case "/api/test/fetchai": {
      if (req.method !== "POST") { json(res, { error: "POST only" }, 405); break; }
      const fetchKey = ctx.config?.marketplaces?.fetchai?.apiKey;
      if (!fetchKey) { json(res, { ok: false, error: "No Fetch.ai API key configured" }, 400); break; }
      json(res, { ok: true, message: "Fetch.ai API key configured (connection test requires agentverse.ai)" });
      break;
    }

    // --- Revenue & Analytics ---

    case "/api/revenue/today":
      json(res, dbRevenue.getTodayRevenue());
      break;

    case "/api/revenue/monthly": {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      json(res, dbRevenue.getMonthlyRevenue(yearMonth));
      break;
    }

    case "/api/revenue/lifetime":
      json(res, dbRevenue.getLifetimeRevenue());
      break;

    case "/api/revenue/goals":
      json(res, {
        goals: ctx.config?.revenueGoals ?? null,
        current: dbRevenue.getMonthlyRevenue(
          `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`
        ),
        lifetime: dbRevenue.getLifetimeRevenue(),
      });
      break;

    case "/api/analytics/tasks":
      json(res, {
        recent: dbTasks.getRecentTasks(50),
        stats: dbTasks.getTaskStats(),
      });
      break;

    case "/api/analytics/clients":
      json(res, {
        top: dbClients.getTopClients(20),
        repeat: dbClients.getRepeatClients(),
        total: dbClients.getClientCount(),
      });
      break;

    default:
      json(res, { error: "Not found" }, 404);
  }
}

async function handleSetupApi(
  pathname: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    switch (pathname) {
      case "/api/setup/status":
        json(res, {
          configured: isConfigured(),
          mode: ctx.mode,
          step: detectCurrentStep(ctx),
        });
        break;

      case "/api/setup/wallet": {
        const wallet = await cli.walletShow();
        json(res, wallet);
        break;
      }

      case "/api/setup/agent-lookup": {
        const wallet = await cli.walletShow();
        const agent = await cli.getAgentByWallet(wallet.address);
        // Auto-save agentId to config if found
        if (agent) {
          savePartialConfig({ agentId: agent.agentId });
          ctx.config = loadConfig();
        }
        json(res, { agent });
        break;
      }

      case "/api/setup/wallet/import": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        const body = parseJsonBody(await readBody(req)) as { privateKey: string };
        const wallet = await cli.walletImport(body.privateKey);
        json(res, wallet);
        break;
      }

      case "/api/setup/register": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        const body = parseJsonBody(await readBody(req)) as {
          name: string;
          description: string;
          skills: string[];
          price: string;
          symbol?: string;
          token?: string;
          image?: string; // base64 data URL
          website?: string;
        };

        // If image is a base64 data URL, write to temp file for CLI
        let imagePath: string | undefined;
        if (body.image && body.image.startsWith("data:")) {
          const match = body.image.match(/^data:image\/(\w+);base64,(.+)$/);
          if (match) {
            const ext = match[1] === "jpeg" ? "jpg" : match[1];
            imagePath = path.join(os.tmpdir(), `melista-image-${Date.now()}.${ext}`);
            fs.writeFileSync(imagePath, Buffer.from(match[2], "base64"));
          }
        }

        try {
          const result = await cli.registerAgent({
            ...body,
            image: imagePath,
          });
          savePartialConfig({ agentId: result.agentId });
          ctx.config = loadConfig();
          json(res, result);
        } finally {
          // Clean up temp image
          if (imagePath && fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
          }
        }
        break;
      }

      case "/api/setup/llm": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        const body = parseJsonBody(await readBody(req)) as LLMConfig;
        savePartialConfig({ llm: body });
        ctx.config = loadConfig();
        json(res, { ok: true });
        break;
      }

      case "/api/setup/llm/test": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        const body = parseJsonBody(await readBody(req)) as LLMConfig;
        // Substitute real key if masked value sent
        if (body.apiKey === "***" || !body.apiKey) {
          const existingConfig = ctx.config ?? loadConfig();
          if (existingConfig?.llm?.apiKey && existingConfig.llm.apiKey !== "***") {
            body.apiKey = existingConfig.llm.apiKey;
          } else {
            json(res, { ok: false, response: "No API key configured. Enter a key first." }, 400);
            break;
          }
        }
        const llm = createLLMProvider(body);
        const response = await llm.chat([
          { role: "user", content: "Say hello in one sentence." },
        ]);
        const text = response.content
          .filter((b): b is { type: "text"; text: string } => b.type === "text")
          .map((b) => b.text)
          .join("");
        json(res, { ok: true, response: text });
        break;
      }

      case "/api/setup/specialization": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        const body = parseJsonBody(await readBody(req)) as {
          specialties: string[];
          pricing: { strategy: string; baseRateEth: string; maxRateEth: string };
          autoQuote: boolean;
          autoWork: boolean;
          maxConcurrentTasks: number;
          declineKeywords: string[];
        };
        savePartialConfig({
          specialties: body.specialties,
          pricing: body.pricing as MelistaConfig["pricing"],
          autoQuote: body.autoQuote,
          autoWork: body.autoWork,
          maxConcurrentTasks: body.maxConcurrentTasks,
          declineKeywords: body.declineKeywords,
        });
        ctx.config = loadConfig();
        json(res, { ok: true });
        break;
      }

      case "/api/setup/complete": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }

        if (!isConfigured()) {
          json(res, { error: "Configuration incomplete" }, 400);
          return;
        }

        ctx.config = loadConfig()!;
        const llm = createLLMProvider(ctx.config.llm);
        ctx.heartbeat = createHeartbeat(ctx.config, llm);
        ctx.heartbeat.start();
        ctx.mode = "running";

        json(res, { ok: true, mode: "running" });
        break;
      }

      case "/api/setup/reset": {
        if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
        if (ctx.heartbeat) {
          ctx.heartbeat.stop();
          ctx.heartbeat = null;
        }
        ctx.config = null;
        ctx.mode = "setup";
        json(res, { ok: true, mode: "setup" });
        break;
      }

      default:
        json(res, { error: "Not found" }, 404);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

/** Detect which setup step the user is on based on current config state */
function detectCurrentStep(ctx: ServerContext): string {
  if (!ctx.config) return "wallet";
  if (!ctx.config.agentId) return "register";
  if (!ctx.config.llm?.apiKey) return "llm";
  return "specialization";
}

async function handleConfigUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const body = await readBody(req);
    const updates = parseJsonBody<Partial<MelistaConfig>>(body);

    if (!ctx.config) {
      json(res, { error: "No config" }, 400);
      return;
    }

    if (updates.specialties) ctx.config.specialties = updates.specialties;
    if (updates.pricing) {
      const ethPattern = /^\d+(\.\d{1,18})?$/;
      if (!ethPattern.test(updates.pricing.baseRateEth) || !ethPattern.test(updates.pricing.maxRateEth)) {
        json(res, { error: "Invalid ETH amount format" }, 400);
        return;
      }
      if (parseFloat(updates.pricing.baseRateEth) > parseFloat(updates.pricing.maxRateEth)) {
        json(res, { error: "baseRate cannot exceed maxRate" }, 400);
        return;
      }
      ctx.config.pricing = updates.pricing;
    }
    if (updates.autoQuote !== undefined) ctx.config.autoQuote = updates.autoQuote;
    if (updates.autoWork !== undefined) ctx.config.autoWork = updates.autoWork;
    if (updates.maxConcurrentTasks !== undefined) {
      const val = Number(updates.maxConcurrentTasks);
      if (!Number.isInteger(val) || val < 1 || val > 20) {
        json(res, { error: "maxConcurrentTasks must be 1-20" }, 400);
        return;
      }
      ctx.config.maxConcurrentTasks = val;
    }
    if (updates.declineKeywords) ctx.config.declineKeywords = updates.declineKeywords;
    if (updates.personality) {
      const p = updates.personality;
      // Cap customInstructions to prevent prompt bloat
      if (p.customInstructions && p.customInstructions.length > 2000) {
        json(res, { error: "customInstructions must be under 2000 characters" }, 400);
        return;
      }
      ctx.config.personality = p;
    }
    if (updates.learningEnabled !== undefined) ctx.config.learningEnabled = updates.learningEnabled;
    if (updates.studyIntervalMs !== undefined) {
      const val = Number(updates.studyIntervalMs);
      if (val < 60_000 || val > 86_400_000) {
        json(res, { error: "studyIntervalMs must be 60000-86400000" }, 400);
        return;
      }
      ctx.config.studyIntervalMs = val;
    }
    if (updates.polling) ctx.config.polling = updates.polling;
    if (updates.agentCashEnabled !== undefined) ctx.config.agentCashEnabled = updates.agentCashEnabled;
    if (updates.revenueGoals) ctx.config.revenueGoals = updates.revenueGoals;
    if (updates.e2bApiKey && updates.e2bApiKey !== "***") {
      ctx.config.e2bApiKey = updates.e2bApiKey;
    }
    if (updates.marketplaces !== undefined) {
      const existing = ctx.config.marketplaces ?? {};
      const incoming = updates.marketplaces as Record<string, Record<string, string> | undefined>;
      // Preserve existing secrets when masked value "***" is sent
      if (incoming.near) {
        if (incoming.near.apiKey === "***") incoming.near.apiKey = existing.near?.apiKey ?? "";
      }
      if (incoming.fetchai) {
        if (incoming.fetchai.apiKey === "***") incoming.fetchai.apiKey = existing.fetchai?.apiKey ?? "";
      }
      if (incoming.autonolas) {
        if (incoming.autonolas.privateKey === "***") incoming.autonolas.privateKey = existing.autonolas?.privateKey ?? "";
      }
      if (incoming.freelancer) {
        if (incoming.freelancer.accessToken === "***") incoming.freelancer.accessToken = existing.freelancer?.accessToken ?? "";
      }
      ctx.config.marketplaces = { ...existing, ...updates.marketplaces };
    }

    // LLM hot-swap: preserve existing apiKey if masked, restart heartbeat
    if (updates.llm) {
      const newLlm = { ...updates.llm };
      const providerChanged = newLlm.provider !== ctx.config.llm.provider;
      if (newLlm.apiKey === "***") {
        if (providerChanged) {
          json(res, { error: "New provider selected — please enter your API key" }, 400);
          return;
        }
        newLlm.apiKey = ctx.config.llm.apiKey;
      }
      ctx.config.llm = newLlm;

      // Restart heartbeat with new LLM provider
      if (ctx.heartbeat) {
        ctx.heartbeat.stop();
        const llm = createLLMProvider(ctx.config.llm);
        ctx.heartbeat = createHeartbeat(ctx.config, llm);
        ctx.heartbeat.start();
      }
    }

    savePartialConfig(ctx.config);
    json(res, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid request";
    json(res, { error: msg }, 400);
  }
}

// Cache wallet info to avoid calling CLI every 3s
let walletCache: { info: { address: string; balance?: string }; fetchedAt: number } | null = null;
const WALLET_CACHE_TTL = 60_000; // 1 min

async function handleWallet(
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const now = Date.now();
    if (!walletCache || now - walletCache.fetchedAt > WALLET_CACHE_TTL) {
      const info = await cli.walletShow();
      walletCache = { info, fetchedAt: now };
    }
    json(res, walletCache.info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

async function handleAgentInfo(
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const wallet = await cli.walletShow();
    const agent = await cli.getAgentByWallet(wallet.address);
    json(res, { agent });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

async function handleAgentCashBalance(
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  if (!ctx.config?.agentCashEnabled) {
    json(res, { error: "AgentCash not enabled" }, 400);
    return;
  }
  try {
    const result = await agentcashBalance.execute({}, { config: ctx.config!, taskId: "" });
    if (!result.success) {
      json(res, { error: result.data }, 500);
      return;
    }
    json(res, JSON.parse(result.data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

// ETH price cache — 60s TTL
let ethPriceCache: { price: number; fetchedAt: number } | null = null;
const ETH_PRICE_CACHE_TTL = 60_000;

async function handleEthPrice(res: http.ServerResponse) {
  try {
    const now = Date.now();
    if (!ethPriceCache || now - ethPriceCache.fetchedAt > ETH_PRICE_CACHE_TTL) {
      const resp = await fetch(
        "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD",
      );
      const data = (await resp.json()) as { USD?: number };
      if (!data.USD) {
        json(res, { error: "Failed to fetch ETH price" }, 502);
        return;
      }
      ethPriceCache = { price: data.USD, fetchedAt: now };
    }
    json(res, { price: ethPriceCache.price });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 502);
  }
}

async function handleChat(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const body = parseJsonBody(await readBody(req)) as { message: string };
    if (!body.message?.trim()) {
      json(res, { error: "Message required" }, 400);
      return;
    }

    if (!ctx.config) {
      json(res, { error: "Not configured" }, 400);
      return;
    }

    const userMsg = body.message.trim();
    appendChat({ role: "user", content: userMsg, timestamp: Date.now() });

    const llm = createLLMProvider(ctx.config.llm);
    const specialties = ctx.config.specialties.length > 0
      ? ctx.config.specialties.join(", ")
      : "general tasks";

    // Gather self-awareness context
    const allKnowledge = loadKnowledge();
    const relevantKnowledge = getRelevantKnowledge(ctx.config.specialties, 5);
    const stats = getFeedbackStats();
    const hbState = ctx.heartbeat?.state;
    const studySessions = hbState?.totalStudySessions ?? 0;
    const isRunning = hbState?.running ?? false;

    const knowledgeSection = relevantKnowledge.length > 0
      ? `\n\nYou've learned these insights from self-study:\n${relevantKnowledge.map((k) => `- ${k.insight.slice(0, 200)}`).join("\n")}`
      : "";

    const personalitySection = ctx.config.personality
      ? `\nYour personality: tone=${ctx.config.personality.tone}, style=${ctx.config.personality.responseStyle}.${ctx.config.personality.customInstructions ? ` Custom instructions: ${ctx.config.personality.customInstructions}` : ""}`
      : "";

    const systemPrompt = `You are Melista (agent "${ctx.config.agentId}"), an autonomous work agent on the moltlaunch marketplace.
Your specialties: ${specialties}. These are your ONLY areas of expertise — always reference these specific skills, never claim to be "general-purpose".

## Self-awareness
- Status: ${isRunning ? "RUNNING" : "STOPPED"}
- Learning: ${ctx.config.learningEnabled ? "ACTIVE" : "DISABLED"} — study sessions every ${Math.round(ctx.config.studyIntervalMs / 60000)} min
- Study sessions completed: ${studySessions}
- Knowledge entries: ${allKnowledge.length}
- Tasks completed: ${stats.totalTasks}, avg score: ${stats.avgScore}/5
- Tools: quote, decline, submit work, message clients, browse bounties, check wallet, read feedback${personalitySection}

You're chatting with your operator. Be helpful, concise, and direct. Discuss performance, knowledge, tasks, and capabilities. Keep responses grounded in your actual data.${knowledgeSection}`;

    // Build conversation from history (last 20 messages for context)
    const history = loadChat().slice(-20);
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ];

    const response = await llm.chat(messages);
    const text = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    appendChat({ role: "assistant", content: text, timestamp: Date.now() });
    json(res, { reply: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

async function handleKnowledgeDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  try {
    const body = parseJsonBody<{ id: string }>(await readBody(req));
    if (!body.id || typeof body.id !== "string") {
      json(res, { error: "Missing id" }, 400);
      return;
    }
    const deleted = deleteKnowledge(body.id);
    if (!deleted) {
      json(res, { error: "Entry not found" }, 404);
      return;
    }
    json(res, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid request";
    json(res, { error: msg }, 400);
  }
}

// --- Marketplace data handlers ---

async function handleFreelancerBids(res: http.ServerResponse, ctx: ServerContext) {
  try {
    const token = ctx.config?.marketplaces?.freelancer?.accessToken;
    const userId = ctx.config?.marketplaces?.freelancer?.userId;
    if (!token || !userId) { json(res, { bids: [], error: "Freelancer not configured" }); return; }

    const resp = await fetch(`https://www.freelancer.com/api/projects/0.1/bids/?bidders[]=${userId}&limit=30&project_details=true`, {
      headers: { "Freelancer-OAuth-V1": token },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) { json(res, { bids: [], error: `API ${resp.status}` }); return; }

    const data = await resp.json() as {
      status: string;
      result: {
        bids: Array<{
          id: number;
          project_id: number;
          amount: number;
          period: number;
          description: string;
          award_status: string | null;
          time_submitted: number;
          paid_status: string | null;
          complete_status: string | null;
        }>;
        projects?: Record<string, { title: string; status: string; currency: { code: string } }>;
      };
    };

    const bids = (data.result?.bids ?? []).map((b) => {
      const project = data.result?.projects?.[String(b.project_id)];
      return {
        id: b.id,
        projectId: b.project_id,
        projectTitle: project?.title ?? `Project #${b.project_id}`,
        projectStatus: project?.status ?? "unknown",
        currency: project?.currency?.code ?? "USD",
        amount: b.amount,
        period: b.period,
        description: b.description,
        awardStatus: b.award_status,
        paidStatus: b.paid_status,
        completeStatus: b.complete_status,
        submittedAt: b.time_submitted * 1000,
      };
    });

    json(res, { bids });
  } catch (err) {
    json(res, { bids: [], error: err instanceof Error ? err.message : "Failed" });
  }
}

// --- Marketplace test handlers ---

async function handleTestFreelancer(res: http.ServerResponse, ctx: ServerContext) {
  try {
    const token = ctx.config?.marketplaces?.freelancer?.accessToken;
    if (!token) { json(res, { ok: false, error: "No Freelancer access token configured" }, 400); return; }
    const resp = await fetch("https://www.freelancer.com/api/users/0.1/self/", {
      headers: { "Freelancer-OAuth-V1": token },
    });
    if (!resp.ok) { json(res, { ok: false, error: `Freelancer API ${resp.status}` }); return; }
    const data = await resp.json() as { result: { id: number; username: string; display_name?: string } };
    const u = data.result;
    json(res, { ok: true, username: u.username, userId: u.id, displayName: u.display_name });
  } catch (err) {
    json(res, { ok: false, error: err instanceof Error ? err.message : "Connection failed" });
  }
}

// --- Auth handlers ---

async function handleLogin(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
  try {
    const body = parseJsonBody<{ password: string }>(await readBody(req));
    if (!body.password) {
      json(res, { error: "Password required" }, 400);
      return;
    }

    const auth = getAuthConfig(ctx);
    if (!auth) {
      json(res, { error: "Auth not configured" }, 400);
      return;
    }

    const hash = hashPassword(body.password, auth.sessionSecret);
    if (hash !== auth.passwordHash) {
      json(res, { error: "Invalid password" }, 401);
      return;
    }

    const token = generateToken();
    dbSessions.createSession(token, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token);
    json(res, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    json(res, { error: msg }, 400);
  }
}

function handleLogout(req: http.IncomingMessage, res: http.ServerResponse) {
  if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
  const cookie = req.headers.cookie ?? "";
  const match = cookie.match(/melista_session=([a-f0-9]+)/);
  if (match) dbSessions.deleteSession(match[1]);
  res.setHeader("Set-Cookie", "melista_session=; Path=/; HttpOnly; Max-Age=0");
  json(res, { ok: true });
}

async function handleAuthSetup(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  if (req.method !== "POST") { json(res, { error: "POST only" }, 405); return; }
  try {
    const body = parseJsonBody<{ password: string }>(await readBody(req));
    if (!body.password || body.password.length < 6) {
      json(res, { error: "Password must be at least 6 characters" }, 400);
      return;
    }

    const secret = crypto.randomBytes(16).toString("hex");
    const hash = hashPassword(body.password, secret);

    savePartialConfig({
      auth: { passwordHash: hash, sessionSecret: secret },
    });
    if (ctx.config) {
      ctx.config.auth = { passwordHash: hash, sessionSecret: secret };
    }

    // Auto-login after setup
    const token = generateToken();
    dbSessions.createSession(token, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token);
    json(res, { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Setup failed";
    json(res, { error: msg }, 400);
  }
}

function serveStatic(pathname: string, res: http.ServerResponse) {
  // Resolve the built UI dist directory.
  // In dev (tsx): import.meta.dirname = src/, built UI at ../dist/ui
  // In prod (dist/index.js): import.meta.dirname = dist/, built UI at ./ui
  const baseDir = import.meta.dirname ?? __dirname;
  const distUi = path.join(baseDir, "..", "dist", "ui");
  const uiDir = fs.existsSync(path.join(distUi, "index.html"))
    ? distUi
    : path.join(baseDir, "ui");

  const resolvedUiDir = path.resolve(uiDir);
  let filePath = path.resolve(uiDir, pathname === "/" ? "index.html" : pathname.slice(1));

  // Path traversal guard — ensure resolved path is under uiDir
  if (!filePath.startsWith(resolvedUiDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!path.extname(filePath)) {
    filePath = path.join(resolvedUiDir, "index.html");
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath);
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };

  res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "text/plain" });
  fs.createReadStream(filePath).pipe(res);
}
