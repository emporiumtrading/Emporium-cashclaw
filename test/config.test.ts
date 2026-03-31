import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We need to intercept the config dir before importing config.
// The module uses os.homedir() at import time to build CONFIG_DIR.
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cashclaw-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Mock os.homedir to return our temp dir so CONFIG_DIR resolves there
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => tmpDir,
    },
  };
});

// Re-import config fresh for each test to pick up the mocked homedir
// Since vi.mock is hoisted, we import normally and rely on resetModules
describe("config", () => {
  // We need to dynamically import to get fresh module state each time
  async function getConfigModule() {
    // Reset the module registry so each call gets a fresh import
    vi.resetModules();
    // Re-set the homedir mock since resetModules clears it
    vi.doMock("node:os", () => ({
      default: { ...os, homedir: () => tmpDir },
      homedir: () => tmpDir,
    }));
    const mod = await import("../src/config.js");
    return mod;
  }

  it("loadConfig returns null when no config file exists", async () => {
    const { loadConfig } = await getConfigModule();
    expect(loadConfig()).toBeNull();
  });

  it("saveConfig creates file and loadConfig reads it back", async () => {
    const { saveConfig, loadConfig } = await getConfigModule();

    const config = {
      agentId: "agent-1",
      llm: { provider: "anthropic" as const, model: "claude-sonnet-4-20250514", apiKey: "sk-test" },
      polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
      pricing: { strategy: "fixed" as const, baseRateEth: "0.005", maxRateEth: "0.05" },
      specialties: ["typescript"],
      autoQuote: true,
      autoWork: true,
      maxConcurrentTasks: 3,
      declineKeywords: [],
      learningEnabled: true,
      studyIntervalMs: 1_800_000,
      agentCashEnabled: false,
    };

    saveConfig(config);
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("agent-1");
    expect(loaded!.llm.apiKey).toBe("sk-test");
    expect(loaded!.specialties).toEqual(["typescript"]);
  });

  it("isConfigured returns false without required fields", async () => {
    const { isConfigured } = await getConfigModule();
    // No config file at all
    expect(isConfigured()).toBe(false);
  });

  it("isConfigured returns true with required fields", async () => {
    const { saveConfig, isConfigured } = await getConfigModule();

    saveConfig({
      agentId: "agent-1",
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-test" },
      polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
      pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
      specialties: [],
      autoQuote: true,
      autoWork: true,
      maxConcurrentTasks: 3,
      declineKeywords: [],
      learningEnabled: true,
      studyIntervalMs: 1_800_000,
      agentCashEnabled: false,
    });

    expect(isConfigured()).toBe(true);
  });

  it("isConfigured returns false when agentId is empty", async () => {
    const { saveConfig, isConfigured } = await getConfigModule();

    saveConfig({
      agentId: "",
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-test" },
      polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
      pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
      specialties: [],
      autoQuote: true,
      autoWork: true,
      maxConcurrentTasks: 3,
      declineKeywords: [],
      learningEnabled: true,
      studyIntervalMs: 1_800_000,
      agentCashEnabled: false,
    });

    expect(isConfigured()).toBe(false);
  });

  it("savePartialConfig merges with defaults when no existing config", async () => {
    const { savePartialConfig } = await getConfigModule();

    const result = savePartialConfig({ agentId: "partial-agent" });
    expect(result.agentId).toBe("partial-agent");
    // Should have defaults for other fields
    expect(result.polling.intervalMs).toBe(30000);
    expect(result.autoQuote).toBe(true);
    expect(result.maxConcurrentTasks).toBe(3);
  });

  it("savePartialConfig merges with existing config", async () => {
    const { saveConfig, savePartialConfig, loadConfig } = await getConfigModule();

    // Save initial config
    saveConfig({
      agentId: "existing-agent",
      llm: { provider: "anthropic", model: "claude-sonnet-4-20250514", apiKey: "sk-old" },
      polling: { intervalMs: 30000, urgentIntervalMs: 10000 },
      pricing: { strategy: "fixed", baseRateEth: "0.005", maxRateEth: "0.05" },
      specialties: ["typescript"],
      autoQuote: true,
      autoWork: true,
      maxConcurrentTasks: 3,
      declineKeywords: [],
      learningEnabled: true,
      studyIntervalMs: 1_800_000,
      agentCashEnabled: false,
    });

    // Partially update
    const result = savePartialConfig({ specialties: ["rust", "go"] });
    expect(result.agentId).toBe("existing-agent");
    expect(result.specialties).toEqual(["rust", "go"]);

    // Verify persisted
    const loaded = loadConfig();
    expect(loaded!.specialties).toEqual(["rust", "go"]);
  });

  it("initConfig creates a full config with model defaults", async () => {
    const { initConfig, loadConfig } = await getConfigModule();

    const config = initConfig({
      agentId: "init-agent",
      provider: "anthropic",
      apiKey: "sk-init",
    });

    expect(config.agentId).toBe("init-agent");
    expect(config.llm.model).toBe("claude-sonnet-4-20250514");
    expect(config.llm.provider).toBe("anthropic");
    expect(config.autoQuote).toBe(true);
    expect(config.learningEnabled).toBe(true);

    // Also persisted to disk
    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("init-agent");
  });

  it("initConfig uses openai model default", async () => {
    const { initConfig } = await getConfigModule();

    const config = initConfig({
      agentId: "openai-agent",
      provider: "openai",
      apiKey: "sk-openai",
    });

    expect(config.llm.model).toBe("gpt-4o");
  });

  it("initConfig uses custom model when provided", async () => {
    const { initConfig } = await getConfigModule();

    const config = initConfig({
      agentId: "custom-agent",
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      apiKey: "sk-custom",
      specialties: ["python"],
    });

    expect(config.llm.model).toBe("claude-opus-4-20250514");
    expect(config.specialties).toEqual(["python"]);
  });

  it("requireConfig throws when no config exists", async () => {
    const { requireConfig } = await getConfigModule();
    expect(() => requireConfig()).toThrow("No config found");
  });
});
