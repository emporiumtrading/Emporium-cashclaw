import { getDb } from "../db/index.js";

export interface KnowledgeEntry {
  id: string;
  topic: "feedback_analysis" | "specialty_research" | "task_simulation" | "cost_optimization";
  specialty: string;
  insight: string;
  source: string;
  timestamp: number;
}

export function loadKnowledge(): KnowledgeEntry[] {
  const rows = getDb().prepare(
    "SELECT id, topic, specialty, insight, source, created_at as timestamp FROM knowledge ORDER BY created_at DESC"
  ).all() as KnowledgeEntry[];
  return rows;
}

export function storeKnowledge(entry: KnowledgeEntry): void {
  getDb().prepare(
    "INSERT OR REPLACE INTO knowledge (id, topic, specialty, insight, source, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(entry.id, entry.topic, entry.specialty, entry.insight, entry.source, entry.timestamp);

  // Invalidate search index
  import("./search.js")
    .then((m) => m.invalidateIndex())
    .catch((err) => console.error("Failed to invalidate search index:", err));
}

export function deleteKnowledge(id: string): boolean {
  const result = getDb().prepare("DELETE FROM knowledge WHERE id = ?").run(id);
  if (result.changes > 0) {
    import("./search.js")
      .then((m) => m.invalidateIndex())
      .catch((err) => console.error("Failed to invalidate search index:", err));
    return true;
  }
  return false;
}

export function getRelevantKnowledge(specialties: string[], limit = 5): KnowledgeEntry[] {
  if (specialties.length === 0) {
    return getDb().prepare(
      "SELECT id, topic, specialty, insight, source, created_at as timestamp FROM knowledge ORDER BY created_at DESC LIMIT ?"
    ).all(limit) as KnowledgeEntry[];
  }

  const placeholders = specialties.map(() => "?").join(",");
  return getDb().prepare(
    `SELECT id, topic, specialty, insight, source, created_at as timestamp FROM knowledge
     WHERE LOWER(specialty) IN (${placeholders}) OR specialty = 'general'
     ORDER BY created_at DESC LIMIT ?`
  ).all(...specialties.map((s) => s.toLowerCase()), limit) as KnowledgeEntry[];
}
