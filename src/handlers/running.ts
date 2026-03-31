import http from "node:http";
import {
  savePartialConfig,
  type CashClawConfig,
} from "../config.js";
import { createLLMProvider } from "../llm/index.js";
import { createHeartbeat } from "../heartbeat.js";
import { getFeedbackStats } from "../memory/feedback.js";
import { loadKnowledge, getRelevantKnowledge, deleteKnowledge } from "../memory/knowledge.js";
import { loadChat, appendChat } from "../memory/chat.js";
import { agentcashBalance } from "../tools/agentcash.js";
import * as cli from "../moltlaunch/cli.js";
import {
  WALLET_CACHE_TTL_MS,
  ETH_PRICE_CACHE_TTL_MS,
  CRYPTOCOMPARE_API_URL,
  MAX_CONCURRENT_TASKS_MIN,
  MAX_CONCURRENT_TASKS_MAX,
  MAX_CUSTOM_INSTRUCTIONS_LENGTH,
  MIN_STUDY_INTERVAL_MS,
  MAX_STUDY_INTERVAL_MS,
} from "../constants.js";
import { extractText, withRetry } from "../utils.js";
import { json, readBody, parseJsonBody, type ServerContext } from "../agent.js";

// Cache wallet info to avoid calling CLI every 3s
let walletCache: { info: { address: string; balance?: string }; fetchedAt: number } | null = null;

// ETH price cache
let ethPriceCache: { price: number; fetchedAt: number } | null = null;

export async function handleConfigUpdate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const body = await readBody(req);
    const updates = parseJsonBody<Partial<CashClawConfig>>(body);

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
      if (!Number.isInteger(val) || val < MAX_CONCURRENT_TASKS_MIN || val > MAX_CONCURRENT_TASKS_MAX) {
        json(res, { error: `maxConcurrentTasks must be ${MAX_CONCURRENT_TASKS_MIN}-${MAX_CONCURRENT_TASKS_MAX}` }, 400);
        return;
      }
      ctx.config.maxConcurrentTasks = val;
    }
    if (updates.declineKeywords) ctx.config.declineKeywords = updates.declineKeywords;
    if (updates.personality) {
      const p = updates.personality;
      // Cap customInstructions to prevent prompt bloat
      if (p.customInstructions && p.customInstructions.length > MAX_CUSTOM_INSTRUCTIONS_LENGTH) {
        json(res, { error: `customInstructions must be under ${MAX_CUSTOM_INSTRUCTIONS_LENGTH} characters` }, 400);
        return;
      }
      ctx.config.personality = p;
    }
    if (updates.learningEnabled !== undefined) ctx.config.learningEnabled = updates.learningEnabled;
    if (updates.studyIntervalMs !== undefined) {
      const val = Number(updates.studyIntervalMs);
      if (val < MIN_STUDY_INTERVAL_MS || val > MAX_STUDY_INTERVAL_MS) {
        json(res, { error: `studyIntervalMs must be ${MIN_STUDY_INTERVAL_MS}-${MAX_STUDY_INTERVAL_MS}` }, 400);
        return;
      }
      ctx.config.studyIntervalMs = val;
    }
    if (updates.polling) ctx.config.polling = updates.polling;
    if (updates.agentCashEnabled !== undefined) ctx.config.agentCashEnabled = updates.agentCashEnabled;

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

export async function handleChat(
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

    const systemPrompt = `You are CashClaw (agent "${ctx.config.agentId}"), an autonomous work agent on the moltlaunch marketplace.
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
    const text = extractText(response.content);

    appendChat({ role: "assistant", content: text, timestamp: Date.now() });
    json(res, { reply: text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

export async function handleKnowledgeDelete(
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

export async function handleWallet(
  res: http.ServerResponse,
  ctx: ServerContext,
) {
  try {
    const now = Date.now();
    if (!walletCache || now - walletCache.fetchedAt > WALLET_CACHE_TTL_MS) {
      const info = await cli.walletShow();
      walletCache = { info, fetchedAt: now };
    }
    json(res, walletCache.info);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    json(res, { error: msg }, 500);
  }
}

export async function handleAgentInfo(
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

export async function handleAgentCashBalance(
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

export async function handleEthPrice(res: http.ServerResponse) {
  try {
    const now = Date.now();
    if (!ethPriceCache || now - ethPriceCache.fetchedAt > ETH_PRICE_CACHE_TTL_MS) {
      const data = await withRetry(async () => {
        const resp = await fetch(`${CRYPTOCOMPARE_API_URL}?fsym=ETH&tsyms=USD`);
        return (await resp.json()) as { USD?: number };
      });
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
