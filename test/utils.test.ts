import { describe, it, expect, vi } from "vitest";
import { extractText, withRetry } from "../src/utils.js";
import type { ContentBlock } from "../src/llm/types.js";

describe("extractText", () => {
  it("extracts text from mixed content blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "Hello " },
      { type: "tool_use", id: "tc-1", name: "quote_task", input: { task_id: "1" } },
      { type: "text", text: "world" },
    ];

    expect(extractText(blocks)).toBe("Hello world");
  });

  it("returns empty string when no text blocks", () => {
    const blocks: ContentBlock[] = [
      { type: "tool_use", id: "tc-1", name: "quote_task", input: {} },
      { type: "tool_use", id: "tc-2", name: "decline_task", input: {} },
    ];

    expect(extractText(blocks)).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(extractText([])).toBe("");
  });

  it("concatenates multiple text blocks without separator", () => {
    const blocks: ContentBlock[] = [
      { type: "text", text: "foo" },
      { type: "text", text: "bar" },
      { type: "text", text: "baz" },
    ];

    expect(extractText(blocks)).toBe("foobarbaz");
  });
});

describe("withRetry", () => {
  it("succeeds on first try", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("succeeds after failures", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, { retries: 3, baseDelayMs: 1 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow("persistent failure");

    // 1 initial attempt + 2 retries = 3 calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("uses default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("default");
    // Use real timers but mock setTimeout to avoid actual delays
    vi.useFakeTimers();
    const promise = withRetry(fn);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe("default");
    vi.useRealTimers();
  });

  it("respects maxDelayMs cap", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("ok");

    vi.useFakeTimers();
    const promise = withRetry(fn, { retries: 1, baseDelayMs: 100, maxDelayMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;
    expect(result).toBe("ok");
    vi.useRealTimers();
  });
});
