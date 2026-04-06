/**
 * LLM Cost Tracking — monitors API spend vs revenue.
 *
 * Melista must earn more than it spends on LLM calls.
 * This module tracks every token used and provides
 * real-time cost awareness for decision-making.
 */
import { getDb } from "./index.js";

// Claude Sonnet 4 pricing
const INPUT_COST_PER_1M = 3.00;   // $3.00 per 1M input tokens
const OUTPUT_COST_PER_1M = 15.00;  // $15.00 per 1M output tokens

export interface CostSnapshot {
  todayInputTokens: number;
  todayOutputTokens: number;
  todayCostUsd: number;
  todayTasks: number;
  avgCostPerTask: number;
  lifetimeInputTokens: number;
  lifetimeOutputTokens: number;
  lifetimeCostUsd: number;
  lifetimeTasks: number;
  /** Manually set by operator from Anthropic console */
  manualBalance: number;
  /** manual balance minus lifetime spend */
  estimatedBalanceRemaining: number;
  estimatedTasksRemaining: number;
  estimatedDaysRemaining: number;
  costEfficiency: number; // revenue per $1 of LLM cost
}

export function initCostTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      task_type TEXT NOT NULL, -- 'task', 'chat', 'study', 'prediction'
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      task_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS cost_budget (
      key TEXT PRIMARY KEY,
      value REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_llm_costs_date ON llm_costs(date);
  `);

  // Set default budget if not exists
  db.prepare("INSERT OR IGNORE INTO cost_budget (key, value) VALUES ('api_balance', 50.00)").run();
  db.prepare("INSERT OR IGNORE INTO cost_budget (key, value) VALUES ('daily_cost_limit', 5.00)").run();
  db.prepare("INSERT OR IGNORE INTO cost_budget (key, value) VALUES ('cost_per_task_limit', 0.50)").run();
}

export function recordLlmUsage(
  inputTokens: number,
  outputTokens: number,
  taskType: string,
  taskId?: string,
): void {
  const cost = (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
               (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M;
  const today = new Date().toISOString().slice(0, 10);

  getDb().prepare(
    "INSERT INTO llm_costs (date, task_type, input_tokens, output_tokens, cost_usd, task_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(today, taskType, inputTokens, outputTokens, cost, taskId ?? null, Date.now());
}

export function getBudget(key: string): number {
  const row = getDb().prepare("SELECT value FROM cost_budget WHERE key = ?").get(key) as { value: number } | undefined;
  return row?.value ?? 0;
}

export function setBudget(key: string, value: number): void {
  getDb().prepare("INSERT OR REPLACE INTO cost_budget (key, value) VALUES (?, ?)").run(key, value);
}

export function getCostSnapshot(): CostSnapshot {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const todayStats = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as inp, COALESCE(SUM(output_tokens), 0) as out,
           COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as tasks
    FROM llm_costs WHERE date = ?
  `).get(today) as { inp: number; out: number; cost: number; tasks: number };

  const lifetimeStats = db.prepare(`
    SELECT COALESCE(SUM(input_tokens), 0) as inp, COALESCE(SUM(output_tokens), 0) as out,
           COALESCE(SUM(cost_usd), 0) as cost, COUNT(*) as tasks
    FROM llm_costs
  `).get() as { inp: number; out: number; cost: number; tasks: number };

  const manualBalance = getBudget("api_balance"); // Set by operator from Anthropic console
  const balance = Math.max(0, manualBalance - lifetimeStats.cost);
  const avgCost = lifetimeStats.tasks > 0 ? lifetimeStats.cost / lifetimeStats.tasks : 0.06;
  const dailyCost = todayStats.cost > 0 ? todayStats.cost : avgCost * 10;

  // Get lifetime revenue for efficiency calc
  const revenue = db.prepare("SELECT COALESCE(SUM(revenue_usd), 0) as rev FROM tasks WHERE revenue_usd > 0").get() as { rev: number };

  return {
    todayInputTokens: todayStats.inp,
    todayOutputTokens: todayStats.out,
    todayCostUsd: todayStats.cost,
    todayTasks: todayStats.tasks,
    avgCostPerTask: avgCost,
    lifetimeInputTokens: lifetimeStats.inp,
    lifetimeOutputTokens: lifetimeStats.out,
    lifetimeCostUsd: lifetimeStats.cost,
    lifetimeTasks: lifetimeStats.tasks,
    manualBalance,
    estimatedBalanceRemaining: balance,
    estimatedTasksRemaining: avgCost > 0 ? Math.floor(balance / avgCost) : 0,
    estimatedDaysRemaining: dailyCost > 0 ? Math.floor(balance / dailyCost) : 0,
    costEfficiency: lifetimeStats.cost > 0 ? revenue.rev / lifetimeStats.cost : 0,
  };
}

/** Check if we can afford to run a task */
export function canAffordTask(taskType: string): { allowed: boolean; reason?: string } {
  const balance = getBudget("api_balance");
  const dailyLimit = getBudget("daily_cost_limit");

  if (balance <= 0.10) {
    return { allowed: false, reason: `API balance critically low: $${balance.toFixed(2)}. Stop all non-essential operations.` };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayCost = (getDb().prepare("SELECT COALESCE(SUM(cost_usd), 0) as cost FROM llm_costs WHERE date = ?").get(today) as { cost: number }).cost;

  if (todayCost >= dailyLimit) {
    return { allowed: false, reason: `Daily cost limit reached: $${todayCost.toFixed(2)}/$${dailyLimit.toFixed(2)}. Waiting until tomorrow.` };
  }

  // Study sessions are lower priority — skip if balance is low
  if (taskType === "study" && balance < 2.00) {
    return { allowed: false, reason: `Balance too low for study sessions: $${balance.toFixed(2)}. Saving for revenue-generating tasks.` };
  }

  // Prediction research — skip if balance is low
  if (taskType === "prediction" && balance < 5.00) {
    return { allowed: false, reason: `Balance too low for prediction research: $${balance.toFixed(2)}.` };
  }

  return { allowed: true };
}
