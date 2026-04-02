/**
 * Autonolas (OLAS) Mech Marketplace adapter.
 *
 * Connects to the Mech Marketplace on Gnosis chain. Monitors on-chain events
 * for incoming AI task requests and delivers results back on-chain.
 *
 * Uses viem (already a project dependency) for contract interaction.
 */
import { createPublicClient, http, type PublicClient, type Abi } from "viem";
import { gnosis } from "viem/chains";
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface AutonolasConfig {
  /** Private key for signing transactions */
  privateKey?: string;
  /** Mech contract address on Gnosis */
  mechAddress?: string;
  /** RPC URL for Gnosis chain */
  rpcUrl?: string;
}

const MECH_MARKETPLACE_ADDRESS = "0x4554fE75c1f5576c1d7F765B2A036c199Adae329" as const;

// Simplified Mech Marketplace ABI — just the events and views we need
const MARKETPLACE_ABI = [
  {
    type: "event",
    name: "MarketplaceRequest",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "requester", type: "address", indexed: true },
      { name: "data", type: "bytes", indexed: false },
    ],
  },
  {
    type: "function",
    name: "getRequest",
    inputs: [{ name: "requestId", type: "uint256" }],
    outputs: [
      { name: "requester", type: "address" },
      { name: "data", type: "bytes" },
      { name: "status", type: "uint8" },
      { name: "payment", type: "uint256" },
    ],
    stateMutability: "view",
  },
] as const satisfies Abi;

interface MechRequest {
  requestId: string;
  requester: string;
  data: string;
  status: number;
  payment: string;
}

function normaliseStatus(status: number): MarketplaceTask["status"] {
  // 0=pending, 1=assigned, 2=delivered, 3=completed, 4=cancelled
  const map: Record<number, MarketplaceTask["status"]> = {
    0: "requested",
    1: "accepted",
    2: "submitted",
    3: "completed",
    4: "cancelled",
  };
  return map[status] ?? "requested";
}

function normaliseMechRequest(req: MechRequest): MarketplaceTask {
  const xdaiPrice = 1; // xDAI is pegged to USD
  const paymentXdai = parseInt(req.payment) / 1e18;
  return {
    id: req.requestId,
    marketplace: "autonolas",
    globalId: `autonolas:${req.requestId}`,
    client: req.requester,
    description: req.data,
    status: normaliseStatus(req.status),
    budget: paymentXdai.toFixed(4),
    budgetUsd: paymentXdai * xdaiPrice,
    _raw: req,
  };
}

export function createAutonolasAdapter(olasConfig: AutonolasConfig): MarketplaceAdapter {
  let client: PublicClient | null = null;

  function getClient(): PublicClient {
    if (!client) {
      client = createPublicClient({
        chain: gnosis,
        transport: http(olasConfig.rpcUrl ?? "https://rpc.gnosischain.com"),
      });
    }
    return client;
  }

  return {
    name: "autonolas",
    label: "Autonolas Mech Marketplace",

    isConfigured() {
      return Boolean(olasConfig.mechAddress || olasConfig.privateKey);
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      if (!olasConfig.mechAddress) return [];

      const publicClient = getClient();

      // Get recent MarketplaceRequest events (last ~1000 blocks ≈ ~1.5 hours on Gnosis)
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock - 1000n;

      const logs = await publicClient.getLogs({
        address: MECH_MARKETPLACE_ADDRESS,
        event: MARKETPLACE_ABI[0],
        fromBlock: fromBlock > 0n ? fromBlock : 0n,
        toBlock: "latest",
      });

      const tasks: MarketplaceTask[] = [];
      for (const log of logs) {
        const args = log.args as { requestId?: bigint; requester?: string; data?: string };
        if (!args.requestId) continue;

        try {
          const result = await publicClient.readContract({
            address: MECH_MARKETPLACE_ADDRESS,
            abi: MARKETPLACE_ABI,
            functionName: "getRequest",
            args: [args.requestId],
          }) as [string, string, number, bigint];

          const req: MechRequest = {
            requestId: args.requestId.toString(),
            requester: result[0],
            data: decodeData(result[1]),
            status: result[2],
            payment: result[3].toString(),
          };

          // Only include actionable tasks
          if (req.status === 0 || req.status === 1) {
            tasks.push(normaliseMechRequest(req));
          }
        } catch {
          // Skip unreadable requests
        }
      }

      return tasks;
    },

    async quoteTask(_params: MarketplaceQuoteParams) {
      // Mech marketplace uses direct request/deliver model, no quoting step.
      // Accepting a request is implicit by delivering the result.
      throw new Error("Autonolas Mech marketplace does not support quoting — deliver work directly");
    },

    async declineTask(_taskId: string, _reason?: string) {
      // No explicit decline mechanism; simply don't deliver.
    },

    async submitWork(_params: MarketplaceSubmitParams) {
      // On-chain delivery requires a signed transaction.
      // For now this requires the full wallet setup; future: integrate with viem walletClient.
      throw new Error(
        "Autonolas on-chain delivery requires wallet integration. " +
        "Use the mech-client CLI: mechx deliver " + _params.taskId,
      );
    },

    async sendMessage(_params: MarketplaceMessageParams) {
      // Mech marketplace is on-chain only — no messaging layer.
      throw new Error("Autonolas does not support client messaging");
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      // Open requests on the Mech marketplace ARE the bounties
      const tasks = await this.getInbox();
      return tasks
        .filter((t) => t.status === "requested")
        .map((t) => ({
          id: t.id,
          marketplace: "autonolas" as const,
          description: t.description,
          budget: t.budget,
          budgetUsd: t.budgetUsd,
        }));
    },

    async claimBounty(_bountyId: string, _message?: string) {
      // Same as submitWork — requires on-chain tx
      throw new Error("Autonolas bounty claiming requires on-chain transaction");
    },
  };
}

/** Attempt to decode hex data to readable text */
function decodeData(data: string): string {
  try {
    if (data.startsWith("0x")) {
      const hex = data.slice(2);
      const bytes = Buffer.from(hex, "hex");
      const text = bytes.toString("utf-8");
      // If it looks like JSON, parse and extract the prompt
      if (text.startsWith("{")) {
        const parsed = JSON.parse(text) as { prompt?: string; data?: string };
        return parsed.prompt ?? parsed.data ?? text;
      }
      return text;
    }
    return data;
  } catch {
    return data;
  }
}
