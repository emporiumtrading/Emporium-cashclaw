import { describe, it, expect, vi, beforeEach } from "vitest";
import type http from "node:http";

// Mock constants before importing the module
vi.mock("../src/constants.js", () => ({
  RATE_LIMIT_WINDOW_MS: 1000,
  RATE_LIMIT_MAX_REQUESTS: 3,
}));

import { checkRateLimit } from "../src/ratelimit.js";

function createMockReq(ip = "127.0.0.1"): http.IncomingMessage {
  return {
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as http.IncomingMessage;
}

function createMockRes(): http.ServerResponse & { statusCode: number; body: string; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name: string, value: string | number) {
      headers[name] = String(value);
    },
    writeHead(status: number) {
      res.statusCode = status;
    },
    end(data?: string) {
      res.body = data ?? "";
    },
  };
  return res as unknown as http.ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    // Reset module state between tests by advancing time past any existing windows
    vi.useFakeTimers();
    vi.advanceTimersByTime(10_000);
    vi.useRealTimers();
  });

  it("allows requests under the limit", () => {
    vi.useFakeTimers();
    const req = createMockReq("10.0.0.1");
    const res = createMockRes();

    const allowed = checkRateLimit(req, res, 3, 1000);
    expect(allowed).toBe(true);
    expect(res.headers["X-RateLimit-Limit"]).toBe("3");
    expect(res.headers["X-RateLimit-Remaining"]).toBe("2");
    vi.useRealTimers();
  });

  it("returns 429 when limit exceeded", () => {
    vi.useFakeTimers();
    const ip = "10.0.0.2";

    // Make 3 requests (the limit)
    for (let i = 0; i < 3; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      checkRateLimit(req, res, 3, 1000);
    }

    // 4th request should be blocked
    const req = createMockReq(ip);
    const res = createMockRes();
    const allowed = checkRateLimit(req, res, 3, 1000);

    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toContain("Too many requests");
    vi.useRealTimers();
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    const ip = "10.0.0.3";

    // Exhaust the limit
    for (let i = 0; i < 4; i++) {
      checkRateLimit(createMockReq(ip), createMockRes(), 3, 1000);
    }

    // Advance past window
    vi.advanceTimersByTime(1500);

    // Should be allowed again
    const req = createMockReq(ip);
    const res = createMockRes();
    const allowed = checkRateLimit(req, res, 3, 1000);

    expect(allowed).toBe(true);
    expect(res.headers["X-RateLimit-Remaining"]).toBe("2");
    vi.useRealTimers();
  });

  it("tracks different IPs separately", () => {
    vi.useFakeTimers();
    // Exhaust limit for IP A
    for (let i = 0; i < 4; i++) {
      checkRateLimit(createMockReq("10.0.0.4"), createMockRes(), 3, 1000);
    }

    // IP B should still be allowed
    const req = createMockReq("10.0.0.5");
    const res = createMockRes();
    const allowed = checkRateLimit(req, res, 3, 1000);

    expect(allowed).toBe(true);
    vi.useRealTimers();
  });

  it("uses X-Forwarded-For header when present", () => {
    vi.useFakeTimers();
    const req = createMockReq("127.0.0.1");
    (req.headers as Record<string, string>)["x-forwarded-for"] = "203.0.113.50, 70.41.3.18";
    const res = createMockRes();

    const allowed = checkRateLimit(req, res, 3, 1000);
    expect(allowed).toBe(true);
    vi.useRealTimers();
  });
});
