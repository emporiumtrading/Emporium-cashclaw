/**
 * NEAR AI Agent Market adapter.
 *
 * Connects to market.near.ai REST API for job discovery, bidding, delivery,
 * and escrow-based payment in NEAR tokens.
 */
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface NearMarketConfig {
  /** API key from market.near.ai */
  apiKey: string;
  /** Agent's NEAR account ID (e.g. "malista.near") */
  agentId?: string;
  /** Base URL for the marketplace API */
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://market.near.ai/api";

async function nearFetch<T>(
  config: NearMarketConfig,
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
    throw new Error(`NEAR Market API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

interface NearJob {
  job_id: string;
  description: string;
  budget_near?: number;
  category?: string;
  status: string;
  requester?: string;
  bids?: NearBid[];
  messages?: { sender: string; content: string; timestamp: string }[];
  deliverable?: string;
  deadline?: string;
}

interface NearBid {
  agent_id: string;
  amount_near: number;
  message?: string;
}

function normaliseStatus(s: string): MarketplaceTask["status"] {
  const map: Record<string, MarketplaceTask["status"]> = {
    open: "requested",
    bidding: "requested",
    assigned: "accepted",
    in_progress: "accepted",
    delivered: "submitted",
    revision_requested: "revision",
    completed: "completed",
    cancelled: "cancelled",
    expired: "expired",
    declined: "declined",
  };
  return map[s] ?? "requested";
}

function normaliseJob(job: NearJob): MarketplaceTask {
  const nearPrice = 4; // approximate NEAR/USD for budget estimation
  return {
    id: job.job_id,
    marketplace: "near",
    globalId: `near:${job.job_id}`,
    client: job.requester ?? "unknown",
    description: job.description,
    status: normaliseStatus(job.status),
    budget: job.budget_near?.toString(),
    budgetUsd: job.budget_near ? job.budget_near * nearPrice : undefined,
    category: job.category,
    messages: job.messages?.map((m) => ({
      role: m.sender === job.requester ? "client" as const : "agent" as const,
      content: m.content,
      timestamp: new Date(m.timestamp).getTime(),
    })),
    previousResult: job.deliverable,
    _raw: job,
  };
}

export function createNearAdapter(nearConfig: NearMarketConfig): MarketplaceAdapter {
  return {
    name: "near",
    label: "NEAR AI Market",

    isConfigured() {
      return Boolean(nearConfig.apiKey);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      const jobs = await nearFetch<{ jobs: NearJob[] }>(nearConfig, "/jobs/inbox");
      return jobs.jobs.map(normaliseJob);
    },

    async quoteTask(params: MarketplaceQuoteParams) {
      await nearFetch(nearConfig, `/jobs/${params.taskId}/bid`, {
        method: "POST",
        body: {
          amount_near: parseFloat(params.price),
          message: params.message,
        },
      });
    },

    async declineTask(taskId: string, reason?: string) {
      await nearFetch(nearConfig, `/jobs/${taskId}/decline`, {
        method: "POST",
        body: { reason },
      });
    },

    async submitWork(params: MarketplaceSubmitParams) {
      await nearFetch(nearConfig, `/jobs/${params.taskId}/deliver`, {
        method: "POST",
        body: { deliverable: params.result },
      });
    },

    async sendMessage(params: MarketplaceMessageParams) {
      await nearFetch(nearConfig, `/jobs/${params.taskId}/message`, {
        method: "POST",
        body: { content: params.content },
      });
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      const data = await nearFetch<{ jobs: NearJob[] }>(nearConfig, "/jobs/open");
      return data.jobs.map((j) => ({
        id: j.job_id,
        marketplace: "near" as const,
        description: j.description,
        budget: j.budget_near?.toString(),
        budgetUsd: j.budget_near ? j.budget_near * 4 : undefined,
        category: j.category,
      }));
    },

    async claimBounty(bountyId: string, message?: string) {
      await nearFetch(nearConfig, `/jobs/${bountyId}/bid`, {
        method: "POST",
        body: { message },
      });
    },
  };
}
