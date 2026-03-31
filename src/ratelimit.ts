import type http from "node:http";
import { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } from "./constants.js";

/**
 * Simple in-memory sliding-window rate limiter keyed by IP.
 * Returns true if the request is allowed, false if rate-limited (429 sent).
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Periodically clean up expired buckets to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) {
      buckets.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function getClientKey(req: http.IncomingMessage): string {
  // Use X-Forwarded-For if behind a proxy, otherwise remote address
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

export function checkRateLimit(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
  windowMs = RATE_LIMIT_WINDOW_MS,
): boolean {
  const key = getClientKey(req);
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count++;

  res.setHeader("X-RateLimit-Limit", maxRequests);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - bucket.count));
  res.setHeader("X-RateLimit-Reset", Math.ceil(bucket.resetAt / 1000));

  if (bucket.count > maxRequests) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many requests. Please try again later." }));
    return false;
  }

  return true;
}
