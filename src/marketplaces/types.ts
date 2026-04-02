/**
 * Abstract marketplace interface.
 *
 * Each marketplace adapter normalises its platform-specific task model into
 * `MarketplaceTask`, which the heartbeat and agent loop consume identically
 * regardless of origin.
 */

export type MarketplaceName = "moltlaunch" | "near" | "fetchai" | "autonolas" | "singularitynet";

export type MarketplaceTaskStatus =
  | "requested"
  | "quoted"
  | "accepted"
  | "submitted"
  | "revision"
  | "completed"
  | "declined"
  | "expired"
  | "cancelled";

export interface MarketplaceTask {
  /** Unique ID within the marketplace */
  id: string;
  /** Which marketplace this task came from */
  marketplace: MarketplaceName;
  /** Composite key for dedup across marketplaces */
  globalId: string;
  /** Client identifier (address, username, etc.) */
  client: string;
  /** Task description / prompt */
  description: string;
  /** Normalised status */
  status: MarketplaceTaskStatus;
  /** Budget in the marketplace's native currency (human-readable string) */
  budget?: string;
  /** Budget converted to USD estimate for cross-marketplace prioritisation */
  budgetUsd?: number;
  /** Category / tags */
  category?: string;
  /** Messages from the client */
  messages?: { role: "client" | "agent"; content: string; timestamp: number }[];
  /** Previous submission (for revisions) */
  previousResult?: string;
  /** Raw platform-specific data for the adapter to use on actions */
  _raw?: unknown;
}

export interface MarketplaceQuoteParams {
  taskId: string;
  /** Price in the marketplace's native denomination */
  price: string;
  message?: string;
}

export interface MarketplaceSubmitParams {
  taskId: string;
  result: string;
}

export interface MarketplaceMessageParams {
  taskId: string;
  content: string;
}

export interface MarketplaceBounty {
  id: string;
  marketplace: MarketplaceName;
  description: string;
  budget?: string;
  budgetUsd?: number;
  category?: string;
}

export interface MarketplaceAdapter {
  /** Adapter name */
  readonly name: MarketplaceName;

  /** Human-readable label */
  readonly label: string;

  /** Whether this adapter is configured and ready */
  isConfigured(): boolean;

  /** Fetch current inbox / available tasks */
  getInbox(): Promise<MarketplaceTask[]>;

  /** Quote / bid on a task */
  quoteTask(params: MarketplaceQuoteParams): Promise<void>;

  /** Decline a task */
  declineTask(taskId: string, reason?: string): Promise<void>;

  /** Submit completed work */
  submitWork(params: MarketplaceSubmitParams): Promise<void>;

  /** Send a message to the client */
  sendMessage(params: MarketplaceMessageParams): Promise<void>;

  /** Browse open bounties (if supported) */
  getBounties(): Promise<MarketplaceBounty[]>;

  /** Claim a bounty (if supported) */
  claimBounty(bountyId: string, message?: string): Promise<void>;

  /** Optional: connect real-time channel (WebSocket etc.) */
  connectRealtime?(onTask: (task: MarketplaceTask) => void): void;

  /** Optional: disconnect real-time channel */
  disconnectRealtime?(): void;
}
