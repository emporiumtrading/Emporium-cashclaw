/**
 * Multi-marketplace registry.
 *
 * Creates and manages all marketplace adapters. The heartbeat polls each
 * configured adapter in parallel and feeds normalised tasks into the agent loop.
 */
import type { MarketplaceAdapter, MarketplaceTask, MarketplaceBounty } from "./types.js";
import type { MelistaConfig } from "../config.js";
import { createMoltlaunchAdapter } from "./moltlaunch.js";
import { createNearAdapter, type NearMarketConfig } from "./near.js";
import { createFetchaiAdapter, type FetchaiConfig } from "./fetchai.js";
import { createAutonolasAdapter, type AutonolasConfig } from "./autonolas.js";
import { createSingularityNetAdapter, type SingularityNetConfig } from "./singularitynet.js";
import { createFreelancerAdapter, type FreelancerConfig } from "./freelancer.js";
import { createWhopAdapter, type WhopConfig } from "./whop.js";

export type { MarketplaceAdapter, MarketplaceTask, MarketplaceBounty } from "./types.js";
export type { MarketplaceName } from "./types.js";

export interface MarketplacesConfig {
  near?: NearMarketConfig;
  fetchai?: FetchaiConfig;
  autonolas?: AutonolasConfig;
  singularitynet?: SingularityNetConfig;
  freelancer?: FreelancerConfig;
  whop?: WhopConfig;
}

export interface MultiMarketplace {
  /** All adapters (configured or not) */
  all: MarketplaceAdapter[];
  /** Only adapters that are configured and ready */
  active: MarketplaceAdapter[];
  /** Poll all active marketplaces for tasks in parallel */
  pollAll(): Promise<MarketplaceTask[]>;
  /** Browse bounties across all active marketplaces */
  browseBounties(): Promise<MarketplaceBounty[]>;
  /** Find the adapter for a given marketplace name */
  getAdapter(name: string): MarketplaceAdapter | undefined;
  /** Find the adapter that owns a globalId */
  getAdapterForTask(globalId: string): MarketplaceAdapter | undefined;
}

export function createMultiMarketplace(
  config: MelistaConfig,
  marketplacesConfig?: MarketplacesConfig,
): MultiMarketplace {
  const adapters: MarketplaceAdapter[] = [
    createMoltlaunchAdapter(config),
  ];

  if (marketplacesConfig?.near) {
    adapters.push(createNearAdapter(marketplacesConfig.near));
  }

  if (marketplacesConfig?.fetchai) {
    adapters.push(createFetchaiAdapter(marketplacesConfig.fetchai));
  }

  if (marketplacesConfig?.autonolas) {
    adapters.push(createAutonolasAdapter(marketplacesConfig.autonolas));
  }

  if (marketplacesConfig?.singularitynet) {
    adapters.push(createSingularityNetAdapter(marketplacesConfig.singularitynet));
  }

  if (marketplacesConfig?.freelancer) {
    adapters.push(createFreelancerAdapter(marketplacesConfig.freelancer));
  }

  if (marketplacesConfig?.whop) {
    adapters.push(createWhopAdapter(marketplacesConfig.whop));
  }

  const active = adapters.filter((a) => a.isConfigured());

  return {
    all: adapters,
    active,

    async pollAll(): Promise<MarketplaceTask[]> {
      const results = await Promise.allSettled(
        active.map((a) => a.getInbox()),
      );

      const tasks: MarketplaceTask[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          tasks.push(...result.value);
        } else {
          console.error(
            `[${active[i].label}] poll error: ${result.reason}`,
          );
        }
      }

      // Sort by budgetUsd descending — highest-paying tasks first
      tasks.sort((a, b) => (b.budgetUsd ?? 0) - (a.budgetUsd ?? 0));
      return tasks;
    },

    async browseBounties(): Promise<MarketplaceBounty[]> {
      const results = await Promise.allSettled(
        active.map((a) => a.getBounties()),
      );

      const bounties: MarketplaceBounty[] = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === "fulfilled") {
          bounties.push(...result.value);
        }
      }

      bounties.sort((a, b) => (b.budgetUsd ?? 0) - (a.budgetUsd ?? 0));
      return bounties;
    },

    getAdapter(name: string) {
      return adapters.find((a) => a.name === name);
    },

    getAdapterForTask(globalId: string) {
      const marketplace = globalId.split(":")[0];
      return adapters.find((a) => a.name === marketplace);
    },
  };
}
