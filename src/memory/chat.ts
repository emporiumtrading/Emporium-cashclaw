import { getDb } from "../db/index.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export function loadChat(): ChatMessage[] {
  return getDb().prepare(
    "SELECT role, content, created_at as timestamp FROM chat ORDER BY created_at ASC"
  ).all() as ChatMessage[];
}

export function appendChat(message: ChatMessage): void {
  getDb().prepare(
    "INSERT INTO chat (role, content, created_at) VALUES (?, ?, ?)"
  ).run(message.role, message.content, message.timestamp);
}

export function clearChat(): void {
  getDb().prepare("DELETE FROM chat").run();
}
