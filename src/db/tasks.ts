import { getDb } from "./index.js";

export interface TaskRecord {
  id: string;
  marketplace: string;
  global_id: string;
  client_address: string;
  description: string;
  status: string;
  category?: string;
  skills_matched?: string;
  quoted_price?: string;
  quoted_currency?: string;
  quoted_usd?: number;
  quoted_at?: number;
  accepted_at?: number;
  submitted_at?: number;
  completed_at?: number;
  rated_score?: number;
  rated_comment?: string;
  result_preview?: string;
  llm_tokens_used?: number;
  llm_cost_usd?: number;
  loop_turns?: number;
  tools_used?: string;
  revenue_eth?: string;
  revenue_usd?: number;
  profit_usd?: number;
  created_at: number;
  updated_at: number;
}

export function upsertTask(task: Partial<TaskRecord> & { id: string }): void {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM tasks WHERE id = ?").get(task.id);

  if (existing) {
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [key, val] of Object.entries(task)) {
      if (key === "id" || val === undefined) continue;
      sets.push(`${key} = ?`);
      vals.push(val);
    }
    sets.push("updated_at = ?");
    vals.push(Date.now());
    vals.push(task.id);
    db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  } else {
    const now = Date.now();
    db.prepare(`
      INSERT INTO tasks (id, marketplace, global_id, client_address, description, status, category, quoted_price, quoted_currency, quoted_usd, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.marketplace ?? "moltlaunch",
      task.global_id ?? task.id,
      task.client_address ?? "",
      task.description ?? "",
      task.status ?? "requested",
      task.category ?? null,
      task.quoted_price ?? null,
      task.quoted_currency ?? "ETH",
      task.quoted_usd ?? null,
      task.created_at ?? now,
      now,
    );
  }
}

export function getTask(id: string): TaskRecord | undefined {
  return getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRecord | undefined;
}

export function getRecentTasks(limit = 50): TaskRecord[] {
  return getDb().prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit) as TaskRecord[];
}

export function getTasksByStatus(status: string, limit = 50): TaskRecord[] {
  return getDb().prepare("SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC LIMIT ?").all(status, limit) as TaskRecord[];
}

/** Check if a task was already processed (declined, quoted, submitted) */
export function wasTaskProcessed(globalId: string): boolean {
  const row = getDb().prepare("SELECT id FROM tasks WHERE id = ? OR global_id = ?").get(globalId, globalId);
  return Boolean(row);
}

export function getTasksByClient(clientAddress: string, limit = 50): TaskRecord[] {
  return getDb().prepare("SELECT * FROM tasks WHERE client_address = ? ORDER BY created_at DESC LIMIT ?").all(clientAddress, limit) as TaskRecord[];
}

export function getTaskStats(): {
  total: number;
  completed: number;
  declined: number;
  avgRating: number;
  totalRevenueUsd: number;
} {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
  const completed = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'").get() as { c: number }).c;
  const declined = (db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'declined'").get() as { c: number }).c;
  const avgRating = (db.prepare("SELECT AVG(rated_score) as avg FROM tasks WHERE rated_score IS NOT NULL").get() as { avg: number | null }).avg ?? 0;
  const totalRevenueUsd = (db.prepare("SELECT SUM(revenue_usd) as total FROM tasks WHERE revenue_usd IS NOT NULL").get() as { total: number | null }).total ?? 0;
  return { total, completed, declined, avgRating, totalRevenueUsd };
}
