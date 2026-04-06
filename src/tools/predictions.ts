/**
 * Prediction market tools — let Melista autonomously research,
 * analyze, and trade prediction markets.
 */
import type { Tool } from "./types.js";
import { canPlaceTrade, recordTrade, closeTrade, getOpenPositions, getPredictionStats, getLessonsLearned, getPaperStats, DEFAULT_PREDICTION_CONFIG } from "../predictions/strategy.js";

export const searchPredictionMarkets: Tool = {
  definition: {
    name: "search_prediction_markets",
    description: "Search prediction markets (Polymarket, Kalshi) for trading opportunities. Returns active markets with current odds. Use this to find mispriced bets where your research gives you an edge.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (e.g. 'US election', 'crypto', 'AI', 'sports', 'Fed rate')" },
        platform: { type: "string", description: "Platform: 'polymarket' or 'kalshi' (default: both)" },
      },
      required: ["query"],
    },
  },
  async execute(input) {
    const query = (input.query as string) ?? "";
    const platform = (input.platform as string) ?? "polymarket";

    try {
      // Call Polymarket API directly
      const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=10&order=volume24hr&ascending=false&tag=${encodeURIComponent(query)}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });

      if (!resp.ok) {
        // Fallback: try without tag filter
        const fallbackUrl = `https://gamma-api.polymarket.com/markets?closed=false&limit=10&order=volume24hr&ascending=false`;
        const fallbackResp = await fetch(fallbackUrl, { signal: AbortSignal.timeout(10000) });
        if (!fallbackResp.ok) return { success: false, data: `Polymarket API ${fallbackResp.status}` };
        const data = await fallbackResp.json() as Array<Record<string, unknown>>;
        return formatMarkets(data, query);
      }

      const data = await resp.json() as Array<Record<string, unknown>>;
      return formatMarkets(data, query);
    } catch (err) {
      return { success: false, data: `Failed to fetch markets: ${err instanceof Error ? err.message : err}` };
    }
  },
};

function formatMarkets(markets: Array<Record<string, unknown>>, query: string): { success: boolean; data: string } {
  if (!Array.isArray(markets) || markets.length === 0) {
    return { success: true, data: `No markets found for "${query}". Try broader terms.` };
  }

  const lines = markets.slice(0, 10).map((m) => {
    const question = m.question ?? m.title ?? "?";
    const volume = m.volume24hr ?? m.volume ?? 0;
    const outcomePrices = m.outcomePrices ? JSON.stringify(m.outcomePrices) : "?";
    const bestBid = m.bestBid ?? "?";
    const bestAsk = m.bestAsk ?? "?";
    const id = m.id ?? m.conditionId ?? "?";
    return `- **${question}**\n  Volume: $${Number(volume).toLocaleString()} | Prices: ${outcomePrices} | ID: ${id}`;
  });

  return {
    success: true,
    data: `## Prediction Markets (${markets.length} results)\n\n${lines.join("\n\n")}\n\n**To trade:** Analyze the market, determine your confidence level, and use place_prediction_trade.`,
  };
}

