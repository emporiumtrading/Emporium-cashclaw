import { getDb } from "./index.js";

export interface ClientRecord {
  address: string;
  first_seen: number;
  last_seen: number;
  total_tasks: number;
  completed_tasks: number;
  total_revenue_usd: number;
  avg_rating: number | null;
  marketplace: string | null;
  notes: string | null;
}

export function upsertClient(address: string, marketplace?: string): void {
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare("SELECT address FROM clients WHERE address = ?").get(address);

  if (existing) {
    db.prepare(`
      UPDATE clients SET
        last_seen = ?,
        total_tasks = total_tasks + 1
      WHERE address = ?
    `).run(now, address);
  } else {
    db.prepare(`
      INSERT INTO clients (address, first_seen, last_seen, total_tasks, completed_tasks, total_revenue_usd, marketplace)
      VALUES (?, ?, ?, 1, 0, 0, ?)
    `).run(address, now, now, marketplace ?? null);
  }
}

export function recordClientCompletion(address: string, revenueUsd: number, rating?: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE clients SET
      completed_tasks = completed_tasks + 1,
      total_revenue_usd = total_revenue_usd + ?,
      avg_rating = CASE
        WHEN ? IS NOT NULL THEN
          CASE WHEN avg_rating IS NULL THEN ? ELSE (avg_rating * (completed_tasks - 1) + ?) / completed_tasks END
        ELSE avg_rating
      END,
      last_seen = ?
    WHERE address = ?
  `).run(revenueUsd, rating ?? null, rating ?? null, rating ?? null, Date.now(), address);
}

export function getTopClients(limit = 20): ClientRecord[] {
  return getDb().prepare(
    "SELECT * FROM clients ORDER BY total_revenue_usd DESC LIMIT ?"
  ).all(limit) as ClientRecord[];
}

export function getRepeatClients(): ClientRecord[] {
  return getDb().prepare(
    "SELECT * FROM clients WHERE completed_tasks > 1 ORDER BY completed_tasks DESC"
  ).all() as ClientRecord[];
}

export function getClient(address: string): ClientRecord | undefined {
  return getDb().prepare("SELECT * FROM clients WHERE address = ?").get(address) as ClientRecord | undefined;
}

export function getClientCount(): number {
  return (getDb().prepare("SELECT COUNT(*) as c FROM clients").get() as { c: number }).c;
}
