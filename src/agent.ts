import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {
  loadConfig,
  savePartialConfig,
  isConfigured,
  isAgentCashAvailable,
} from "./config.js";
import { createLLMProvider } from "./llm/index.js";
import { createHeartbeat, type Heartbeat } from "./heartbeat.js";
import { readTodayLog } from "./memory/log.js";
import { getFeedbackStats, loadFeedback } from "./memory/feedback.js";
import { loadKnowledge } from "./memory/knowledge.js";
import { loadChat, clearChat } from "./memory/chat.js";
import type { CashClawConfig } from "./config.js";
import {
  PORT,
  MAX_BODY_BYTES,
} from "./constants.js";
import { requireMethod } from "./utils.js";
import { checkRateLimit } from "./ratelimit.js";
import { createLogger } from "./logger.js";
import { handleSetupApi } from "./handlers/setup.js";
import {
  handleConfigUpdate,
  handleChat,
  handleKnowledgeDelete,
  handleWallet,
  handleAgentInfo,
  handleAgentCashBalance,
  handleEthPrice,
} from "./handlers/running.js";

const log = createLogger("server");

type ServerMode = "setup" | "running";

export interface ServerContext {
  mode: ServerMode;
  config: CashClawConfig | null;
  heartbeat: Heartbeat | null;
}

export function json(res: http.ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function readBody(req: http.IncomingMessage): Promise<string> {
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

export function parseJsonBody<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Invalid JSON");
  }
}

export async function startAgent(): Promise<http.Server> {
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

    // Apply rate limiting to API endpoints
    if (url.pathname.startsWith("/api/")) {
      if (!checkRateLimit(req, res)) return;
      handleApi(url.pathname, req, res, ctx);
      return;
    }

    serveStatic(url.pathname, res);
  });

  server.listen(PORT, () => {
    log.info(`Dashboard: http://localhost:${PORT}`);
  });

  return server;
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
        events: ctx.heartbeat.state.events.slice(-50),
      });
      break;

    case "/api/logs":
      json(res, { log: readTodayLog() });
      break;

    case "/api/config":
      json(res, {
        ...ctx.config,
        llm: { ...ctx.config.llm, apiKey: "***" },
      });
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
      if (!requireMethod(req, res, "POST")) return;
      handleKnowledgeDelete(req, res);
      break;

    case "/api/feedback":
      json(res, { entries: loadFeedback() });
      break;

    case "/api/stop":
      if (!requireMethod(req, res, "POST")) return;
      ctx.heartbeat.stop();
      json(res, { ok: true, running: false });
      break;

    case "/api/start":
      if (!requireMethod(req, res, "POST")) return;
      ctx.heartbeat.start();
      json(res, { ok: true, running: true });
      break;

    case "/api/config-update":
      if (!requireMethod(req, res, "POST")) return;
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
      if (!requireMethod(req, res, "POST")) return;
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

    default:
      json(res, { error: "Not found" }, 404);
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
