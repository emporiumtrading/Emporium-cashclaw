/**
 * MCP Client for Melista.
 *
 * Connects to MCP servers (Upwork, Himalayas, etc.) as a client to discover
 * job opportunities. Uses stdio transport to spawn server processes locally.
 *
 * Architecture:
 * - Each MCP server runs as a child process via StdioClientTransport
 * - Melista calls listTools() to see available tools, then callTool() to search
 * - Results are normalised into MarketplaceTask format for the heartbeat
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MarketplaceTask, MarketplaceBounty } from "../marketplaces/types.js";

export interface McpServerConfig {
  /** Display name */
  name: string;
  /** Command to run the server (e.g. "npx", "node") */
  command: string;
  /** Arguments to pass */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Tool name to call for searching jobs */
  searchTool: string;
  /** Arguments to pass to the search tool */
  searchArgs?: Record<string, unknown>;
  /** Function to normalise results into MarketplaceTask */
  normalise: (result: unknown) => MarketplaceTask[];
}

export class McpJobClient {
  private clients = new Map<string, { client: Client; transport: StdioClientTransport }>();

  /** Connect to an MCP server */
  async connect(id: string, config: McpServerConfig): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });

      const client = new Client({
        name: "melista-agent",
        version: "0.1.0",
      });

      await client.connect(transport);
      this.clients.set(id, { client, transport });
      console.log(`[MCP] Connected to ${config.name}`);
    } catch (err) {
      console.error(`[MCP] Failed to connect to ${config.name}:`, err instanceof Error ? err.message : err);
    }
  }

  /** List available tools on a connected server */
  async listTools(id: string): Promise<string[]> {
    const entry = this.clients.get(id);
    if (!entry) return [];

    try {
      const result = await entry.client.listTools();
      return result.tools.map((t) => t.name);
    } catch {
      return [];
    }
  }

  /** Call a tool on a connected server */
  async callTool(id: string, toolName: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const entry = this.clients.get(id);
    if (!entry) throw new Error(`MCP server ${id} not connected`);

    const result = await entry.client.callTool({ name: toolName, arguments: args });
    // Extract text content from MCP response
    if (Array.isArray(result.content)) {
      const texts = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text);
      const joined = texts.join("\n");
      try {
        return JSON.parse(joined);
      } catch {
        return joined;
      }
    }
    return result.content;
  }

  /** Search for jobs using a server's search tool */
  async searchJobs(id: string, config: McpServerConfig): Promise<MarketplaceTask[]> {
    try {
      const result = await this.callTool(id, config.searchTool, config.searchArgs ?? {});
      return config.normalise(result);
    } catch (err) {
      console.error(`[MCP] Search failed on ${id}:`, err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** Disconnect a server */
  async disconnect(id: string): Promise<void> {
    const entry = this.clients.get(id);
    if (!entry) return;
    try {
      await entry.client.close();
    } catch { /* ignore */ }
    this.clients.delete(id);
  }

  /** Disconnect all servers */
  async disconnectAll(): Promise<void> {
    for (const id of this.clients.keys()) {
      await this.disconnect(id);
    }
  }

  /** Check if a server is connected */
  isConnected(id: string): boolean {
    return this.clients.has(id);
  }
}

// --- Pre-configured MCP server configs ---

export function getUpworkMcpConfig(oauthToken?: string): McpServerConfig {
  return {
    name: "Upwork",
    command: "npx",
    args: ["-y", "@chinchillaenterprises/mcp-upwork"],
    env: oauthToken ? { UPWORK_TOKEN: oauthToken } : {},
    searchTool: "search_jobs",
    searchArgs: {
      query: "python javascript react node typescript automation",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).jobs as unknown[] ?? [];
      return items.map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? j.job_id ?? Math.random().toString(36).slice(2)),
          marketplace: "upwork-mcp" as "near", // Use near as placeholder type
          globalId: `upwork-mcp:${j.id ?? j.job_id ?? ""}`,
          client: String(j.client ?? j.client_name ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? j.snippet ?? ""}`.trim(),
          status: "requested" as const,
          budget: j.budget ? String(j.budget) : undefined,
          budgetUsd: j.budget ? parseFloat(String(j.budget)) : undefined,
          category: j.category ? String(j.category) : undefined,
        };
      });
    },
  };
}

export function getHimalayasMcpConfig(): McpServerConfig {
  return {
    name: "Himalayas Remote Jobs",
    command: "npx",
    args: ["-y", "@anthropic/himalayas-mcp"],
    searchTool: "search_jobs",
    searchArgs: {
      query: "developer python javascript",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).jobs as unknown[] ?? [];
      return items.map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? Math.random().toString(36).slice(2)),
          marketplace: "himalayas-mcp" as "near",
          globalId: `himalayas-mcp:${j.id ?? ""}`,
          client: String(j.company ?? j.company_name ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? ""}`.trim(),
          status: "requested" as const,
          category: j.category ? String(j.category) : undefined,
        };
      });
    },
  };
}

/** Create and connect configured MCP clients */
export async function createMcpClients(config: {
  upworkToken?: string;
  enableHimalayas?: boolean;
}): Promise<McpJobClient> {
  const client = new McpJobClient();

  // Only connect if tokens are available
  if (config.upworkToken) {
    const upworkConfig = getUpworkMcpConfig(config.upworkToken);
    await client.connect("upwork", upworkConfig);
  }

  if (config.enableHimalayas) {
    const himalayasConfig = getHimalayasMcpConfig();
    await client.connect("himalayas", himalayasConfig);
  }

  return client;
}
