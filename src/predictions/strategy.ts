/**
 * Prediction Market Strategy — risk-managed trading.
 *
 * Core principles:
 * 1. Never bet more than we can afford to lose
 * 2. Size positions based on confidence and bankroll
 * 3. Diversify across markets — never all-in on one bet
 * 4. Track P&L rigorously in SQLite
 * 5. Research before every trade — use Melista's analysis capabilities
 */
import { getDb } from "../db/index.js";

export interface PredictionConfig {
  /** Maximum % of balance to risk on a single trade */
  maxPositionPct: number;
  /** Maximum total exposure across all positions */
  maxTotalExposurePct: number;
  /** Minimum confidence threshold to place a trade (0-1) */
  minConfidence: number;
  /** Maximum number of concurrent positions */
  maxPositions: number;
  /** Stop loss percentage (close if down this much) */
  stopLossPct: number;
  /** Daily loss limit in USD */
  dailyLossLimitUsd: number;
}

export const DEFAULT_PREDICTION_CONFIG: PredictionConfig = {
  maxPositionPct: 10,          // Max 10% of balance per trade ($1 on $10)
  maxTotalExposurePct: 50,     // Max 50% of balance exposed (aggressive with small bankroll)
  minConfidence: 0.85,         // Only trade when 85%+ confident — high conviction only
  maxPositions: 5,             // Max 5 concurrent positions
  stopLossPct: 25,             // Stop loss at 25% down
  dailyLossLimitUsd: 3,       // Stop trading if down $3 in a day (30% of $10)
};

export interface Position {
  id: string;
  market: string;
  platform: string;
  outcome: string;
  entryPrice: number;
  quantity: number;
  costBasis: number;
  currentValue: number;
  confidence: number;
  thesis: string;
  openedAt: number;
  closedAt?: number;
  pnl?: number;
  status: "open" | "closed" | "stopped";
  mode: "paper" | "live";
  lessonLearned?: string;
}

// --- SQLite schema for predictions ---

export function initPredictionsTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      platform TEXT NOT NULL,
      outcome TEXT NOT NULL,
      entry_price REAL NOT NULL,
      quantity REAL NOT NULL,
      cost_basis REAL NOT NULL,
      current_value REAL DEFAULT 0,
      confidence REAL NOT NULL,
      thesis TEXT,
      status TEXT DEFAULT 'open',
      pnl REAL DEFAULT 0,
      mode TEXT DEFAULT 'paper',
      lesson_learned TEXT,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS prediction_daily (
      date TEXT PRIMARY KEY,
      trades_placed INTEGER DEFAULT 0,
      trades_won INTEGER DEFAULT 0,
      trades_lost INTEGER DEFAULT 0,
      paper_trades INTEGER DEFAULT 0,
      paper_won INTEGER DEFAULT 0,
      total_wagered REAL DEFAULT 0,
      total_pnl REAL DEFAULT 0,
      paper_pnl REAL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
    CREATE INDEX IF NOT EXISTS idx_predictions_platform ON predictions(platform);
  `);
}

// --- Risk Check ---

export function canPlaceTrade(
  config: PredictionConfig,
  balance: number,
  proposedAmount: number,
  confidence: number,
): { allowed: boolean; reason?: string } {
  // Check confidence threshold
  if (confidence < config.minConfidence) {
    return { allowed: false, reason: `Confidence ${(confidence * 100).toFixed(0)}% below minimum ${(config.minConfidence * 100).toFixed(0)}%` };
  }

  // Check position size
  const maxPosition = balance * (config.maxPositionPct / 100);
  if (proposedAmount > maxPosition) {
    return { allowed: false, reason: `Amount $${proposedAmount.toFixed(2)} exceeds max position $${maxPosition.toFixed(2)} (${config.maxPositionPct}% of $${balance.toFixed(2)})` };
  }

  // Check total exposure
  const db = getDb();
  const openPositions = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(cost_basis), 0) as exposure FROM predictions WHERE status = 'open'").get() as { count: number; exposure: number };

  if (openPositions.count >= config.maxPositions) {
    return { allowed: false, reason: `Already have ${openPositions.count}/${config.maxPositions} open positions` };
  }

  const totalExposure = openPositions.exposure + proposedAmount;
  const maxExposure = balance * (config.maxTotalExposurePct / 100);
  if (totalExposure > maxExposure) {
    return { allowed: false, reason: `Total exposure $${totalExposure.toFixed(2)} would exceed max $${maxExposure.toFixed(2)} (${config.maxTotalExposurePct}%)` };
  }

  // Check daily loss limit
  const today = new Date().toISOString().slice(0, 10);
  const dailyPnl = db.prepare("SELECT COALESCE(total_pnl, 0) as pnl FROM prediction_daily WHERE date = ?").get(today) as { pnl: number } | undefined;
  if (dailyPnl && dailyPnl.pnl < -config.dailyLossLimitUsd) {
    return { allowed: false, reason: `Daily loss limit reached: $${Math.abs(dailyPnl.pnl).toFixed(2)} lost today (limit: $${config.dailyLossLimitUsd})` };
  }

  return { allowed: true };
}

// --- Record Keeping ---

export function recordTrade(position: Position): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO predictions (id, market, platform, outcome, entry_price, quantity, cost_basis, current_value, confidence, thesis, status, pnl, mode, lesson_learned, opened_at, closed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(position.id, position.market, position.platform, position.outcome, position.entryPrice, position.quantity, position.costBasis, position.currentValue, position.confidence, position.thesis, position.status, position.pnl ?? 0, position.mode ?? "paper", position.lessonLearned ?? null, position.openedAt, position.closedAt ?? null);

  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT OR IGNORE INTO prediction_daily (date) VALUES (?)`).run(today);

  if (position.mode === "paper") {
    db.prepare(`UPDATE prediction_daily SET paper_trades = paper_trades + 1, updated_at = ? WHERE date = ?`).run(Date.now(), today);
  } else {
    db.prepare(`UPDATE prediction_daily SET trades_placed = trades_placed + 1, total_wagered = total_wagered + ?, updated_at = ? WHERE date = ?`)
      .run(position.costBasis, Date.now(), today);
  }
}

