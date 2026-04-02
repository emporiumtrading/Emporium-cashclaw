import { getDb } from "../db/index.js";

export interface FeedbackEntry {
  taskId: string;
  taskDescription: string;
  score: number;
  comments: string;
  timestamp: number;
}

export function loadFeedback(): FeedbackEntry[] {
  return getDb().prepare(
    "SELECT task_id as taskId, task_description as taskDescription, score, comments, created_at as timestamp FROM feedback ORDER BY created_at DESC"
  ).all() as FeedbackEntry[];
}

export function storeFeedback(entry: FeedbackEntry): void {
  getDb().prepare(
    "INSERT INTO feedback (task_id, task_description, score, comments, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(entry.taskId, entry.taskDescription, entry.score, entry.comments, entry.timestamp);

  import("./search.js")
    .then((m) => m.invalidateIndex())
    .catch((err) => console.error("Failed to invalidate search index:", err));
}

export function getFeedbackStats(): {
  totalTasks: number;
  avgScore: number;
  completionRate: number;
} {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM feedback").get() as { c: number }).c;
  if (total === 0) return { totalTasks: 0, avgScore: 0, completionRate: 0 };

  const scored = (db.prepare("SELECT COUNT(*) as c FROM feedback WHERE score > 0").get() as { c: number }).c;
  const avg = (db.prepare("SELECT AVG(score) as avg FROM feedback WHERE score > 0").get() as { avg: number | null }).avg ?? 0;

  return {
    totalTasks: total,
    avgScore: Math.round(avg * 10) / 10,
    completionRate: Math.round((scored / total) * 100),
  };
}
