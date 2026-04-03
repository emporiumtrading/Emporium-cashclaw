/**
 * Freelancer.com marketplace adapter.
 *
 * Full lifecycle: search projects → submit bids → win → deliver → get paid.
 * Uses Freelancer.com REST API v0.1 with Personal Access Token auth.
 *
 * API docs: https://developers.freelancer.com/docs
 */
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface FreelancerConfig {
  /** Personal Access Token from https://accounts.freelancer.com/settings/develop */
  accessToken: string;
  /** Your Freelancer.com user ID */
  userId?: string;
  /** Skills to search for (Freelancer job IDs) */
  searchKeywords?: string[];
  /** Max bid amount in USD */
  maxBidUsd?: number;
}

const BASE_URL = "https://www.freelancer.com/api";

async function flApi<T>(
  config: FreelancerConfig,
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }

  const resp = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      "Freelancer-OAuth-V1": config.accessToken,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10000), // 10s timeout per request
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Freelancer API ${resp.status}: ${text}`);
  }

  const data = await resp.json() as { status: string; result: T; message?: string };
  if (data.status !== "success") {
    throw new Error(`Freelancer API error: ${data.message ?? "Unknown error"}`);
  }
  return data.result;
}

// --- Freelancer.com types ---

interface FlProject {
  id: number;
  owner_id: number;
  title: string;
  description?: string;
  currency: { id: number; code: string };
  budget: { minimum: number; maximum: number };
  type: "fixed" | "hourly";
  bid_stats?: { bid_count: number; bid_avg: number };
  time_submitted: number;
  jobs?: { id: number; name: string }[];
  status: string;
  seo_url?: string;
}

interface FlBid {
  id: number;
  project_id: number;
  bidder_id: number;
  amount: number;
  period: number;
  description: string;
  award_status?: string;
  time_submitted: number;
}

interface FlThread {
  id: number;
  context?: { id: number; type: string };
}

interface FlMilestone {
  id: number;
  project_id: number;
  description: string;
  amount: number;
  status: string;
}

// --- Normalisation ---

function normaliseProject(p: FlProject): MarketplaceTask {
  const budgetMin = p.budget?.minimum ?? 0;
  const budgetMax = p.budget?.maximum ?? 0;
  const budgetAvg = (budgetMin + budgetMax) / 2;
  const currencyCode = p.currency?.code ?? "USD";
  return {
    id: String(p.id ?? ""),
    marketplace: "freelancer" as const,
    globalId: `freelancer:${p.id}`,
    client: String(p.owner_id ?? ""),
    description: `${p.title ?? ""}\n\n${p.description ?? ""}`.trim(),
    status: "requested",
    budget: budgetAvg > 0 ? `${budgetAvg.toFixed(0)} ${currencyCode}` : undefined,
    budgetUsd: currencyCode === "USD" && budgetAvg > 0 ? budgetAvg : undefined,
    category: p.jobs?.map((j) => j.name).join(", "),
    _raw: p,
  };
}

function normaliseBounty(p: FlProject): MarketplaceBounty {
  const budgetMin = p.budget?.minimum ?? 0;
  const budgetMax = p.budget?.maximum ?? 0;
  const budgetAvg = (budgetMin + budgetMax) / 2;
  const currencyCode = p.currency?.code ?? "USD";
  return {
    id: String(p.id ?? ""),
    marketplace: "freelancer" as const,
    description: p.title ?? "",
    budget: budgetAvg > 0 ? `${budgetAvg.toFixed(0)} ${currencyCode}` : undefined,
    budgetUsd: currencyCode === "USD" && budgetAvg > 0 ? budgetAvg : undefined,
    category: p.jobs?.map((j) => j.name).join(", "),
  };
}

// --- Adapter ---

export function createFreelancerAdapter(flConfig: FreelancerConfig): MarketplaceAdapter {
  // Build search keywords from config
  const keywords = flConfig.searchKeywords ?? [
    "python", "javascript", "typescript", "react", "node",
    "data analysis", "web scraping", "api", "automation",
    "writing", "research", "code review",
  ];

  return {
    name: "freelancer" as const,
    label: "Freelancer.com",

    isConfigured() {
      return Boolean(flConfig.accessToken);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      // Search for active projects matching our skills
      const searchQuery = keywords.slice(0, 5).join(" ");
      const result = await flApi<{ projects?: FlProject[] }>(flConfig, "/projects/0.1/projects/active/", {
        params: {
          query: searchQuery,
          limit: "5",
          sort_field: "time_submitted",
          full_description: "true",
          job_details: "true",
          compact: "true",
        },
      });

      const projects = result.projects ?? [];

      // Also check if we have any awarded bids (won projects)
      let awardedTasks: MarketplaceTask[] = [];
      if (flConfig.userId) {
        try {
          const bidResult = await flApi<{ bids?: FlBid[] }>(flConfig, "/projects/0.1/bids/", {
            params: {
              "bidders[]": flConfig.userId,
              limit: "5",
            },
          });
          const bids = bidResult.bids ?? [];
          const awarded = bids.filter((b) => b.award_status === "awarded");
          awardedTasks = awarded.map((b) => ({
            id: String(b.project_id),
            marketplace: "freelancer" as const,
            globalId: `freelancer:${b.project_id}`,
            client: "",
            description: `Awarded bid #${b.id} on project ${b.project_id}`,
            status: "accepted" as const,
            budget: `${b.amount} USD`,
            budgetUsd: b.amount,
            _raw: b,
          }));
        } catch {
          // Ignore bid lookup errors
        }
      }

      return [...awardedTasks, ...projects.map(normaliseProject)];
    },

    async quoteTask(params: MarketplaceQuoteParams) {
      const projectId = parseInt(params.taskId);
      let amount = parseFloat(params.price);

      // If the LLM sent an ETH amount (< 1), convert to USD estimate
      if (amount < 1) {
        amount = amount * 2050; // approximate ETH→USD
      }

      // Minimum bid on Freelancer.com is typically $10
      if (amount < 10) amount = 10;

      // Cap bid amount
      const maxBid = flConfig.maxBidUsd ?? 500;
      if (amount > maxBid) amount = maxBid;

      // Round to whole number
      amount = Math.round(amount);

      if (!flConfig.userId) {
        throw new Error("Freelancer userId not configured — needed for bidding");
      }

      await flApi(flConfig, "/projects/0.1/bids/", {
        method: "POST",
        body: {
          project_id: projectId,
          bidder_id: parseInt(flConfig.userId),
          amount,
          period: 7,
          milestone_percentage: 100,
          description: params.message ?? "I can complete this project with high quality and fast turnaround. I specialize in this area and deliver production-ready work.",
        },
      });
    },

    async declineTask(_taskId: string, _reason?: string) {
      // No explicit decline on Freelancer.com — just don't bid
    },

    async submitWork(params: MarketplaceSubmitParams) {
      // Request milestone release with the deliverable as a message
      const projectId = parseInt(params.taskId);

      // First, find the milestone for this project
      const milestones = await flApi<{ milestones: FlMilestone[] }>(
        flConfig, "/projects/0.1/milestones/", {
          params: { "projects[]": projectId.toString() },
        },
      );

      if (milestones.milestones.length > 0) {
        const milestone = milestones.milestones[0];
        // Request release
        await flApi(flConfig, `/projects/0.1/milestone_requests/${milestone.id}/`, {
          method: "PUT",
          body: { action: "request" },
        });
      }

      // Also send the deliverable as a message
      await this.sendMessage({
        taskId: params.taskId,
        content: `Deliverable:\n\n${params.result}`,
      });
    },

    async sendMessage(params: MarketplaceMessageParams) {
      const projectId = parseInt(params.taskId);

      // Get or create a thread for this project
      let threadId: number | null = null;

      try {
        const threads = await flApi<{ threads: FlThread[] }>(
          flConfig, "/messages/0.1/threads/", {
            params: { context_type: "project", context: projectId.toString(), limit: "1" },
          },
        );
        if (threads.threads.length > 0) {
          threadId = threads.threads[0].id;
        }
      } catch {
        // Thread lookup may fail
      }

      if (threadId) {
        await flApi(flConfig, `/messages/0.1/threads/${threadId}/messages/`, {
          method: "POST",
          body: { message: params.content },
        });
      }
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      // Browse fresh projects as bounties
      const searchQuery = keywords.slice(0, 3).join(" ");
      const result = await flApi<{ projects?: FlProject[] }>(flConfig, "/projects/0.1/projects/active/", {
        params: {
          query: searchQuery,
          limit: "30",
          sort_field: "time_submitted",
          job_details: "true",
          compact: "true",
        },
      });

      return (result.projects ?? [])
        .filter((p) => (p.bid_stats?.bid_count ?? 0) < 15) // Low competition
        .map(normaliseBounty);
    },

    async claimBounty(bountyId: string, message?: string) {
      // Claiming a bounty = submitting a bid
      await this.quoteTask({
        taskId: bountyId,
        price: "50", // Default competitive bid
        message: message ?? "I'm ready to start immediately. I specialize in this area and can deliver high-quality work fast.",
      });
    },
  };
}
