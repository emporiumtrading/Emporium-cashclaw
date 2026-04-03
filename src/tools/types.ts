import type { ToolDefinition } from "../llm/types.js";
import type { MelistaConfig } from "../config.js";
import type { MarketplaceAdapter } from "../marketplaces/types.js";

export interface ToolResult {
  success: boolean;
  data: string;
}

export interface ToolContext {
  config: MelistaConfig;
  taskId: string;
  /** Which marketplace this task came from (derived from globalId prefix) */
  marketplace?: string;
  /** The marketplace adapter for this task (for routing actions) */
  adapter?: MarketplaceAdapter;
}

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}
