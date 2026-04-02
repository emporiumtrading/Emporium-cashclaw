/**
 * SingularityNET adapter — placeholder.
 *
 * SingularityNET requires a gRPC daemon sidecar (snetd) and Ethereum payment
 * channels (MPE). Full integration is planned for a future release.
 *
 * Integration path:
 * 1. Run snetd alongside Melista
 * 2. Register as a service via snet-cli
 * 3. snetd handles auth/payment; Melista handles the AI work
 * 4. Payments accumulate in MPE channels (ASI/FET tokens)
 *
 * For now this adapter returns empty results and logs that it's not yet active.
 */
import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";

export interface SingularityNetConfig {
  /** Whether the snetd daemon is running alongside */
  daemonRunning?: boolean;
  /** Organization ID on SingularityNET */
  orgId?: string;
  /** Service ID */
  serviceId?: string;
}

export function createSingularityNetAdapter(
  _config: SingularityNetConfig,
): MarketplaceAdapter {
  return {
    name: "singularitynet",
    label: "SingularityNET (coming soon)",

    isConfigured() {
      return false; // Not yet implemented
    },

    async getInbox(): Promise<MarketplaceTask[]> {
      return [];
    },

    async quoteTask(_params: MarketplaceQuoteParams) {
      throw new Error("SingularityNET integration not yet available");
    },

    async declineTask(_taskId: string) {
      throw new Error("SingularityNET integration not yet available");
    },

    async submitWork(_params: MarketplaceSubmitParams) {
      throw new Error("SingularityNET integration not yet available");
    },

    async sendMessage(_params: MarketplaceMessageParams) {
      throw new Error("SingularityNET integration not yet available");
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      return [];
    },

    async claimBounty(_bountyId: string) {
      throw new Error("SingularityNET integration not yet available");
    },
  };
}