export function closeTrade(id: string, pnl: number, lesson?: string): void {
  const db = getDb();
  const status = pnl >= 0 ? "closed" : "stopped";
  const position = db.prepare("SELECT mode FROM predictions WHERE id = ?").get(id) as { mode: string } | undefined;
  const mode = position?.mode ?? "paper";

  db.prepare("UPDATE predictions SET status = ?, pnl = ?, current_value = cost_basis + ?, closed_at = ?, lesson_learned = ? WHERE id = ?")
    .run(status, pnl, pnl, Date.now(), lesson ?? null, id);

  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`INSERT OR IGNORE INTO prediction_daily (date) VALUES (?)`).run(today);

  if (mode === "paper") {
    if (pnl >= 0) {
      db.prepare("UPDATE prediction_daily SET paper_won = paper_won + 1, paper_pnl = paper_pnl + ?, updated_at = ? WHERE date = ?").run(pnl, Date.now(), today);
    } else {
      db.prepare("UPDATE prediction_daily SET paper_pnl = paper_pnl + ?, updated_at = ? WHERE date = ?").run(pnl, Date.now(), today);
    }
  } else {
    if (pnl >= 0) {
      db.prepare("UPDATE prediction_daily SET trades_won = trades_won + 1, total_pnl = total_pnl + ?, updated_at = ? WHERE date = ?").run(pnl, Date.now(), today);
    } else {
      db.prepare("UPDATE prediction_daily SET trades_lost = trades_lost + 1, total_pnl = total_pnl + ?, updated_at = ? WHERE date = ?").run(pnl, Date.now(), today);
    }
  }
}

/** Get lessons learned from past paper trades */
export function getLessonsLearned(limit = 10): Array<{ market: string; outcome: string; pnl: number; confidence: number; lesson: string }> {
  return getDb().prepare(`
    SELECT market, outcome, pnl, confidence, lesson_learned as lesson
    FROM predictions WHERE lesson_learned IS NOT NULL AND lesson_learned != ''
    ORDER BY closed_at DESC LIMIT ?
  `).all(limit) as Array<{ market: string; outcome: string; pnl: number; confidence: number; lesson: string }>;
}

/** Get paper trading stats separately */
export function getPaperStats(): { totalPaper: number; paperWins: number; paperPnl: number; winRate: number } {
  const db = getDb();
  const stats = db.prepare(`
    SELECT COUNT(*) as total,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0) as wins,
      COALESCE(SUM(pnl), 0) as pnl
    FROM predictions WHERE mode = 'paper' AND status != 'open'
  `).get() as { total: number; wins: number; pnl: number };
  return {
    totalPaper: stats.total,
    paperWins: stats.wins,
    paperPnl: stats.pnl,
    winRate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
  };
}

// --- Query ---

export function getOpenPositions(): Position[] {
  return getDb().prepare("SELECT * FROM predictions WHERE status = 'open' ORDER BY opened_at DESC").all() as Position[];
}

export function getAllPositions(limit = 50): Position[] {
  return getDb().prepare("SELECT * FROM predictions ORDER BY opened_at DESC LIMIT ?").all(limit) as Position[];
}

export function getPredictionStats(): {
  openPositions: number;
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  totalWagered: number;
  bestTrade: number;
  worstTrade: number;
} {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as totalTrades,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) as openPositions,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END), 0) as wins,
      COALESCE(SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END), 0) as losses,
      COALESCE(SUM(pnl), 0) as totalPnl,
      COALESCE(SUM(cost_basis), 0) as totalWagered,
      COALESCE(MAX(pnl), 0) as bestTrade,
      COALESCE(MIN(pnl), 0) as worstTrade
    FROM predictions
  `).get() as { totalTrades: number; openPositions: number; wins: number; losses: number; totalPnl: number; totalWagered: number; bestTrade: number; worstTrade: number };

  const closed = stats.wins + stats.losses;
  return {
    ...stats,
    winRate: closed > 0 ? (stats.wins / closed) * 100 : 0,
  };
}

export function getDailyPnl(days = 30): Array<{ date: string; trades_placed: number; total_pnl: number; total_wagered: number }> {
  return getDb().prepare("SELECT * FROM prediction_daily ORDER BY date DESC LIMIT ?").all(days) as Array<{ date: string; trades_placed: number; total_pnl: number; total_wagered: number }>;
}
