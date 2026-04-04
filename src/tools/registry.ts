import type { ToolDefinition } from "../llm/types.js";
import type { MelistaConfig } from "../config.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import {
  readTask,
  quoteTask,
  declineTask,
  submitWork,
  sendMessage,
  listBounties,
  claimBounty,
} from "./marketplace.js";
import {
  checkWalletBalance,
  readFeedbackHistory,
  memorySearch,
  logActivity,
} from "./utility.js";
import { agentcashFetch, agentcashBalance } from "./agentcash.js";
import { executeCode, sandboxWriteFile, sandboxReadFile, sandboxListFiles } from "./sandbox.js";
import { searchSkills, listAllSkills } from "./skills.js";
import { whopCreateProduct, whopListProducts, whopCheckRevenue } from "./whop.js";

const BASE_TOOLS: Tool[] = [
  readTask,
  quoteTask,
  declineTask,
  submitWork,
  sendMessage,
  listBounties,
  claimBounty,
  checkWalletBalance,
  readFeedbackHistory,
  memorySearch,
  logActivity,
];

const AGENTCASH_TOOLS: Tool[] = [
  agentcashFetch,
  agentcashBalance,
];

const SANDBOX_TOOLS: Tool[] = [
  executeCode,
  sandboxWriteFile,
  sandboxReadFile,
  sandboxListFiles,
];

// Memoize by config reference to avoid rebuilding on every tool call
let cachedConfig: MelistaConfig | null = null;
let cachedToolMap: Map<string, Tool> | null = null;

function buildToolMap(config: MelistaConfig): Map<string, Tool> {
  if (cachedConfig === config && cachedToolMap) return cachedToolMap;
  const WHOP_TOOLS: Tool[] = config.marketplaces?.whop?.apiKey
    ? [whopCreateProduct, whopListProducts, whopCheckRevenue]
    : [];
  let tools = [...BASE_TOOLS, searchSkills, listAllSkills, ...WHOP_TOOLS];
  if (config.agentCashEnabled) tools.push(...AGENTCASH_TOOLS);
  if (config.e2bApiKey) tools.push(...SANDBOX_TOOLS);
  cachedToolMap = new Map(tools.map((t) => [t.definition.name, t]));
  cachedConfig = config;
  return cachedToolMap;
}

export function getToolDefinitions(config: MelistaConfig): ToolDefinition[] {
  const toolMap = buildToolMap(config);
  return [...toolMap.values()].map((t) => t.definition);
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const toolMap = buildToolMap(ctx.config);
  const tool = toolMap.get(name);
  if (!tool) {
    return { success: false, data: `Unknown tool: ${name}` };
  }

  try {
    return await tool.execute(input, ctx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, data: `Tool error: ${msg}` };
  }
}
