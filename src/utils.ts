import type http from "node:http";
import type { ContentBlock } from "./llm/types.js";

/**
 * Extract text content from LLM content blocks.
 * Replaces the repeated filter→map→join pattern across the codebase.
 */
export function extractText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Require a specific HTTP method, returning a JSON 405 error if mismatched.
 * Returns true if the method matches, false if a 405 was sent.
 */
export function requireMethod(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  method: string,
): boolean {
  if (req.method === method) return true;
  res.writeHead(405, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: `${method} only` }));
  return false;
}

/**
 * Retry an async operation with exponential backoff.
 * Useful for transient network failures on external API calls.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 1000, maxDelayMs = 10_000 } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