export const placePredictionTrade: Tool = {
  definition: {
    name: "place_prediction_trade",
    description: "Place a prediction market trade (paper or live). Paper trades are FREE and help you learn. Live trades use real money. Start with paper trades to build your track record, then go live when your win rate proves you have an edge. IMPORTANT: Only trade when confidence >= 85%.",
    input_schema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market question/title" },
        platform: { type: "string", description: "polymarket or kalshi" },
        outcome: { type: "string", description: "Your predicted outcome (e.g. 'Yes', 'No')" },
        confidence: { type: "number", description: "Your confidence 0.0-1.0 (must be >= 0.65)" },
        amount_usd: { type: "number", description: "Amount in USD to wager" },
        entry_price: { type: "number", description: "Current market price 0.0-1.0 for your outcome" },
        thesis: { type: "string", description: "Why you believe this outcome — research-backed reasoning" },
        mode: { type: "string", description: "'paper' (default, free, for learning) or 'live' (real money)" },
      },
      required: ["market", "platform", "outcome", "confidence", "amount_usd", "entry_price", "thesis"],
    },
  },
  async execute(input) {
    const market = input.market as string;
    const platform = input.platform as string;
    const outcome = input.outcome as string;
    const confidence = input.confidence as number;
    const amount = input.amount_usd as number;
    const entryPrice = input.entry_price as number;
    const thesis = input.thesis as string;
    const mode = (input.mode as string) ?? "paper";

    // Risk check (applies to both paper and live)
    const balance = mode === "live" ? 10 : 1000; // Paper gets virtual $1000
    const check = canPlaceTrade(DEFAULT_PREDICTION_CONFIG, balance, amount, confidence);
    if (!check.allowed) {
      return { success: false, data: `Trade rejected: ${check.reason}` };
    }

    const id = `pred_${mode === "paper" ? "paper" : "live"}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    recordTrade({
      id,
      market,
      platform,
      outcome,
      entryPrice,
      quantity: amount / entryPrice,
      costBasis: amount,
      currentValue: amount,
      confidence,
      thesis,
      openedAt: Date.now(),
      status: "open",
      mode: mode as "paper" | "live",
    });

    const modeLabel = mode === "paper" ? "PAPER TRADE (learning mode — no real money)" : "LIVE TRADE ($" + amount.toFixed(2) + " real money)";

    return {
      success: true,
      data: `${modeLabel}\n- Market: ${market}\n- Outcome: ${outcome} @ ${(entryPrice * 100).toFixed(1)}%\n- Amount: $${amount.toFixed(2)}\n- Confidence: ${(confidence * 100).toFixed(0)}%\n- Thesis: ${thesis.slice(0, 200)}\n- ID: ${id}\n\nUse resolve_prediction to close this trade when the market resolves and record what you learned.`,
    };
  },
};

export const resolvePrediction: Tool = {
  definition: {
    name: "resolve_prediction",
    description: "Close a prediction trade and record the result. ALWAYS include a lesson learned — what did you get right or wrong? This builds your prediction intelligence over time.",
    input_schema: {
      type: "object",
      properties: {
        trade_id: { type: "string", description: "The trade ID to resolve" },
        pnl: { type: "number", description: "Profit/loss in USD (positive = win, negative = loss)" },
        lesson: { type: "string", description: "What you learned from this trade — be specific about what you got right or wrong and how to improve" },
      },
      required: ["trade_id", "pnl", "lesson"],
    },
  },
  async execute(input) {
    const tradeId = input.trade_id as string;
    const pnl = input.pnl as number;
    const lesson = input.lesson as string;

    closeTrade(tradeId, pnl, lesson);

    return {
      success: true,
      data: `Trade ${tradeId} resolved: ${pnl >= 0 ? "WIN" : "LOSS"} $${Math.abs(pnl).toFixed(2)}\nLesson: ${lesson}\n\nThis lesson is stored and will inform future predictions.`,
    };
  },
};

export const viewPredictionPositions: Tool = {
  definition: {
    name: "view_prediction_positions",
    description: "View your prediction market positions, P&L, paper trading stats, and lessons learned. Use to review performance and improve your strategy.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute() {
    const positions = getOpenPositions();
    const stats = getPredictionStats();
    const paper = getPaperStats();
    const lessons = getLessonsLearned(5);

    const lines = [`## Prediction Portfolio\n`];
    lines.push(`### Live Trades`);
    lines.push(`P&L: $${stats.totalPnl.toFixed(2)} | Win rate: ${stats.winRate.toFixed(1)}% | Total: ${stats.totalTrades}\n`);

    lines.push(`### Paper Trades (learning)`);
    lines.push(`Paper P&L: $${paper.paperPnl.toFixed(2)} | Win rate: ${paper.winRate.toFixed(1)}% | Total: ${paper.totalPaper}`);
    lines.push(`${paper.winRate >= 60 ? "Paper win rate looks good — consider going live on high-confidence trades!" : "Keep practicing — build your win rate above 60% before going live."}\n`);

    lines.push(`### Open Positions (${positions.length})`);
    if (positions.length === 0) {
      lines.push("No open positions. Search for markets and place paper trades to learn.");
    } else {
      for (const p of positions) {
        const modeTag = (p as unknown as { mode: string }).mode === "paper" ? "[PAPER]" : "[LIVE]";
        lines.push(`- ${modeTag} **${p.market}** [${p.platform}]`);
        lines.push(`  ${p.outcome} @ ${(p.entryPrice * 100).toFixed(1)}% | $${p.costBasis.toFixed(2)} | Conf: ${(p.confidence * 100).toFixed(0)}%`);
      }
    }

    if (lessons.length > 0) {
      lines.push(`\n### Lessons Learned (last ${lessons.length})`);
      for (const l of lessons) {
        const icon = l.pnl >= 0 ? "✅" : "❌";
        lines.push(`${icon} ${l.market}: ${l.lesson}`);
      }
    }

    return { success: true, data: lines.join("\n") };
  },
};
