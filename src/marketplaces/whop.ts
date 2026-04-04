/**
 * Whop marketplace adapter.
 *
 * Unlike other adapters (which find and bid on tasks), Whop is a passive
 * income channel: Melista sells products/services, monitors for new orders,
 * and auto-delivers work when a customer purchases.
 *
 * Flow: Create products → Customer buys → Webhook/poll detects order →
 *       Agent loop generates deliverable → Auto-delivers to customer
 *
 * API docs: https://docs.whop.com/developer/api
 * Base URL: https://api.whop.com/api/v1
 */
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface WhopConfig {
  /** Company API key from Whop dashboard */
  apiKey: string;
  /** Company ID */
  companyId?: string;
}

const BASE_URL = "https://api.whop.com/api/v1";

async function whopFetch<T>(
  config: WhopConfig,
  path: string,
  opts: { method?: string; body?: unknown; params?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (opts.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      url.searchParams.set(k, v);
    }
  }
  if (config.companyId) {
    url.searchParams.set("company_id", config.companyId);
  }

  const resp = await fetch(url.toString(), {
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
    throw new Error(`Whop API ${resp.status}: ${text}`);
  }

  return resp.json() as Promise<T>;
}

// --- Whop types ---

interface WhopMembership {
  id: string;
  product: { id: string; title: string; description?: string };
  plan?: { id: string; title: string };
  user?: { id: string; username?: string; email?: string };
  status: string;
  created_at: string;
  metadata?: Record<string, string>;
}

interface WhopProduct {
  id: string;
  title: string;
  description?: string;
  visibility: string;
  created_at: string;
}

interface WhopPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  membership_id?: string;
  created_at: string;
}

// --- Normalisation ---

function normaliseMembership(m: WhopMembership): MarketplaceTask {
  return {
    id: m.id,
    marketplace: "whop" as "moltlaunch",
    globalId: `whop:${m.id}`,
    client: m.user?.username ?? m.user?.id ?? "customer",
    description: `Whop order: ${m.product?.title ?? "Unknown product"}\n\nCustomer purchased this product and is awaiting delivery. Generate the deliverable based on the product description:\n\n${m.product?.description ?? "No description available."}`,
    status: m.status === "active" ? "accepted" as const : "requested" as const,
    category: "whop-order",
    _raw: m,
  };
}

// --- Adapter ---

export function createWhopAdapter(whopConfig: WhopConfig): MarketplaceAdapter {
  // Track which memberships we've already delivered
  const deliveredMemberships = new Set<string>();

  return {
    name: "whop" as "moltlaunch",
    label: "Whop",

    isConfigured() {
      return Boolean(whopConfig.apiKey);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      // Get recent active memberships (= paid orders)
      const data = await whopFetch<{ data: WhopMembership[] }>(whopConfig, "/memberships", {
        params: {
          status: "active",
          per_page: "10",
        },
      });

      const memberships = data.data ?? [];

      // Filter out already-delivered ones
      const pending = memberships.filter((m) => !deliveredMemberships.has(m.id));

      return pending.map(normaliseMembership);
    },

    async quoteTask(_params: MarketplaceQuoteParams) {
      // Whop doesn't have bidding — products have fixed prices
      // This is a no-op
    },

    async declineTask(_taskId: string, _reason?: string) {
      // Can't decline Whop orders — they're already paid
    },

    async submitWork(params: MarketplaceSubmitParams) {
      const membershipId = params.taskId;

      // Mark as delivered in our tracking
      deliveredMemberships.add(membershipId);

      // Update membership metadata with deliverable info
      try {
        await whopFetch(whopConfig, `/memberships/${membershipId}`, {
          method: "PATCH",
          body: {
            metadata: {
              delivered: "true",
              delivered_at: new Date().toISOString(),
              deliverable_preview: params.result.slice(0, 500),
            },
          },
        });
      } catch {
        // Metadata update is best-effort
      }
    },

    async sendMessage(_params: MarketplaceMessageParams) {
      // Whop doesn't have a messaging API for direct customer comms
      // Would need to integrate with Discord or email
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      // No bounties on Whop — it's a product marketplace
      return [];
    },

    async claimBounty(_bountyId: string, _message?: string) {
      // N/A for Whop
    },
  };
}

// --- Product Management Helpers ---

export async function createWhopProduct(
  config: WhopConfig,
  title: string,
  description: string,
): Promise<string> {
  const result = await whopFetch<{ id: string }>(config, "/products", {
    method: "POST",
    body: {
      title,
      description,
      visibility: "visible",
    },
  });
  return result.id;
}

export async function createWhopPlan(
  config: WhopConfig,
  productId: string,
  price: number,
  currency = "usd",
): Promise<string> {
  const result = await whopFetch<{ id: string }>(config, "/plans", {
    method: "POST",
    body: {
      product_id: productId,
      amount: price * 100, // cents
      currency,
      billing_period: "one_time",
      visibility: "visible",
    },
  });
  return result.id;
}

export async function listWhopProducts(config: WhopConfig): Promise<WhopProduct[]> {
  const data = await whopFetch<{ data: WhopProduct[] }>(config, "/products");
  return data.data ?? [];
}

export async function listWhopPayments(config: WhopConfig): Promise<WhopPayment[]> {
  const data = await whopFetch<{ data: WhopPayment[] }>(config, "/payments");
  return data.data ?? [];
}
