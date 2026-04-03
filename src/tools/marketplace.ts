import type { Tool, ToolContext } from "./types.js";
import * as cli from "../moltlaunch/cli.js";

function requireString(input: Record<string, unknown>, key: string): string {
  const val = input[key];
  if (typeof val !== "string" || !val) throw new Error(`Missing required field: ${key}`);
  return val;
}

/**
 * Determine if we should use the marketplace adapter or fall back to mltl CLI.
 * Tasks with globalId prefixes like "freelancer:", "near:", etc. use adapters.
 * Plain task IDs (Moltlaunch) use the CLI.
 */
function isExternalMarketplace(ctx: ToolContext): boolean {
  return Boolean(ctx.adapter && ctx.marketplace && ctx.marketplace !== "moltlaunch");
}

/** Extract the platform-local task ID from a globalId like "freelancer:12345" */
function localTaskId(taskId: string): string {
  const colonIdx = taskId.indexOf(":");
  return colonIdx >= 0 ? taskId.slice(colonIdx + 1) : taskId;
}

export const readTask: Tool = {
  definition: {
    name: "read_task",
    description: "Get full details of a task including messages, files, status, and client feedback.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to read" },
      },
      required: ["task_id"],
    },
  },
  async execute(input, ctx) {
    const taskId = requireString(input, "task_id");
    if (isExternalMarketplace(ctx)) {
      // For external marketplaces, the task description is already in the context
      return { success: true, data: `Task ${taskId} from ${ctx.marketplace}. Full details are in the task context above.` };
    }
    const task = await cli.getTask(taskId);
    return { success: true, data: JSON.stringify(task) };
  },
};

export const quoteTask: Tool = {
  definition: {
    name: "quote_task",
    description: "Submit a price quote/bid for a task. For Moltlaunch: price is in ETH (e.g. '0.005'). For Freelancer.com: price is in USD (e.g. '50'). Include a message explaining your approach.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to quote" },
        price: { type: "string", description: "Price (ETH for Moltlaunch, USD for Freelancer.com)" },
        message: { type: "string", description: "Message to client explaining your approach" },
      },
      required: ["task_id", "price"],
    },
  },
  async execute(input, ctx) {
    const taskId = requireString(input, "task_id");
    const price = requireString(input, "price");
    const message = input.message as string | undefined;

    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const localId = localTaskId(taskId);
      await ctx.adapter.quoteTask({ taskId: localId, price, message });
      return { success: true, data: `Bid submitted on ${ctx.marketplace} for task ${localId} at ${price} ${ctx.marketplace === "freelancer" ? "USD" : ""}` };
    }

    await cli.quoteTask(taskId, price, message);
    return { success: true, data: `Quoted task ${taskId} at ${price} ETH` };
  },
};

export const declineTask: Tool = {
  definition: {
    name: "decline_task",
    description: "Decline a task with an optional reason. Use when the task is outside your expertise or inappropriate.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to decline" },
        reason: { type: "string", description: "Reason for declining" },
      },
      required: ["task_id"],
    },
  },
  async execute(input, ctx) {
    const taskId = requireString(input, "task_id");
    const reason = input.reason as string | undefined;

    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const localId = localTaskId(taskId);
      await ctx.adapter.declineTask(localId, reason);
      return { success: true, data: `Declined task ${localId} on ${ctx.marketplace}` };
    }

    await cli.declineTask(taskId, reason);
    return { success: true, data: `Declined task ${taskId}` };
  },
};

export const submitWork: Tool = {
  definition: {
    name: "submit_work",
    description: "Submit completed work for a task. The result should be the full deliverable (code, text, etc.).",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID to submit work for" },
        result: { type: "string", description: "The complete work deliverable" },
      },
      required: ["task_id", "result"],
    },
  },
  async execute(input, ctx) {
    const taskId = requireString(input, "task_id");
    const result = requireString(input, "result");

    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const localId = localTaskId(taskId);
      await ctx.adapter.submitWork({ taskId: localId, result });
      return { success: true, data: `Submitted work for task ${localId} on ${ctx.marketplace}` };
    }

    await cli.submitWork(taskId, result);
    return { success: true, data: `Submitted work for task ${taskId}` };
  },
};

export const sendMessage: Tool = {
  definition: {
    name: "send_message",
    description: "Send a message to the client on a task thread. Use for clarifications, updates, or questions.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "The task ID" },
        content: { type: "string", description: "Message content" },
      },
      required: ["task_id", "content"],
    },
  },
  async execute(input, ctx) {
    const taskId = requireString(input, "task_id");
    const content = requireString(input, "content");

    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const localId = localTaskId(taskId);
      await ctx.adapter.sendMessage({ taskId: localId, content });
      return { success: true, data: `Message sent on ${ctx.marketplace} task ${localId}` };
    }

    await cli.sendMessage(taskId, content);
    return { success: true, data: `Message sent on task ${taskId}` };
  },
};

export const listBounties: Tool = {
  definition: {
    name: "list_bounties",
    description: "Browse open bounties/projects across all connected marketplaces. Returns available work with descriptions and budgets.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  async execute(_input, ctx) {
    // If we have an adapter, use it; otherwise fall back to Moltlaunch CLI
    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const bounties = await ctx.adapter.getBounties();
      return { success: true, data: JSON.stringify(bounties) };
    }

    const bounties = await cli.getBounties();
    return { success: true, data: JSON.stringify(bounties) };
  },
};

export const claimBounty: Tool = {
  definition: {
    name: "claim_bounty",
    description: "Claim an open bounty/project. Include a message explaining why you're a good fit.",
    input_schema: {
      type: "object",
      properties: {
        bounty_id: { type: "string", description: "The bounty/project ID to claim" },
        message: { type: "string", description: "Why you're a good fit for this bounty" },
      },
      required: ["bounty_id"],
    },
  },
  async execute(input, ctx) {
    const bountyId = requireString(input, "bounty_id");
    const message = input.message as string | undefined;

    if (isExternalMarketplace(ctx) && ctx.adapter) {
      const localId = localTaskId(bountyId);
      await ctx.adapter.claimBounty(localId, message);
      return { success: true, data: `Claimed bounty ${localId} on ${ctx.marketplace}` };
    }

    await cli.claimBounty(bountyId, message);
    return { success: true, data: `Claimed bounty ${bountyId}` };
  },
};
