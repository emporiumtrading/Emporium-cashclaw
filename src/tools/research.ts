/**
 * Research tools — give Melista access to real-time data for
 * making informed prediction market trades.
 * All FREE APIs, no keys needed.
 */
import type { Tool } from "./types.js";

/** Crypto price lookup — CoinGecko FREE API */
export const getCryptoPrice: Tool = {
  definition: {
    name: "get_crypto_price",
    description: "Get current crypto price, 24h change, market cap, and volume. Use for BTC/ETH/SOL price prediction markets. FREE — no API key.",
    input_schema: {
      type: "object",
      properties: {
        coin: { type: "string", description: "Coin ID: bitcoin, ethereum, solana, dogecoin, etc." },
      },
      required: ["coin"],
    },
  },
  async execute(input) {
    const coin = (input.coin as string).toLowerCase();
    try {
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await resp.json() as Record<string, { usd: number; usd_24h_change: number; usd_market_cap: number; usd_24h_vol: number }>;
      const c = data[coin];
      if (!c) return { success: false, data: `Coin "${coin}" not found. Try: bitcoin, ethereum, solana` };
      return {
        success: true,
        data: `**${coin.toUpperCase()}**: $${c.usd.toLocaleString()} | 24h: ${c.usd_24h_change >= 0 ? "+" : ""}${c.usd_24h_change.toFixed(2)}% | MCap: $${(c.usd_market_cap / 1e9).toFixed(1)}B | Vol: $${(c.usd_24h_vol / 1e9).toFixed(1)}B\n\nUse this for crypto price prediction markets.`,
      };
    } catch (err) {
      return { success: false, data: `Crypto API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** News headlines — free RSS feeds */
export const getNews: Tool = {
  definition: {
    name: "get_news",
    description: "Get latest news headlines for any topic. Use for prediction market research — breaking news creates mispricings. Sources: Google News RSS (FREE).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search topic (e.g. 'Iran ceasefire', 'NBA playoffs', 'Bitcoin', 'Fed rate')" },
      },
      required: ["query"],
    },
  },
  async execute(input) {
    const query = input.query as string;
    try {
      const resp = await fetch(
        `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`,
        { signal: AbortSignal.timeout(10000) },
      );
      const xml = await resp.text();

      // Parse RSS items
      const items: string[] = [];
      const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
      const pubDateRegex = /<pubDate>(.*?)<\/pubDate>/g;
      let match;
      let count = 0;

      while ((match = titleRegex.exec(xml)) && count < 10) {
        const title = match[1] ?? match[2] ?? "";
        if (title && !title.startsWith("Google News") && title !== query) {
          const dateMatch = pubDateRegex.exec(xml);
          const date = dateMatch ? new Date(dateMatch[1]).toLocaleString() : "";
          items.push(`- ${title}${date ? ` (${date})` : ""}`);
          count++;
        }
      }

      if (items.length === 0) {
        return { success: true, data: `No recent news found for "${query}".` };
      }

      return {
        success: true,
        data: `## Latest News: "${query}"\n\n${items.join("\n")}\n\nUse these headlines to inform your prediction market analysis. Breaking news = potential mispricings.`,
      };
    } catch (err) {
      return { success: false, data: `News fetch error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** Sports scores — free ESPN API */
export const getSportsScores: Tool = {
  definition: {
    name: "get_sports_scores",
    description: "Get live and recent sports scores and schedules. Use for sports prediction markets. Supports: NBA, NFL, NHL, MLB, soccer, MMA. FREE.",
    input_schema: {
      type: "object",
      properties: {
        sport: { type: "string", description: "Sport: nba, nfl, nhl, mlb, soccer, mma" },
        league: { type: "string", description: "League (optional): for soccer use 'eng.1' (EPL), 'esp.1' (La Liga), etc." },
      },
      required: ["sport"],
    },
  },
  async execute(input) {
    const sport = (input.sport as string).toLowerCase();
    const league = (input.league as string) ?? "";

    const sportMap: Record<string, string> = {
      nba: "basketball/nba",
      nfl: "football/nfl",
      nhl: "hockey/nhl",
      mlb: "baseball/mlb",
      soccer: `soccer/${league || "eng.1"}`,
      mma: "mma/ufc",
      ncaa: "basketball/mens-college-basketball",
      ncaaf: "football/college-football",
    };

    const path = sportMap[sport] ?? `${sport}/${league || sport}`;

    try {
      const resp = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`,
        { signal: AbortSignal.timeout(10000) },
      );
      const data = await resp.json() as {
        events?: Array<{
          name: string;
          status: { type: { state: string; detail: string } };
          competitions?: Array<{
            competitors: Array<{ team: { displayName: string }; score: string; winner?: boolean }>;
            odds?: Array<{ details: string; overUnder: number }>;
          }>;
        }>;
      };

      const events = data.events ?? [];
      if (events.length === 0) {
        return { success: true, data: `No ${sport} games found today.` };
      }

      const lines = [`## ${sport.toUpperCase()} Scores/Schedule\n`];
      for (const event of events.slice(0, 10)) {
        const status = event.status?.type?.detail ?? "Unknown";
        const state = event.status?.type?.state ?? "";
        const comp = event.competitions?.[0];
        const teams = comp?.competitors ?? [];
        const odds = comp?.odds?.[0];

        let scoreLine = event.name;
        if (teams.length >= 2) {
          scoreLine = `${teams[0].team.displayName} ${teams[0].score ?? ""} vs ${teams[1].team.displayName} ${teams[1].score ?? ""}`;
        }

        const tag = state === "in" ? "🔴 LIVE" : state === "post" ? "✅ FINAL" : "📅 UPCOMING";
        lines.push(`${tag} | ${scoreLine}`);
        lines.push(`  Status: ${status}`);
        if (odds) {
          lines.push(`  Odds: ${odds.details} | O/U: ${odds.overUnder}`);
        }
        lines.push("");
      }

      return { success: true, data: lines.join("\n") };
    } catch (err) {
      return { success: false, data: `Sports API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};
