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

// --- mcp-jobs (npm) — zero-config multi-platform job aggregation ---

export function getMcpJobsConfig(): McpServerConfig {
  return {
    name: "MCP Jobs",
    command: "npx",
    args: ["-y", "mcp-jobs"],
    searchTool: "search_jobs",
    searchArgs: {
      query: "developer python javascript react",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).jobs as unknown[] ?? [];
      return items.slice(0, 10).map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? j.url ?? Math.random().toString(36).slice(2)),
          marketplace: "mcp-jobs" as "near",
          globalId: `mcp-jobs:${j.id ?? j.url ?? ""}`,
          client: String(j.company ?? j.company_name ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? j.snippet ?? ""}`.trim(),
          status: "requested" as const,
          budget: j.salary ? String(j.salary) : undefined,
          category: j.category ? String(j.category) : j.tags ? String(j.tags) : undefined,
        };
      });
    },
  };
}

// --- @foundrole/ai-job-search-mcp (npm) — multi-platform job search proxy ---

export function getFoundroleJobsConfig(): McpServerConfig {
  return {
    name: "Foundrole Job Search",
    command: "npx",
    args: ["-y", "@foundrole/ai-job-search-mcp"],
    searchTool: "search_jobs",
    searchArgs: {
      query: "software developer freelance remote",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).jobs as unknown[] ?? [];
      return items.slice(0, 10).map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? j.url ?? Math.random().toString(36).slice(2)),
          marketplace: "foundrole" as "near",
          globalId: `foundrole:${j.id ?? j.url ?? ""}`,
          client: String(j.company ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? ""}`.trim(),
          status: "requested" as const,
          budget: j.salary ? String(j.salary) : undefined,
          category: j.location ? String(j.location) : undefined,
        };
      });
    },
  };
}

// --- jobspy-mcp-server (GitHub) — Indeed, LinkedIn, Glassdoor, ZipRecruiter, Google ---

export function getJobSpyConfig(): McpServerConfig {
  return {
    name: "JobSpy (Indeed/LinkedIn/Glassdoor)",
    command: "npx",
    args: ["-y", "github:borgius/jobspy-mcp-server"],
    searchTool: "search_jobs",
    searchArgs: {
      search_term: "software developer",
      location: "Remote",
      results_wanted: 10,
      site_name: "indeed,linkedin,glassdoor",
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).jobs as unknown[] ?? [];
      return items.slice(0, 10).map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? j.job_url ?? Math.random().toString(36).slice(2)),
          marketplace: "jobspy" as "near",
          globalId: `jobspy:${j.id ?? ""}`,
          client: String(j.company_name ?? j.company ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? ""}`.trim(),
          status: "requested" as const,
          budget: j.min_amount ? `$${j.min_amount}-${j.max_amount}` : undefined,
          budgetUsd: j.min_amount ? parseFloat(String(j.min_amount)) : undefined,
          category: j.site ? String(j.site) : undefined,
        };
      });
    },
  };
}

// --- ClawGig (npm @clawgig/mcp) — AI agent freelance marketplace, pays USDC ---

export function getClawGigConfig(): McpServerConfig {
  return {
    name: "ClawGig (AI Agent Marketplace)",
    command: "npx",
    args: ["-y", "@clawgig/mcp"],
    searchTool: "search_gigs",
    searchArgs: {
      query: "development automation research",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).gigs as unknown[] ?? [];
      return items.slice(0, 10).map((item: unknown) => {
        const j = item as Record<string, unknown>;
        return {
          id: String(j.id ?? j.gig_id ?? Math.random().toString(36).slice(2)),
          marketplace: "clawgig" as "near",
          globalId: `clawgig:${j.id ?? j.gig_id ?? ""}`,
          client: String(j.client ?? j.poster ?? ""),
          description: `${j.title ?? ""}\n\n${j.description ?? ""}`.trim(),
          status: "requested" as const,
          budget: j.budget ? `${j.budget} USDC` : j.reward ? `${j.reward} USDC` : undefined,
          budgetUsd: j.budget ? parseFloat(String(j.budget)) : j.reward ? parseFloat(String(j.reward)) : undefined,
          category: j.category ? String(j.category) : j.tags ? String(j.tags) : undefined,
        };
      });
    },
  };
}

// --- Remotion MCP — generate images, videos, motion graphics (FREE, local) ---

export function getRemotionMcpConfig(): McpServerConfig {
  return {
    name: "Remotion (Images/Video/Motion)",
    command: "npx",
    args: ["-y", "remotion-mcp-server"],
    searchTool: "list_available_tools",
    searchArgs: {},
    normalise: () => [], // Creative tool, not a job source
  };
}

// --- Whop MCP (SSE transport) — product discovery & market research ---

export function getWhopMcpConfig(): McpServerConfig {
  return {
    name: "Whop Marketplace",
    // Whop uses SSE transport at https://mcp.whop.com/sse
    // For stdio, we use npx to run a bridge or the SDK directly
    command: "npx",
    args: ["-y", "mcp-remote", "https://mcp.whop.com/sse"],
    searchTool: "search_products",
    searchArgs: {
      query: "AI automation code development",
      limit: 10,
    },
    normalise(result: unknown): MarketplaceTask[] {
      if (!result || typeof result !== "object") return [];
      const items = Array.isArray(result) ? result : (result as Record<string, unknown>).products as unknown[] ?? [];
      return items.slice(0, 5).map((item: unknown) => {
        const p = item as Record<string, unknown>;
        return {
          id: String(p.id ?? Math.random().toString(36).slice(2)),
          marketplace: "whop-mcp" as "near",
          globalId: `whop-mcp:${p.id ?? ""}`,
          client: String(p.seller ?? p.company ?? ""),
          description: `Whop product insight: ${p.title ?? ""}\n\n${p.description ?? ""}`.trim(),
          status: "requested" as const,
          budget: p.price ? `$${p.price}` : undefined,
          budgetUsd: p.price ? parseFloat(String(p.price)) : undefined,
          category: p.category ? String(p.category) : undefined,
        };
      });
    },
  };
}

/** All available MCP server configs */
export const MCP_SERVERS = {
  "mcp-jobs": getMcpJobsConfig,
  "foundrole": getFoundroleJobsConfig,
  "jobspy": getJobSpyConfig,
  "clawgig": getClawGigConfig,
  "remotion": getRemotionMcpConfig,
  "whop": getWhopMcpConfig,
  "upwork": getUpworkMcpConfig,
  "himalayas": getHimalayasMcpConfig,
} as const;

export type McpServerId = keyof typeof MCP_SERVERS;
