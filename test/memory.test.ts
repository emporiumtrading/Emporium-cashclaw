import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cashclaw-mem-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper to get fresh module imports with mocked homedir
async function freshImport<T>(modulePath: string): Promise<T> {
  vi.resetModules();
  vi.doMock("node:os", () => ({
    default: { ...os, homedir: () => tmpDir },
    homedir: () => tmpDir,
  }));
  // Mock the search module to avoid side-effect errors
  vi.doMock("../src/memory/search.js", () => ({
    invalidateIndex: vi.fn(),
  }));
  return await import(modulePath) as T;
}

// ─── knowledge.ts ───────────────────────────────────────────────────────────

describe("knowledge", () => {
  type KnowledgeMod = typeof import("../src/memory/knowledge.js");

  function makeEntry(overrides: Partial<import("../src/memory/knowledge.js").KnowledgeEntry> = {}): import("../src/memory/knowledge.js").KnowledgeEntry {
    return {
      id: `k-${Math.random().toString(36).slice(2, 8)}`,
      topic: "specialty_research",
      specialty: "typescript",
      insight: "Use strict mode for safety",
      source: "test",
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it("loadKnowledge returns empty array when no file exists", async () => {
    const { loadKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");
    expect(loadKnowledge()).toEqual([]);
  });

  it("storeKnowledge persists and can be loaded back", async () => {
    const { storeKnowledge, loadKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    const entry = makeEntry({ id: "k-1", insight: "Type narrowing is powerful" });
    storeKnowledge(entry);

    // Reload from a fresh import to prove it's on disk
    const { loadKnowledge: loadKnowledge2 } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");
    const entries = loadKnowledge2();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("k-1");
    expect(entries[0].insight).toBe("Type narrowing is powerful");
  });

  it("trims to MAX_KNOWLEDGE_ENTRIES (50)", async () => {
    const { storeKnowledge, loadKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    // Store 55 entries — only last 50 should remain
    for (let i = 0; i < 55; i++) {
      storeKnowledge(makeEntry({ id: `k-${i}`, insight: `insight-${i}` }));
    }

    const entries = loadKnowledge();
    expect(entries).toHaveLength(50);
    // First 5 should have been trimmed; remaining start at index 5
    expect(entries[0].id).toBe("k-5");
    expect(entries[49].id).toBe("k-54");
  });

  it("deleteKnowledge removes by id", async () => {
    const { storeKnowledge, deleteKnowledge, loadKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    storeKnowledge(makeEntry({ id: "k-del-1" }));
    storeKnowledge(makeEntry({ id: "k-del-2" }));
    storeKnowledge(makeEntry({ id: "k-del-3" }));

    const removed = deleteKnowledge("k-del-2");
    expect(removed).toBe(true);

    const entries = loadKnowledge();
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.id === "k-del-2")).toBeUndefined();
  });

  it("deleteKnowledge returns false for non-existent id", async () => {
    const { deleteKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");
    expect(deleteKnowledge("non-existent")).toBe(false);
  });

  it("getRelevantKnowledge filters by specialty", async () => {
    const { storeKnowledge, getRelevantKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    storeKnowledge(makeEntry({ id: "k-ts", specialty: "typescript", timestamp: 100 }));
    storeKnowledge(makeEntry({ id: "k-rs", specialty: "rust", timestamp: 200 }));
    storeKnowledge(makeEntry({ id: "k-py", specialty: "python", timestamp: 300 }));
    storeKnowledge(makeEntry({ id: "k-gen", specialty: "general", timestamp: 400 }));

    const relevant = getRelevantKnowledge(["typescript"]);
    // Should include "typescript" and "general" entries
    expect(relevant).toHaveLength(2);
    const ids = relevant.map((e) => e.id);
    expect(ids).toContain("k-ts");
    expect(ids).toContain("k-gen");
  });

  it("getRelevantKnowledge returns most recent first", async () => {
    const { storeKnowledge, getRelevantKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    storeKnowledge(makeEntry({ id: "k-old", specialty: "typescript", timestamp: 100 }));
    storeKnowledge(makeEntry({ id: "k-new", specialty: "typescript", timestamp: 999 }));

    const relevant = getRelevantKnowledge(["typescript"]);
    expect(relevant[0].id).toBe("k-new");
    expect(relevant[1].id).toBe("k-old");
  });

  it("getRelevantKnowledge respects limit", async () => {
    const { storeKnowledge, getRelevantKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    for (let i = 0; i < 10; i++) {
      storeKnowledge(makeEntry({ id: `k-${i}`, specialty: "typescript", timestamp: i }));
    }

    const relevant = getRelevantKnowledge(["typescript"], 3);
    expect(relevant).toHaveLength(3);
  });

  it("getRelevantKnowledge is case-insensitive", async () => {
    const { storeKnowledge, getRelevantKnowledge } = await freshImport<KnowledgeMod>("../src/memory/knowledge.js");

    storeKnowledge(makeEntry({ id: "k-ts", specialty: "TypeScript", timestamp: 100 }));

    const relevant = getRelevantKnowledge(["typescript"]);
    expect(relevant).toHaveLength(1);
  });
});

// ─── feedback.ts ────────────────────────────────────────────────────────────

describe("feedback", () => {
  type FeedbackMod = typeof import("../src/memory/feedback.js");

  function makeFeedback(overrides: Partial<import("../src/memory/feedback.js").FeedbackEntry> = {}): import("../src/memory/feedback.js").FeedbackEntry {
    return {
      taskId: `task-${Math.random().toString(36).slice(2, 8)}`,
      taskDescription: "Test task",
      score: 4,
      comments: "Good work",
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it("loadFeedback returns empty array when no file exists", async () => {
    const { loadFeedback } = await freshImport<FeedbackMod>("../src/memory/feedback.js");
    expect(loadFeedback()).toEqual([]);
  });

  it("storeFeedback persists and can be loaded back", async () => {
    const { storeFeedback, loadFeedback } = await freshImport<FeedbackMod>("../src/memory/feedback.js");

    const entry = makeFeedback({ taskId: "t-1", score: 5 });
    storeFeedback(entry);

    const { loadFeedback: loadFeedback2 } = await freshImport<FeedbackMod>("../src/memory/feedback.js");
    const entries = loadFeedback2();
    expect(entries).toHaveLength(1);
    expect(entries[0].taskId).toBe("t-1");
    expect(entries[0].score).toBe(5);
  });

  it("getFeedbackStats returns zeros for empty feedback", async () => {
    const { getFeedbackStats } = await freshImport<FeedbackMod>("../src/memory/feedback.js");
    const stats = getFeedbackStats();
    expect(stats).toEqual({ totalTasks: 0, avgScore: 0, completionRate: 0 });
  });

  it("getFeedbackStats calculates correctly", async () => {
    const { storeFeedback, getFeedbackStats } = await freshImport<FeedbackMod>("../src/memory/feedback.js");

    storeFeedback(makeFeedback({ score: 5 }));
    storeFeedback(makeFeedback({ score: 3 }));
    storeFeedback(makeFeedback({ score: 0 })); // score 0 means not scored

    const stats = getFeedbackStats();
    expect(stats.totalTasks).toBe(3);
    // avgScore should be average of scored entries (5 + 3) / 2 = 4.0
    expect(stats.avgScore).toBe(4);
    // completionRate: 2 scored out of 3 total = 67%
    expect(stats.completionRate).toBe(67);
  });

  it("getFeedbackStats handles all-scored entries", async () => {
    const { storeFeedback, getFeedbackStats } = await freshImport<FeedbackMod>("../src/memory/feedback.js");

    storeFeedback(makeFeedback({ score: 4 }));
    storeFeedback(makeFeedback({ score: 5 }));

    const stats = getFeedbackStats();
    expect(stats.totalTasks).toBe(2);
    expect(stats.avgScore).toBe(4.5);
    expect(stats.completionRate).toBe(100);
  });
});

// ─── chat.ts ────────────────────────────────────────────────────────────────

describe("chat", () => {
  type ChatMod = typeof import("../src/memory/chat.js");

  function makeMessage(overrides: Partial<import("../src/memory/chat.js").ChatMessage> = {}): import("../src/memory/chat.js").ChatMessage {
    return {
      role: "user",
      content: "Hello",
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it("loadChat returns empty array when no file exists", async () => {
    const { loadChat } = await freshImport<ChatMod>("../src/memory/chat.js");
    expect(loadChat()).toEqual([]);
  });

  it("appendChat persists messages", async () => {
    const { appendChat } = await freshImport<ChatMod>("../src/memory/chat.js");

    appendChat(makeMessage({ content: "Hi there" }));
    appendChat(makeMessage({ role: "assistant", content: "Hello!" }));

    const { loadChat } = await freshImport<ChatMod>("../src/memory/chat.js");
    const messages = loadChat();
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe("Hi there");
    expect(messages[1].role).toBe("assistant");
  });

  it("clearChat empties the list", async () => {
    const { appendChat, clearChat, loadChat } = await freshImport<ChatMod>("../src/memory/chat.js");

    appendChat(makeMessage({ content: "message 1" }));
    appendChat(makeMessage({ content: "message 2" }));
    clearChat();

    const messages = loadChat();
    expect(messages).toEqual([]);
  });

  it("clearChat is a no-op when no file exists", async () => {
    const { clearChat, loadChat } = await freshImport<ChatMod>("../src/memory/chat.js");
    // Should not throw
    clearChat();
    expect(loadChat()).toEqual([]);
  });

  it("trims to MAX_CHAT_MESSAGES (100)", async () => {
    const { appendChat } = await freshImport<ChatMod>("../src/memory/chat.js");

    for (let i = 0; i < 110; i++) {
      appendChat(makeMessage({ content: `msg-${i}`, timestamp: i }));
    }

    const { loadChat } = await freshImport<ChatMod>("../src/memory/chat.js");
    const messages = loadChat();
    expect(messages).toHaveLength(100);
    // First 10 should have been trimmed
    expect(messages[0].content).toBe("msg-10");
    expect(messages[99].content).toBe("msg-109");
  });
});
