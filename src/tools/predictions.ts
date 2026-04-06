/**
 * Prediction market tools — let Melista autonomously research,
 * analyze, and trade prediction markets.
 */
import type { Tool } from "./types.js";
import { canPlaceTrade, recordTrade, getOpenPositions, getPredictionStats, DEFAULT_PREDICTION_CONFIG } from "../predictions/strategy.js";

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
    description: "Record a prediction market trade. This logs the trade with risk management checks. IMPORTANT: Only trade when you have HIGH confidence (65%+) based on your research. Max 5% of balance per trade.",
    input_schema: {
      type: "object",
      properties: {
        market: { type: "string", description: "Market question/title" },
        platform: { type: "string", description: "polymarket or kalshi" },
        outcome: { type: "string", description: "Your predicted outcome (e.g. 'Yes', 'No', 'Trump', 'Harris')" },
        confidence: { type: "number", description: "Your confidence 0.0-1.0 (must be >= 0.65)" },
        amount_usd: { type: "number", description: "Amount in USD to wager" },
        entry_price: { type: "number", description: "Current market price 0.0-1.0 for your outcome" },
        thesis: { type: "string", description: "Why you believe this outcome — your research-backed reasoning" },
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

    // Risk check
    const balance = 100; // TODO: get actual balance from wallet
    const check = canPlaceTrade(DEFAULT_PREDICTION_CONFIG, balance, amount, confidence);
    if (!check.allowed) {
      return { success: false, data: `Trade rejected by risk management: ${check.reason}` };
    }

    const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const quantity = amount / entryPrice;

    recordTrade({
      id,
      market,
      platform,
      outcome,
      entryPrice,
      quantity,
      costBasis: amount,
      currentValue: amount,
      confidence,
      thesis,
      openedAt: Date.now(),
      status: "open",
    });

    return {
      success: true,
      data: `Trade recorded:\n- Market: ${market}\n- Outcome: ${outcome} @ ${(entryPrice * 100).toFixed(1)}%\n- Amount: $${amount.toFixed(2)}\n- Confidence: ${(confidence * 100).toFixed(0)}%\n- Thesis: ${thesis.slice(0, 200)}\n\nNOTE: This is recorded for tracking. Actual execution on ${platform} requires wallet integration.`,
    };
  },
};

export const viewPredictionPositions: Tool = {
  definition: {
    name: "view_prediction_positions",
    description: "View your current prediction market positions and P&L. Use to review your portfolio and make decisions about closing positions.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute() {
    const positions = getOpenPositions();
    const stats = getPredictionStats();

    const lines = [`## Prediction Portfolio\n`];
    lines.push(`Total P&L: $${stats.totalPnl.toFixed(2)} | Win rate: ${stats.winRate.toFixed(1)}% | Open: ${stats.openPositions}`);
    lines.push(`Total wagered: $${stats.totalWagered.toFixed(2)} | Trades: ${stats.totalTrades}\n`);

    if (positions.length === 0) {
      lines.push("No open positions. Search for markets and place trades.");
    } else {
      for (const p of positions) {
        lines.push(`- **${p.market}** [${p.platform}]`);
        lines.push(`  ${p.outcome} @ ${(p.entryPrice * 100).toFixed(1)}% | $${p.costBasis.toFixed(2)} | Conf: ${(p.confidence * 100).toFixed(0)}%`);
      }
    }

    return { success: true, data: lines.join("\n") };
  },
};
