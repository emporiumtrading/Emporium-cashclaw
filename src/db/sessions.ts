import { getDb } from "./index.js";

export function createSession(token: string, expiresAt: number): void {
  getDb().prepare("INSERT OR REPLACE INTO sessions (token, expires_at) VALUES (?, ?)").run(token, expiresAt);
}

export function getSession(token: string): { token: string; expires_at: number } | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE token = ?").get(token) as { token: string; expires_at: number } | undefined;
}

export function deleteSession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function cleanExpiredSessions(): void {
  getDb().prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}
