import { getPricesSync } from "../db/prices.js";
/**
 * Fetch.ai Agentverse adapter.
 *
 * Connects to the Agentverse REST API for agent registration, task handling,
 * and payments in FET/ASI tokens. Uses the Almanac-based messaging system.
 */
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface FetchaiConfig {
  /** Agentverse API key from agentverse.ai profile */
  apiKey: string;
  /** Agent address (agent1q...) */
  agentAddress?: string;
  /** Base URL for Agentverse API */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://agentverse.ai/v1";

async function agentverseFetch<T>(
  config: FetchaiConfig,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${config.baseUrl ?? DEFAULT_BASE_URL}${path}`;
  const resp = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Agentverse API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

interface AgentverseTask {
  task_id: string;
  sender: string;
  description: string;
  status: string;
  budget_fet?: number;
  category?: string;
  messages?: { sender: string; content: string; timestamp: string }[];
  result?: string;
}

function normaliseStatus(s: string): MarketplaceTask["status"] {
  const map: Record<string, MarketplaceTask["status"]> = {
    pending: "requested",
    open: "requested",
    quoted: "quoted",
    accepted: "accepted",
    in_progress: "accepted",
    delivered: "submitted",
    revision: "revision",
    completed: "completed",
    declined: "declined",
    cancelled: "cancelled",
    expired: "expired",
  };
  return map[s] ?? "requested";
}

function normaliseTask(task: AgentverseTask): MarketplaceTask {
  const fetPrice = getPricesSync().fet;
  return {
    id: task.task_id,
    marketplace: "fetchai",
    globalId: `fetchai:${task.task_id}`,
    client: task.sender,
    description: task.description,
    status: normaliseStatus(task.status),
    budget: task.budget_fet?.toString(),
    budgetUsd: task.budget_fet ? task.budget_fet * fetPrice : undefined,
    category: task.category,
    messages: task.messages?.map((m) => ({
      role: m.sender === task.sender ? "client" as const : "agent" as const,
      content: m.content,
      timestamp: new Date(m.timestamp).getTime(),
    })),
    previousResult: task.result,
    _raw: task,
  };
}

export function createFetchaiAdapter(fetchConfig: FetchaiConfig): MarketplaceAdapter {
  return {
    name: "fetchai",
    label: "Fetch.ai Agentverse",

    isConfigured() {
      return Boolean(fetchConfig.apiKey);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      const data = await agentverseFetch<{ tasks: AgentverseTask[] }>(
        fetchConfig,
        "/hosting/tasks/inbox",
      );
      return data.tasks.map(normaliseTask);
    },

    async quoteTask(params: MarketplaceQuoteParams) {
      await agentverseFetch(fetchConfig, `/hosting/tasks/${params.taskId}/quote`, {
        method: "POST",
        body: {
          price_fet: parseFloat(params.price),
          message: params.message,
        },
      });
    },

    async declineTask(taskId: string, reason?: string) {
      await agentverseFetch(fetchConfig, `/hosting/tasks/${taskId}/decline`, {
        method: "POST",
        body: { reason },
      });
    },

    async submitWork(params: MarketplaceSubmitParams) {
      await agentverseFetch(fetchConfig, `/hosting/tasks/${params.taskId}/submit`, {
        method: "POST",
        body: { result: params.result },
      });
    },

    async sendMessage(params: MarketplaceMessageParams) {
      await agentverseFetch(fetchConfig, `/hosting/tasks/${params.taskId}/message`, {
        method: "POST",
        body: { content: params.content },
      });
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      const data = await agentverseFetch<{ tasks: AgentverseTask[] }>(
        fetchConfig,
        "/hosting/tasks/open",
      );
      return data.tasks.map((t) => ({
        id: t.task_id,
        marketplace: "fetchai" as const,
        description: t.description,
        budget: t.budget_fet?.toString(),
        budgetUsd: t.budget_fet ? t.budget_fet * 1.5 : undefined,
        category: t.category,
      }));
    },

    async claimBounty(bountyId: string, message?: string) {
      await agentverseFetch(fetchConfig, `/hosting/tasks/${bountyId}/claim`, {
        method: "POST",
        body: { message },
      });
    },
  };
}
