import { describe, it, expect, vi } from "vitest";
import type { CashClawConfig } from "../src/config.js";

// Mock all tool modules to avoid hitting real CLIs
vi.mock("../src/moltlaunch/cli.js", () => ({
  walletShow: vi.fn().mockResolvedValue({ address: "0xtest", balance: "1.0" }),
  getTask: vi.fn().mockResolvedValue({ id: "t1", task: "test", status: "requested" }),
  quoteTask: vi.fn().mockResolvedValue(undefined),
  declineTask: vi.fn().mockResolvedValue(undefined),
  submitWork: vi.fn().mockResolvedValue(undefined),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  getBounties: vi.fn().mockResolvedValue([]),
  claimBounty: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/memory/feedback.js", () => ({
  loadFeedback: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/memory/log.js", () => ({
  appendLog: vi.fn(),
}));

vi.mock("../src/memory/search.js", () => ({
  searchMemory: vi.fn().mockReturnValue([]),
}));

import { getToolDefinitions, executeTool } from "../src/tools/registry.js";

const baseConfig: CashClawConfig = {
  agentId: "test-agent",
  llm: { provider: "anthropic", model: "test", apiKey: "test" },
  polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
  pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
  specialties: ["typescript"],
  autoQuote: true,
  autoWork: true,
  maxConcurrentTasks: 3,
  declineKeywords: [],
  learningEnabled: true,
  studyIntervalMs: 1800000,
  agentCashEnabled: false,
};

describe("getToolDefinitions", () => {
  it("returns base tools when agentCash is disabled", () => {
    const tools = getToolDefinitions(baseConfig);
    const names = tools.map((t) => t.name);

    expect(names).toContain("quote_task");
    expect(names).toContain("decline_task");
    expect(names).toContain("submit_work");
    expect(names).toContain("send_message");
    expect(names).toContain("read_task");
    expect(names).toContain("list_bounties");
    expect(names).toContain("claim_bounty");
    expect(names).toContain("check_wallet_balance");
    expect(names).toContain("read_feedback_history");
    expect(names).toContain("memory_search");
    expect(names).toContain("log_activity");

    expect(names).not.toContain("agentcash_fetch");
    expect(names).not.toContain("agentcash_balance");
  });

  it("includes agentcash tools when enabled", () => {
    const config = { ...baseConfig, agentCashEnabled: true };
    const tools = getToolDefinitions(config);
    const names = tools.map((t) => t.name);

    expect(names).toContain("agentcash_fetch");
    expect(names).toContain("agentcash_balance");
    expect(names).toContain("quote_task"); // base tools still present
  });

  it("returns valid tool definitions with schemas", () => {
    const tools = getToolDefinitions(baseConfig);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });
});

describe("executeTool", () => {
  it("returns error for unknown tool", async () => {
    const ctx = { config: baseConfig, taskId: "t1" };
    const result = await executeTool("nonexistent_tool", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.data).toContain("Unknown tool");
  });

  it("executes a known tool successfully", async () => {
    const ctx = { config: baseConfig, taskId: "t1" };
    const result = await executeTool("check_wallet_balance", {}, ctx);

    expect(result.success).toBe(true);
    expect(result.data).toContain("0xtest");
  });

  it("catches tool execution errors", async () => {
    // Override the mock to throw
    const cliMod = await import("../src/moltlaunch/cli.js");
    vi.mocked(cliMod.walletShow).mockRejectedValueOnce(new Error("CLI not found"));

    const ctx = { config: baseConfig, taskId: "t1" };
    const result = await executeTool("check_wallet_balance", {}, ctx);

    expect(result.success).toBe(false);
    expect(result.data).toContain("Tool error");
  });
});
