import { getDb } from "../db/index.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface ActivityLogEntry {
  type: string;
  taskId?: string;
  message: string;
  timestamp: number;
}

export function appendLog(entry: string, type?: string, taskId?: string): void {
  getDb().prepare(
    "INSERT INTO activity_log (date, type, task_id, message, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(today(), type ?? null, taskId ?? null, entry, Date.now());
}

/** Get recent activity events from SQLite (for Dashboard) */
export function getRecentActivity(limit = 100): ActivityLogEntry[] {
  return getDb().prepare(
    "SELECT type, task_id as taskId, message, created_at as timestamp FROM activity_log ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as ActivityLogEntry[];
}

export function readTodayLog(): string {
  const d = today();
  const rows = getDb().prepare(
    "SELECT message, created_at FROM activity_log WHERE date = ? ORDER BY created_at ASC"
  ).all(d) as { message: string; created_at: number }[];

  if (rows.length === 0) return "No activity today.";

  const header = `# Melista Activity — ${d}\n\n`;
  const lines = rows.map((r) => {
    const ts = new Date(r.created_at).toISOString().split("T")[1].split(".")[0];
    return `- \`${ts}\` ${r.message}`;
  }).join("\n");

  return header + lines;
}

export function readLog(date: Date): string {
  const d = date.toISOString().slice(0, 10);
  const rows = getDb().prepare(
    "SELECT message, created_at FROM activity_log WHERE date = ? ORDER BY created_at ASC"
  ).all(d) as { message: string; created_at: number }[];

  if (rows.length === 0) return "";

  return rows.map((r) => {
    const ts = new Date(r.created_at).toISOString().split("T")[1].split(".")[0];
    return `- \`${ts}\` ${r.message}`;
  }).join("\n");
}
