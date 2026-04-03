/**
 * E2B Code Execution Sandbox for Melista.
 *
 * Gives the agent the ability to write code, execute it, see output/errors,
 * fix issues, and deliver tested, working code to clients.
 *
 * Uses E2B's secure sandboxed environments with 150ms startup.
 */
import { Sandbox } from "e2b";

const SANDBOX_TIMEOUT_MS = 300_000; // 5 min max per sandbox session
const COMMAND_TIMEOUT_MS = 60_000; // 60s max per command
const MAX_OUTPUT_LENGTH = 10_000; // Truncate long outputs

let activeSandbox: Sandbox | null = null;
let sandboxCreatedAt = 0;

/** Get or create a sandbox. Reuses sandbox within 5 min window. */
async function getSandbox(apiKey: string): Promise<Sandbox> {
  const now = Date.now();

  // Reuse existing sandbox if still fresh
  if (activeSandbox && now - sandboxCreatedAt < SANDBOX_TIMEOUT_MS) {
    return activeSandbox;
  }

  // Close old sandbox
  if (activeSandbox) {
    try { await activeSandbox.kill(); } catch { /* ignore */ }
    activeSandbox = null;
  }

  activeSandbox = await Sandbox.create({
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
  });
  sandboxCreatedAt = now;
  return activeSandbox;
}

function truncate(s: string): string {
  if (s.length <= MAX_OUTPUT_LENGTH) return s;
  return s.slice(0, MAX_OUTPUT_LENGTH) + `\n... (truncated, ${s.length} total chars)`;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

/** Execute a shell command in the sandbox */
export async function execCommand(apiKey: string, command: string): Promise<ExecResult> {
  const sandbox = await getSandbox(apiKey);
  const result = await sandbox.commands.run(command, { timeoutMs: COMMAND_TIMEOUT_MS });

  return {
    stdout: truncate(result.stdout),
    stderr: truncate(result.stderr),
    exitCode: result.exitCode,
    success: result.exitCode === 0,
  };
}

/** Write a file in the sandbox */
export async function writeFile(apiKey: string, path: string, content: string): Promise<void> {
  const sandbox = await getSandbox(apiKey);
  await sandbox.files.write(path, content);
}

/** Read a file from the sandbox */
export async function readFile(apiKey: string, path: string): Promise<string> {
  const sandbox = await getSandbox(apiKey);
  return await sandbox.files.read(path);
}

/** List files in a directory */
export async function listFiles(apiKey: string, path: string): Promise<string[]> {
  const sandbox = await getSandbox(apiKey);
  const entries = await sandbox.files.list(path);
  return entries.map((e) => e.name);
}

/** Close the active sandbox */
export async function closeSandbox(): Promise<void> {
  if (activeSandbox) {
    try { await activeSandbox.kill(); } catch { /* ignore */ }
    activeSandbox = null;
  }
}
