/**
 * Research tools — give Melista access to real-time data for
 * making informed prediction market trades.
 * All FREE APIs, no keys needed.
 */
import type { Tool } from "./types.js";

// ============================================================
// ALL FREE — NO API KEYS NEEDED
// ============================================================

/** Get detailed Polymarket market info — resolution source, description, outcomes */
export const getMarketDetails: Tool = {
  definition: {
    name: "get_market_details",
    description: "Get detailed info about a specific Polymarket prediction market — full description, resolution source, outcomes, volume, liquidity. Use BEFORE trading to understand exactly what you're betting on.",
    input_schema: {
      type: "object",
      properties: {
        market_id: { type: "string", description: "Market ID or condition ID from search_prediction_markets" },
      },
      required: ["market_id"],
    },
  },
  async execute(input) {
    const id = input.market_id as string;
    try {
      const resp = await fetch(`https://gamma-api.polymarket.com/markets/${id}`, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return { success: false, data: `Market ${id} not found` };
      const m = await resp.json() as Record<string, unknown>;

      const lines = [
        `## ${m.question ?? "?"}`,
        ``,
        `**Description:** ${(m.description as string ?? "").slice(0, 500)}`,
        `**Resolution Source:** ${m.resolutionSource ?? "Not specified"}`,
        `**End Date:** ${m.endDate ?? "?"}`,
        `**Volume 24h:** $${Number(m.volume24hr ?? 0).toLocaleString()}`,
        `**Total Volume:** $${Number(m.volume ?? 0).toLocaleString()}`,
        `**Liquidity:** $${Number(m.liquidity ?? 0).toLocaleString()}`,
        `**Outcomes:** ${m.outcomePrices ?? "?"}`,
        `**Active:** ${m.active ?? "?"}`,
        `**Closed:** ${m.closed ?? "?"}`,
      ];

      return { success: true, data: lines.join("\n") };
    } catch (err) {
      return { success: false, data: `Market details error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

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

/** Crypto Fear & Greed Index — Alternative.me FREE */
export const getCryptoFearGreed: Tool = {
  definition: {
    name: "get_crypto_fear_greed",
    description: "Get the Crypto Fear & Greed Index (0-100). Extreme Fear (<25) often means buying opportunity. Extreme Greed (>75) often means correction coming. Use for crypto prediction markets.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  async execute() {
    try {
      const resp = await fetch("https://api.alternative.me/fng/?limit=7", { signal: AbortSignal.timeout(5000) });
      const data = await resp.json() as { data: Array<{ value: string; value_classification: string; timestamp: string }> };
      const entries = data.data ?? [];
      const lines = entries.map((e) => `  ${new Date(Number(e.timestamp) * 1000).toLocaleDateString()}: ${e.value} (${e.value_classification})`);
      const current = entries[0];
      return { success: true, data: `**Crypto Fear & Greed Index: ${current?.value} (${current?.value_classification})**\n\nLast 7 days:\n${lines.join("\n")}\n\n0-24: Extreme Fear | 25-49: Fear | 50: Neutral | 51-74: Greed | 75-100: Extreme Greed` };
    } catch (err) {
      return { success: false, data: `Fear/Greed API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** Earthquake data — USGS FREE */
export const getEarthquakes: Tool = {
  definition: {
    name: "get_earthquakes",
    description: "Get recent earthquakes worldwide (magnitude 4+). Use for natural disaster prediction markets. USGS real-time data, FREE.",
    input_schema: { type: "object", properties: { min_magnitude: { type: "number", description: "Minimum magnitude (default 4)" } }, required: [] },
  },
  async execute(input) {
    const minMag = (input.min_magnitude as number) ?? 4;
    try {
      const resp = await fetch(`https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=${minMag}&limit=10&orderby=time`, { signal: AbortSignal.timeout(10000) });
      const data = await resp.json() as { features: Array<{ properties: { mag: number; place: string; time: number; tsunami: number }; geometry: { coordinates: number[] } }> };
      const quakes = data.features ?? [];
      const lines = quakes.map((q) => {
        const p = q.properties;
        const ago = Math.round((Date.now() - p.time) / 3600000);
        return `  M${p.mag.toFixed(1)} | ${p.place} | ${ago}h ago${p.tsunami ? " ⚠️TSUNAMI" : ""}`;
      });
      return { success: true, data: `**Recent Earthquakes (M${minMag}+):**\n\n${lines.join("\n") || "None in recent hours"}\n\nUse for natural disaster prediction markets.` };
    } catch (err) {
      return { success: false, data: `Earthquake API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** Forex / Exchange rates — Frankfurter FREE */
export const getForexRates: Tool = {
  definition: {
    name: "get_forex_rates",
    description: "Get live forex exchange rates (160+ currencies). Use for currency prediction markets. Frankfurter API, FREE, no limits.",
    input_schema: {
      type: "object",
      properties: {
        base: { type: "string", description: "Base currency (default: USD)" },
        symbols: { type: "string", description: "Target currencies comma-separated (e.g. 'EUR,GBP,JPY,CNY')" },
      },
      required: [],
    },
  },
  async execute(input) {
    const base = (input.base as string) ?? "USD";
    const symbols = (input.symbols as string) ?? "EUR,GBP,JPY,CNY,CAD,AUD,CHF,INR,BRL,MXN";
    try {
      const resp = await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${symbols}`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json() as { base: string; date: string; rates: Record<string, number> };
      const lines = Object.entries(data.rates).map(([k, v]) => `  ${base}/${k}: ${v}`);
      return { success: true, data: `**Forex Rates (${data.date}):**\n\n${lines.join("\n")}\n\nUse for currency/forex prediction markets.` };
    } catch (err) {
      return { success: false, data: `Forex API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** Wikipedia pageviews — proxy for public interest/trending */
export const getWikipediaPageviews: Tool = {
  definition: {
    name: "get_wikipedia_views",
    description: "Get Wikipedia pageview stats for any topic. High/spiking views = trending topic = potential prediction market opportunity. FREE.",
    input_schema: {
      type: "object",
      properties: {
        article: { type: "string", description: "Wikipedia article title (e.g. 'Donald_Trump', 'Bitcoin', 'Iran')" },
      },
      required: ["article"],
    },
  },
  async execute(input) {
    const article = (input.article as string).replace(/ /g, "_");
    try {
      const end = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10).replace(/-/g, "");
      const resp = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${article}/daily/${start}/${end}`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json() as { items: Array<{ timestamp: string; views: number }> };
      const items = data.items ?? [];
      const total = items.reduce((s, i) => s + i.views, 0);
      const avg = items.length > 0 ? Math.round(total / items.length) : 0;
      const latest = items[items.length - 1]?.views ?? 0;
      const lines = items.map((i) => `  ${i.timestamp.slice(0, 8)}: ${i.views.toLocaleString()} views`);
      const trending = latest > avg * 1.5 ? "📈 TRENDING (above average)" : latest < avg * 0.5 ? "📉 DECLINING" : "➡️ NORMAL";
      return { success: true, data: `**Wikipedia: "${article}"** ${trending}\n\nDaily avg: ${avg.toLocaleString()} | Latest: ${latest.toLocaleString()} | 7d total: ${total.toLocaleString()}\n\n${lines.join("\n")}\n\nSpike = public interest surge = potential prediction market mispricing.` };
    } catch (err) {
      return { success: false, data: `Wikipedia API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};

/** Economic indicators — BLS FREE */
export const getEconomicData: Tool = {
  definition: {
    name: "get_economic_data",
    description: "Get US economic data: CPI inflation, unemployment rate, employment. Use for Fed rate and economic prediction markets. BLS API, FREE.",
    input_schema: {
      type: "object",
      properties: {
        indicator: { type: "string", description: "Indicator: 'cpi' (inflation), 'unemployment', 'employment'" },
      },
      required: ["indicator"],
    },
  },
  async execute(input) {
    const indicator = (input.indicator as string).toLowerCase();
    const seriesMap: Record<string, { id: string; name: string }> = {
      cpi: { id: "CUUR0000SA0", name: "CPI (All Urban Consumers)" },
      unemployment: { id: "LNS14000000", name: "Unemployment Rate" },
      employment: { id: "CES0000000001", name: "Total Nonfarm Employment" },
    };
    const series = seriesMap[indicator];
    if (!series) return { success: false, data: `Unknown indicator "${indicator}". Use: cpi, unemployment, employment` };

    try {
      const resp = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seriesid: [series.id], startyear: "2025", endyear: "2026" }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await resp.json() as { Results: { series: Array<{ data: Array<{ year: string; period: string; value: string }> }> } };
      const points = data.Results?.series?.[0]?.data ?? [];
      const lines = points.slice(0, 6).map((p) => `  ${p.year}-${p.period}: ${p.value}`);
      return { success: true, data: `**${series.name}:**\n\n${lines.join("\n")}\n\nUse for Fed rate/economic prediction markets.` };
    } catch (err) {
      return { success: false, data: `BLS API error: ${err instanceof Error ? err.message : err}` };
    }
  },
};
