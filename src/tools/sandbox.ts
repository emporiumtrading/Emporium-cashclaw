/**
 * Sandbox tools — give Melista the ability to write, execute, test, and fix code.
 *
 * This transforms Melista from "generates code" to "delivers tested, working code."
 */
import type { Tool } from "./types.js";
import { execCommand, writeFile, readFile, listFiles } from "../sandbox/index.js";

function getApiKey(ctx: { config: { e2bApiKey?: string } }): string {
  const key = ctx.config.e2bApiKey;
  if (!key) throw new Error("E2B sandbox not configured. Add API key in Settings.");
  return key;
}

export const executeCode: Tool = {
  definition: {
    name: "execute_code",
    description: "Execute a shell command in a secure sandbox. Use for running code, installing packages, running tests, or verifying output. Returns stdout, stderr, and exit code. The sandbox has Python 3, Node.js, and common tools pre-installed.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute (e.g. 'python main.py', 'node index.js', 'npm test', 'pip install requests')" },
      },
      required: ["command"],
    },
  },
  async execute(input, ctx) {
    const command = input.command as string;
    if (!command) return { success: false, data: "Missing command" };

    const key = getApiKey(ctx as never);
    const result = await execCommand(key, command);

    const parts = [];
    if (result.stdout) parts.push(`STDOUT:\n${result.stdout}`);
    if (result.stderr) parts.push(`STDERR:\n${result.stderr}`);
    parts.push(`Exit code: ${result.exitCode}`);

    return {
      success: result.success,
      data: parts.join("\n\n"),
    };
  },
};

export const sandboxWriteFile: Tool = {
  definition: {
    name: "sandbox_write_file",
    description: "Write a file to the sandbox filesystem. Use to create source code files, config files, test files, etc. before executing them.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path in sandbox (e.g. '/home/user/main.py', '/home/user/index.js')" },
        content: { type: "string", description: "File content to write" },
      },
      required: ["path", "content"],
    },
  },
  async execute(input, ctx) {
    const path = input.path as string;
    const content = input.content as string;
    if (!path || !content) return { success: false, data: "Missing path or content" };

    const key = getApiKey(ctx as never);
    await writeFile(key, path, content);
    return { success: true, data: `File written: ${path} (${content.length} chars)` };
  },
};

export const sandboxReadFile: Tool = {
  definition: {
    name: "sandbox_read_file",
    description: "Read a file from the sandbox filesystem. Use to check generated output, review files, or read test results.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to read" },
      },
      required: ["path"],
    },
  },
  async execute(input, ctx) {
    const path = input.path as string;
    if (!path) return { success: false, data: "Missing path" };

    const key = getApiKey(ctx as never);
    const content = await readFile(key, path);
    return { success: true, data: content };
  },
};

export const sandboxListFiles: Tool = {
  definition: {
    name: "sandbox_list_files",
    description: "List files in a sandbox directory. Use to check what files exist.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path (default: /home/user)" },
      },
      required: [],
    },
  },
  async execute(input, ctx) {
    const path = (input.path as string) || "/home/user";
    const key = getApiKey(ctx as never);
    const files = await listFiles(key, path);
    return { success: true, data: files.join("\n") };
  },
};
