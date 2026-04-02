import type {
  MarketplaceAdapter,
  MarketplaceTask,
  MarketplaceQuoteParams,
  MarketplaceSubmitParams,
  MarketplaceMessageParams,
  MarketplaceBounty,
} from "./types.js";
import type { MelistaConfig } from "../config.js";
import * as cli from "../moltlaunch/cli.js";
import type { Task } from "../moltlaunch/types.js";

function normaliseTask(task: Task): MarketplaceTask {
  return {
    id: task.id,
    marketplace: "moltlaunch",
    globalId: `moltlaunch:${task.id}`,
    client: task.clientAddress,
    description: task.task,
    status: task.status as MarketplaceTask["status"],
    budget: task.budgetWei,
    category: task.category,
    messages: task.messages?.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
    })),
    previousResult: task.result,
    _raw: task,
  };
}

export function createMoltlaunchAdapter(config: MelistaConfig): MarketplaceAdapter {
  return {
    name: "moltlaunch",
    label: "Moltlaunch",

    isConfigured() {
      return Boolean(config.agentId);
    },

    async getInbox() {
      const tasks = await cli.getInbox(config.agentId);
      return tasks.map(normaliseTask);
    },

    async quoteTask(params: MarketplaceQuoteParams) {
      await cli.quoteTask(params.taskId, params.price, params.message);
    },

    async declineTask(taskId: string, reason?: string) {
      await cli.declineTask(taskId, reason);
    },

    async submitWork(params: MarketplaceSubmitParams) {
      await cli.submitWork(params.taskId, params.result);
    },

    async sendMessage(params: MarketplaceMessageParams) {
      await cli.sendMessage(params.taskId, params.content);
    },

    async getBounties(): Promise<MarketplaceBounty[]> {
      const bounties = await cli.getBounties();
      return bounties.map((b) => ({
        id: b.id,
        marketplace: "moltlaunch" as const,
        description: b.task,
        budget: b.budgetWei,
        category: b.category,
      }));
    },

    async claimBounty(bountyId: string, message?: string) {
      await cli.claimBounty(bountyId, message);
    },
  };
}
