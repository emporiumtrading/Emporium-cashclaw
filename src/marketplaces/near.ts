import { getPricesSync } from "../db/prices.js";
/**
 * NEAR AI Agent Market adapter.
 *
 * Full lifecycle: browse jobs → bid → win → deliver → get paid.
 * Uses the /v1 REST API with Bearer token auth (sk_live_...).
 * API docs: https://market.near.ai/skill.md
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
  /** API key (sk_live_...) from agent registration */
  apiKey: string;
  /** Agent handle or ID on NEAR Market */
  agentId?: string;
}

const BASE_URL = "https://market.near.ai/v1";

async function nearFetch<T>(
  config: NearMarketConfig,
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  const resp = await fetch(`${BASE_URL}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`NEAR Market API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

// --- NEAR Market types ---

interface NearJob {
  job_id: string;
  creator_agent_id: string;
  title: string;
  description: string;
  tags?: string[];
  budget_amount?: string;
  budget_token?: string;
  status: string;
  job_type?: string;
  created_at: string;
  my_assignments?: Array<{
    assignment_id: string;
    status: string;
    deliverable?: string;
  }>;
}

interface NearBid {
  bid_id: string;
  job_id: string;
  amount: string;
  eta_seconds: number;
  proposal?: string;
  status: string;
  created_at: string;
}

// --- Normalisation ---

function normaliseStatus(s: string): MarketplaceTask["status"] {
  const map: Record<string, MarketplaceTask["status"]> = {
    open: "requested",
    filling: "requested",
    in_progress: "accepted",
    submitted: "submitted",
    completed: "completed",
    closed: "completed",
    expired: "expired",
    cancelled: "cancelled",
    judging: "submitted",
  };
  return map[s] ?? "requested";
}

function normaliseJob(job: NearJob): MarketplaceTask {
  const nearPrice = getPricesSync().near;
  const budget = job.budget_amount ? parseFloat(job.budget_amount) : undefined;
  return {
    id: job.job_id,
    marketplace: "near",
    globalId: `near:${job.job_id}`,
    client: job.creator_agent_id,
    description: `${job.title}\n\n${job.description}`,
    status: normaliseStatus(job.status),
    budget: job.budget_amount ? `${job.budget_amount} ${job.budget_token ?? "NEAR"}` : undefined,
    budgetUsd: budget ? budget * nearPrice : undefined,
    category: job.tags?.join(", "),
    _raw: job,
  };
}

// --- Adapter ---

export function createNearAdapter(nearConfig: NearMarketConfig): MarketplaceAdapter {
  return {
    name: "near",
    label: "NEAR AI Market",

    isConfigured() {
      return Boolean(nearConfig.apiKey);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      // Get open jobs we can bid on
      const jobs = await nearFetch<NearJob[] | { data: NearJob[] }>(
        nearConfig,
        "/jobs?status=open&limit=10&sort=created_at&order=desc",
      );

      const jobList = Array.isArray(jobs) ? jobs : (jobs.data ?? []);

      // Also check if we have awarded/in-progress assignments
      let myJobs: MarketplaceTask[] = [];
      try {
        const bids = await nearFetch<NearBid[] | { data: NearBid[] }>(
          nearConfig,
          "/agents/me/bids",
        );
        const bidList = Array.isArray(bids) ? bids : (bids.data ?? []);
        const accepted = bidList.filter((b) => b.status === "accepted");

        myJobs = accepted.map((b) => ({
          id: b.job_id,
          marketplace: "near" as const,
          globalId: `near:${b.job_id}`,
          client: "",
          description: `Awarded bid on job ${b.job_id}`,
          status: "accepted" as const,
          budget: `${b.amount} NEAR`,
          budgetUsd: parseFloat(b.amount) * 4,
          _raw: b,
        }));
      } catch {
        // Ignore bid lookup errors
      }

      return [...myJobs, ...jobList.map(normaliseJob)];
    },

    async quoteTask(params: MarketplaceQuoteParams) {
      const jobId = params.taskId;
      let amount = params.price;

      // If sent as a very small number (ETH format), convert to NEAR
      const numAmount = parseFloat(amount);
      if (numAmount < 0.1) {
        // Probably ETH, convert: $X / $4 per NEAR
        const usdValue = numAmount * 2050;
        amount = (usdValue / 4).toFixed(2);
      }

      await nearFetch(nearConfig, `/jobs/${jobId}/bids`, {
        method: "POST",
        body: {
          amount,
          eta_seconds: 86400, // 24 hour delivery
          proposal: params.message ?? "I can complete this task with high quality. I specialize in this area and deliver production-ready work.",
        },
      });
    },

    async declineTask(_taskId: string, _reason?: string) {
      // No explicit decline on NEAR Market — just don't bid
    },

    async submitWork(params: MarketplaceSubmitParams) {
      const jobId = params.taskId;
      await nearFetch(nearConfig, `/jobs/${jobId}/submit`, {
        method: "POST",
        body: {
          deliverable: params.result,
        },
      });
    },

    async sendMessage(params: MarketplaceMessageParams) {
      const jobId = params.taskId;

      // Get assignment ID first
      try {
        const job = await nearFetch<NearJob>(nearConfig, `/jobs/${jobId}`);
        const assignment = job.my_assignments?.[0];
        if (assignment) {
          await nearFetch(nearConfig, `/assignments/${assignment.assignment_id}/messages`, {
            method: "POST",
            body: { message: params.content },
          });
          return;
        }
      } catch {
        // Fall through to public message
      }

      // Public message (only works if we're the creator)
      await nearFetch(nearConfig, `/jobs/${jobId}/messages`, {
        method: "POST",
        body: { message: params.content },
      });
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      const jobs = await nearFetch<NearJob[] | { data: NearJob[] }>(
        nearConfig,
        "/jobs?status=open&limit=20&sort=budget_amount&order=desc",
      );

      const jobList = Array.isArray(jobs) ? jobs : (jobs.data ?? []);
      const nearPrice = getPricesSync().near;

      return jobList.map((j) => ({
        id: j.job_id,
        marketplace: "near" as const,
        description: j.title,
        budget: j.budget_amount ? `${j.budget_amount} ${j.budget_token ?? "NEAR"}` : undefined,
        budgetUsd: j.budget_amount ? parseFloat(j.budget_amount) * nearPrice : undefined,
        category: j.tags?.join(", "),
      }));
    },

    async claimBounty(bountyId: string, message?: string) {
      await this.quoteTask({
        taskId: bountyId,
        price: "2.0", // Default competitive bid in NEAR
        message: message ?? "I'm ready to start immediately. I specialize in this area and can deliver high-quality work fast.",
      });
    },
  };
}
