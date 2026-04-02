/**
 * SQLite database for Melista.
 *
 * Stores tasks, revenue, clients, knowledge, feedback, chat, sessions, and logs.
 * Lives on the Fly persistent volume at /data/melista/melista.db (or locally at ~/.melista/).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "../config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.join(getConfigDir(), "melista.db");
  db = new Database(dbPath);

  // Performance: WAL mode for concurrent reads + writes
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  initSchema(db);
  return db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    -- Tasks: complete history of all tasks across all marketplaces
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      marketplace TEXT NOT NULL DEFAULT 'moltlaunch',
      global_id TEXT UNIQUE,
      client_address TEXT,
      description TEXT,
      status TEXT NOT NULL,
      category TEXT,
      skills_matched TEXT, -- JSON array
      quoted_price TEXT,
      quoted_currency TEXT DEFAULT 'ETH',
      quoted_usd REAL,
      quoted_at INTEGER,
      accepted_at INTEGER,
      submitted_at INTEGER,
      completed_at INTEGER,
      rated_score INTEGER,
      rated_comment TEXT,
      result_preview TEXT, -- first 500 chars of deliverable
      llm_tokens_used INTEGER DEFAULT 0,
      llm_cost_usd REAL DEFAULT 0,
      loop_turns INTEGER DEFAULT 0,
      tools_used TEXT, -- JSON array
      revenue_eth TEXT,
      revenue_usd REAL,
      profit_usd REAL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Revenue: daily aggregated revenue tracking
    CREATE TABLE IF NOT EXISTS revenue (
      date TEXT PRIMARY KEY, -- YYYY-MM-DD
      tasks_completed INTEGER DEFAULT 0,
      tasks_quoted INTEGER DEFAULT 0,
      tasks_declined INTEGER DEFAULT 0,
      revenue_eth TEXT DEFAULT '0',
      revenue_usd REAL DEFAULT 0,
      costs_usd REAL DEFAULT 0,
      profit_usd REAL DEFAULT 0,
      avg_task_usd REAL DEFAULT 0,
      marketplace_breakdown TEXT, -- JSON: { moltlaunch: 5, near: 3, ... }
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Clients: repeat client tracking
    CREATE TABLE IF NOT EXISTS clients (
      address TEXT PRIMARY KEY,
      first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL,
      total_tasks INTEGER DEFAULT 0,
      completed_tasks INTEGER DEFAULT 0,
      total_revenue_usd REAL DEFAULT 0,
      avg_rating REAL,
      marketplace TEXT,
      notes TEXT
    );

    -- Knowledge: self-study insights (replaces knowledge.json)
    CREATE TABLE IF NOT EXISTS knowledge (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      specialty TEXT NOT NULL,
      insight TEXT NOT NULL,
      source TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Feedback: client ratings (replaces feedback.json)
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      task_description TEXT,
      score INTEGER NOT NULL,
      comments TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Chat: operator chat history (replaces chat.json)
    CREATE TABLE IF NOT EXISTS chat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL, -- 'user' or 'assistant'
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Sessions: auth sessions (replaces in-memory map)
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    -- Activity log
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL, -- YYYY-MM-DD
      type TEXT, -- poll, loop, tool, error, study, ws
      task_id TEXT,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Wallets: history of all wallets used
    CREATE TABLE IF NOT EXISTS wallets (
      address TEXT PRIMARY KEY,
      registered_agent_id TEXT,
      balance_snapshot TEXT,
      last_checked INTEGER,
      is_active INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Indexes for common queries
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_marketplace ON tasks(marketplace);
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_client ON tasks(client_address);
    CREATE INDEX IF NOT EXISTS idx_revenue_date ON revenue(date);
    CREATE INDEX IF NOT EXISTS idx_feedback_score ON feedback(score);
    CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);
}

/** Migrate existing JSON data into SQLite (run once) */
export function migrateFromJson(db: Database.Database): void {
  const configDir = getConfigDir();

  // Migrate knowledge.json
  const knowledgePath = path.join(configDir, "knowledge.json");
  if (fs.existsSync(knowledgePath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(knowledgePath, "utf-8")) as Array<{
        id: string; topic: string; specialty: string; insight: string; source: string; timestamp: number;
      }>;
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO knowledge (id, topic, specialty, insight, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const e of entries) {
        stmt.run(e.id, e.topic, e.specialty, e.insight, e.source, e.timestamp);
      }
      // Rename to .bak so we don't re-migrate
      fs.renameSync(knowledgePath, knowledgePath + ".migrated");
    } catch { /* ignore migration errors */ }
  }

  // Migrate feedback.json
  const feedbackPath = path.join(configDir, "feedback.json");
  if (fs.existsSync(feedbackPath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(feedbackPath, "utf-8")) as Array<{
        taskId: string; taskDescription: string; score: number; comments: string; timestamp: number;
      }>;
      const stmt = db.prepare(
        "INSERT OR IGNORE INTO feedback (task_id, task_description, score, comments, created_at) VALUES (?, ?, ?, ?, ?)"
      );
      for (const e of entries) {
        stmt.run(e.taskId, e.taskDescription, e.score, e.comments, e.timestamp);
      }
      fs.renameSync(feedbackPath, feedbackPath + ".migrated");
    } catch { /* ignore */ }
  }

  // Migrate chat.json
  const chatPath = path.join(configDir, "chat.json");
  if (fs.existsSync(chatPath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(chatPath, "utf-8")) as Array<{
        role: string; content: string; timestamp: number;
      }>;
      const stmt = db.prepare(
        "INSERT INTO chat (role, content, created_at) VALUES (?, ?, ?)"
      );
      for (const e of entries) {
        stmt.run(e.role, e.content, e.timestamp);
      }
      fs.renameSync(chatPath, chatPath + ".migrated");
    } catch { /* ignore */ }
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
