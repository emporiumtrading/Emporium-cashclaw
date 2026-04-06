/**
 * Live price service — replaces all hardcoded price conversions.
 *
 * Fetches ETH, NEAR, FET prices from CryptoCompare API.
 * Caches for 5 minutes to avoid excessive API calls.
 */

interface PriceCache {
  eth: number;
  near: number;
  fet: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 300_000; // 5 min
let cache: PriceCache | null = null;

// Fallback prices if API fails
const FALLBACK: PriceCache = { eth: 2050, near: 4, fet: 1.5, fetchedAt: 0 };

async function fetchPrices(): Promise<PriceCache> {
  try {
    const resp = await fetch(
      "https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD",
      { signal: AbortSignal.timeout(5000) },
    );
    const ethData = await resp.json() as { USD?: number };

    const resp2 = await fetch(
      "https://min-api.cryptocompare.com/data/price?fsym=NEAR&tsyms=USD",
      { signal: AbortSignal.timeout(5000) },
    );
    const nearData = await resp2.json() as { USD?: number };

    const resp3 = await fetch(
      "https://min-api.cryptocompare.com/data/price?fsym=FET&tsyms=USD",
      { signal: AbortSignal.timeout(5000) },
    );
    const fetData = await resp3.json() as { USD?: number };

    cache = {
      eth: ethData.USD ?? FALLBACK.eth,
      near: nearData.USD ?? FALLBACK.near,
      fet: fetData.USD ?? FALLBACK.fet,
      fetchedAt: Date.now(),
    };
    return cache;
  } catch {
    console.error("[Prices] Failed to fetch — using cached/fallback");
    return cache ?? FALLBACK;
  }
}

export async function getPrices(): Promise<PriceCache> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache;
  }
  return fetchPrices();
}

/** Synchronous price access — uses cached value or fallback */
export function getPricesSync(): PriceCache {
  return cache ?? FALLBACK;
}

export function ethToUsd(eth: number): number {
  return eth * (cache?.eth ?? FALLBACK.eth);
}

export function nearToUsd(near: number): number {
  return near * (cache?.near ?? FALLBACK.near);
}

export function fetToUsd(fet: number): number {
  return fet * (cache?.fet ?? FALLBACK.fet);
}

/** Initialize prices on startup */
export async function initPrices(): Promise<void> {
  await fetchPrices();
  // Refresh every 5 min
  setInterval(() => void fetchPrices(), CACHE_TTL_MS);
}
