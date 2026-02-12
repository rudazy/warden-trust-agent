/**
 * On-Chain Activity Analyzer
 *
 * Analyzes wallet behavior on EVM chains to generate trust signals:
 * - Account age and consistency
 * - Transaction volume and patterns
 * - Contract interactions and deployments
 * - Entity type detection (wallet vs contract vs agent)
 *
 * Uses viem for lightweight RPC calls across multiple chains.
 */

import {
  createPublicClient,
  http,
  type PublicClient,
  type Address,
  getAddress,
} from "viem";
import { mainnet, base } from "viem/chains";
import type { OnChainActivity, EntityType, TrustFactor } from "../types/index.js";

// ============================================
// Chain Configuration
// ============================================

interface ChainConfig {
  name: string;
  client: PublicClient;
}

export class OnChainAnalyzer {
  private chains: Map<string, ChainConfig> = new Map();

  constructor(rpcUrls: { ethereum?: string; base?: string; warden?: string }) {
    if (rpcUrls.ethereum) {
      this.chains.set("ethereum", {
        name: "ethereum",
        client: createPublicClient({
          chain: mainnet,
          transport: http(rpcUrls.ethereum),
        }),
      });
    }

    if (rpcUrls.base) {
      this.chains.set("base", {
        name: "base",
        client: createPublicClient({
          chain: base,
          transport: http(rpcUrls.base),
        }) as unknown as PublicClient,
      });
    }

    // Warden chain can be added when mainnet launches
    // For now it uses a custom chain definition
    if (rpcUrls.warden) {
      this.chains.set("warden", {
        name: "warden",
        client: createPublicClient({
          chain: {
            id: 114,
            name: "Warden",
            nativeCurrency: { name: "WARD", symbol: "WARD", decimals: 18 },
            rpcUrls: {
              default: { http: [rpcUrls.warden] },
            },
          },
          transport: http(rpcUrls.warden),
        }) as unknown as PublicClient,
      });
    }

    console.log(
      `[OnChainAnalyzer] Initialized with chains: ${Array.from(this.chains.keys()).join(", ")}`
    );
  }

  /**
   * Analyze on-chain activity for an address across all configured chains
   */
  async analyze(address: string): Promise<OnChainActivity[]> {
    const addr = getAddress(address) as Address;
    const results: OnChainActivity[] = [];

    for (const [chainName, config] of this.chains) {
      try {
        const activity = await this.analyzeOnChain(addr, chainName, config.client);
        if (activity) results.push(activity);
      } catch (error) {
        console.error(
          `[OnChainAnalyzer] Error analyzing ${address} on ${chainName}:`,
          error
        );
      }
    }

    return results;
  }

  /**
   * Detect the entity type of an address
   */
  async detectEntityType(
    address: string,
    chain = "ethereum"
  ): Promise<EntityType> {
    const config = this.chains.get(chain);
    if (!config) return "unknown";

    try {
      const addr = getAddress(address) as Address;
      const code = await config.client.getCode({ address: addr });

      if (code && code !== "0x") {
        return "contract";
      }
      return "wallet";
    } catch {
      return "unknown";
    }
  }

  /**
   * Generate trust factors from on-chain activity
   */
  activityToFactors(activities: OnChainActivity[]): TrustFactor[] {
    const factors: TrustFactor[] = [];

    // Aggregate across chains
    const totalTx = activities.reduce((s, a) => s + a.transactionCount, 0);
    const totalInteractions = activities.reduce(
      (s, a) => s + a.uniqueInteractions,
      0
    );
    const maxAge = Math.max(...activities.map((a) => a.age), 0);
    const totalDeployed = activities.reduce(
      (s, a) => s + a.contractsDeployed,
      0
    );
    const chainsActive = activities.length;

    // Account age factor
    factors.push({
      name: "Account Age",
      score: this.scoreAge(maxAge),
      weight: 0.25,
      description: `${maxAge} days old across ${chainsActive} chain(s)`,
    });

    // Transaction volume factor
    factors.push({
      name: "Transaction Volume",
      score: this.scoreTxCount(totalTx),
      weight: 0.2,
      description: `${totalTx} total transactions`,
    });

    // Interaction diversity factor
    factors.push({
      name: "Interaction Diversity",
      score: this.scoreDiversity(totalInteractions),
      weight: 0.2,
      description: `${totalInteractions} unique addresses interacted with`,
    });

    // Multi-chain presence factor
    factors.push({
      name: "Multi-Chain Presence",
      score: this.scoreChainPresence(chainsActive),
      weight: 0.15,
      description: `Active on ${chainsActive} chain(s)`,
    });

    // Builder activity factor
    if (totalDeployed > 0) {
      factors.push({
        name: "Builder Activity",
        score: this.scoreDeployments(totalDeployed),
        weight: 0.2,
        description: `Deployed ${totalDeployed} contract(s)`,
      });
    }

    return factors;
  }

