import { getDb } from "./index.js";

export interface RevenueRecord {
  date: string;
  tasks_completed: number;
  tasks_quoted: number;
  tasks_declined: number;
  revenue_eth: string;
  revenue_usd: number;
  costs_usd: number;
  profit_usd: number;
  avg_task_usd: number;
  marketplace_breakdown?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function ensureToday(): void {
  const db = getDb();
  const d = today();
  const existing = db.prepare("SELECT date FROM revenue WHERE date = ?").get(d);
  if (!existing) {
    db.prepare("INSERT INTO revenue (date) VALUES (?)").run(d);
  }
}

export function recordTaskCompleted(revenueUsd: number, revenueEth: string, costUsd: number): void {
  ensureToday();
  const d = today();
  const db = getDb();
  db.prepare(`
    UPDATE revenue SET
      tasks_completed = tasks_completed + 1,
      revenue_usd = revenue_usd + ?,
      revenue_eth = CAST((CAST(revenue_eth AS REAL) + CAST(? AS REAL)) AS TEXT),
      costs_usd = costs_usd + ?,
      profit_usd = profit_usd + ? - ?,
      avg_task_usd = CASE WHEN tasks_completed > 0 THEN (revenue_usd + ?) / (tasks_completed + 1) ELSE ? END,
      updated_at = ?
    WHERE date = ?
  `).run(revenueUsd, revenueEth, costUsd, revenueUsd, costUsd, revenueUsd, revenueUsd, Date.now(), d);
}

export function recordTaskQuoted(): void {
  ensureToday();
  getDb().prepare("UPDATE revenue SET tasks_quoted = tasks_quoted + 1, updated_at = ? WHERE date = ?")
    .run(Date.now(), today());
}

export function recordTaskDeclined(): void {
  ensureToday();
  getDb().prepare("UPDATE revenue SET tasks_declined = tasks_declined + 1, updated_at = ? WHERE date = ?")
    .run(Date.now(), today());
}

export function getTodayRevenue(): RevenueRecord | null {
  ensureToday();
  return getDb().prepare("SELECT * FROM revenue WHERE date = ?").get(today()) as RevenueRecord | null;
}

export function getRevenueRange(startDate: string, endDate: string): RevenueRecord[] {
  return getDb().prepare(
    "SELECT * FROM revenue WHERE date BETWEEN ? AND ? ORDER BY date ASC"
  ).all(startDate, endDate) as RevenueRecord[];
}

export function getMonthlyRevenue(yearMonth: string): {
  totalRevenue: number;
  totalCosts: number;
  totalProfit: number;
  totalTasks: number;
  avgTaskUsd: number;
  days: RevenueRecord[];
} {
  const days = getDb().prepare(
    "SELECT * FROM revenue WHERE date LIKE ? ORDER BY date ASC"
  ).all(`${yearMonth}%`) as RevenueRecord[];

  const totalRevenue = days.reduce((s, d) => s + d.revenue_usd, 0);
  const totalCosts = days.reduce((s, d) => s + d.costs_usd, 0);
  const totalTasks = days.reduce((s, d) => s + d.tasks_completed, 0);

  return {
    totalRevenue,
    totalCosts,
    totalProfit: totalRevenue - totalCosts,
    totalTasks,
    avgTaskUsd: totalTasks > 0 ? totalRevenue / totalTasks : 0,
    days,
  };
}

export function getLifetimeRevenue(): {
  totalRevenue: number;
  totalCosts: number;
  totalProfit: number;
  totalTasks: number;
  totalQuoted: number;
  totalDeclined: number;
  activeDays: number;
} {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(revenue_usd), 0) as totalRevenue,
      COALESCE(SUM(costs_usd), 0) as totalCosts,
      COALESCE(SUM(profit_usd), 0) as totalProfit,
      COALESCE(SUM(tasks_completed), 0) as totalTasks,
      COALESCE(SUM(tasks_quoted), 0) as totalQuoted,
      COALESCE(SUM(tasks_declined), 0) as totalDeclined,
      COUNT(*) as activeDays
    FROM revenue
    WHERE tasks_completed > 0 OR tasks_quoted > 0
  `).get() as {
    totalRevenue: number; totalCosts: number; totalProfit: number;
    totalTasks: number; totalQuoted: number; totalDeclined: number; activeDays: number;
  };
  return row;
}