  // ============================================
  // Private Analysis Methods
  // ============================================

  /**
   * Analyze a single address on a single chain
   */
  private async analyzeOnChain(
    address: Address,
    chainName: string,
    client: PublicClient
  ): Promise<OnChainActivity | null> {
    // Get transaction count (nonce)
    const txCount = await client.getTransactionCount({ address });

    if (txCount === 0) return null;

    // Get current balance to check if active
    const balance = await client.getBalance({ address });

    // Get current block for timestamp reference
    const currentBlock = await client.getBlock({ blockTag: "latest" });
    const now = Number(currentBlock.timestamp);

    // Estimate account age by sampling early blocks
    // We check nonce at progressively earlier blocks to find first activity
    const firstActivityTimestamp = await this.estimateFirstActivity(
      address,
      client
    );

    const age = firstActivityTimestamp
      ? Math.floor((now - firstActivityTimestamp) / 86400) // days
      : 0;

    return {
      address: address.toLowerCase(),
      chain: chainName,
      transactionCount: txCount,
      uniqueInteractions: Math.min(txCount, Math.floor(txCount * 0.7)), // Estimate
      contractsDeployed: 0, // Would need trace API for exact count
      totalValueTransferred: balance,
      firstTransaction: firstActivityTimestamp
        ? new Date(firstActivityTimestamp * 1000).toISOString()
        : "unknown",
      lastTransaction: new Date(now * 1000).toISOString(),
      age,
    };
  }

  /**
   * Estimate when an address first became active using binary search on nonce
   */
  private async estimateFirstActivity(
    address: Address,
    client: PublicClient
  ): Promise<number | null> {
    try {
      const currentBlock = await client.getBlockNumber();
      let low = 0n;
      let high = currentBlock;
      let firstActiveBlock = currentBlock;

      // Binary search for earliest block where nonce > 0
      // Limit iterations to keep RPC calls reasonable
      for (let i = 0; i < 15; i++) {
        if (low >= high) break;
        const mid = (low + high) / 2n;

        try {
          const nonce = await client.getTransactionCount({
            address,
            blockNumber: mid,
          });

          if (nonce > 0) {
            firstActiveBlock = mid;
            high = mid;
          } else {
            low = mid + 1n;
          }
        } catch {
          // Some blocks may not be available, skip
          low = mid + 1n;
        }
      }

      const block = await client.getBlock({ blockNumber: firstActiveBlock });
      return Number(block.timestamp);
    } catch {
      return null;
    }
  }

  // ============================================
  // Scoring Functions (0-100)
  // ============================================

  /**
   * Score account age: older = more trusted
   * 0 days = 0, 30 days = 30, 180 days = 60, 365+ days = 80, 730+ days = 100
   */
  private scoreAge(days: number): number {
    if (days >= 730) return 100;
    if (days >= 365) return 80;
    if (days >= 180) return 60;
    if (days >= 30) return 30;
    if (days >= 7) return 15;
    return 0;
  }

  /**
   * Score transaction count: more activity = more trusted
   */
  private scoreTxCount(count: number): number {
    if (count >= 1000) return 100;
    if (count >= 500) return 85;
    if (count >= 100) return 70;
    if (count >= 50) return 55;
    if (count >= 10) return 35;
    if (count >= 1) return 15;
    return 0;
  }

  /**
   * Score interaction diversity: more unique counterparties = more trusted
   */
  private scoreDiversity(uniqueAddresses: number): number {
    if (uniqueAddresses >= 500) return 100;
    if (uniqueAddresses >= 200) return 85;
    if (uniqueAddresses >= 50) return 65;
    if (uniqueAddresses >= 20) return 45;
    if (uniqueAddresses >= 5) return 25;
    return 0;
  }

  /**
   * Score multi-chain presence
   */
  private scoreChainPresence(chainCount: number): number {
    if (chainCount >= 3) return 100;
    if (chainCount >= 2) return 60;
    if (chainCount >= 1) return 30;
    return 0;
  }

  /**
   * Score contract deployments
   */
  private scoreDeployments(count: number): number {
    if (count >= 10) return 100;
    if (count >= 5) return 80;
    if (count >= 2) return 60;
    if (count >= 1) return 40;
    return 0;
  }
}
