/**
 * Trust Score Tool
 *
 * The main scoring tool that combines all data sources:
 * 1. EigenTrust global score from the trust graph
 * 2. Intuition attestation signals
 * 3. On-chain activity analysis
 *
 * Produces a unified TrustScore with factors, confidence, and level.
 */

import { EigenTrustEngine } from "../core/eigentrust.js";
import { GraphService } from "../services/graph.service.js";
import { IntuitionService } from "../services/intuition.service.js";
import { OnChainAnalyzer } from "../services/onchain.service.js";
import {
  normalizeScore,
  scoreToLevel,
  weightedAverage,
  isValidAddress,
} from "../utils/helpers.js";
import type {
  TrustScore,
  TrustFactor,
  TrustQuery,
  TrustResponse,
  AgentConfig,
} from "../types/index.js";

export class TrustScoreTool {
  private eigenTrust: EigenTrustEngine;
  private graph: GraphService;
  private intuition: IntuitionService;
  private onchain: OnChainAnalyzer;

  constructor(config: AgentConfig) {
    this.eigenTrust = new EigenTrustEngine(config.eigenTrust);
    this.graph = new GraphService(
      config.neo4j.uri,
      config.neo4j.user,
      config.neo4j.password
    );
    this.intuition = new IntuitionService(
      config.intuition.apiUrl,
      config.intuition.apiKey
    );
    this.onchain = new OnChainAnalyzer(config.rpc);
  }

  /**
   * Initialize connections (call before scoring)
   */
  async initialize(): Promise<void> {
    try {
      await this.graph.connect();
      console.log("[TrustScoreTool] Initialized successfully");
    } catch (error) {
      console.warn(
        "[TrustScoreTool] Neo4j not available, running in limited mode:",
        error
      );
    }
  }

  /**
   * Shutdown connections
   */
  async shutdown(): Promise<void> {
    await this.graph.disconnect();
  }

  /**
   * Score a target address — the main entry point
   */
  async score(query: TrustQuery): Promise<TrustResponse> {
    const target = query.target.toLowerCase();
    const chain = query.chain || "ethereum";
    const depth = query.depth || 3;

    if (!isValidAddress(target)) {
      return this.buildErrorResponse(query, "Invalid address format");
    }

    console.log(`[TrustScoreTool] Scoring ${target} on ${chain}...`);

    // Run all data fetches in parallel
    const [
      eigenTrustScore,
      attestationFactors,
      onchainFactors,
      entityType,
    ] = await Promise.all([
      this.computeEigenTrust(target, depth),
      this.computeAttestationFactors(target),
      this.computeOnChainFactors(target),
      this.onchain.detectEntityType(target, chain),
    ]);

    // Combine all factors
    const allFactors: TrustFactor[] = [
      ...eigenTrustScore.factors,
      ...attestationFactors,
      ...onchainFactors,
    ];

    // Calculate final weighted score
    const finalScore =
      allFactors.length > 0
        ? weightedAverage(allFactors)
        : 0;

    // Calculate confidence based on data availability
    const confidence = this.calculateConfidence(
      eigenTrustScore.factors.length > 0,
      attestationFactors.length > 0,
      onchainFactors.length > 0
    );

    const trustScore: TrustScore = {
      address: target,
      score: finalScore,
      confidence,
      level: scoreToLevel(finalScore),
      factors: allFactors,
      metadata: {
        chain,
        entityType,
        attestationCount: attestationFactors.length > 0
          ? parseInt(
              attestationFactors.find((f) => f.name === "Attestation Volume")
                ?.description.match(/\d+/)?.[0] || "0",
              10
            )
          : undefined,
        graphDepth: depth,
      },
      timestamp: Date.now(),
    };

    // Build explanation
    const explanation = this.buildExplanation(trustScore);

    return {
      query,
      score: trustScore,
      explanation,
    };
  }

  /**
   * Sync trust data from Intuition into Neo4j
   */
  async syncTrustGraph(batchSize = 1000): Promise<{ edges: number }> {
    console.log("[TrustScoreTool] Syncing trust graph from Intuition...");

    const edges = await this.intuition.fetchAllEdges(batchSize);

    if (edges.length > 0) {
      await this.graph.upsertEdgesBatch(edges);
      console.log(`[TrustScoreTool] Synced ${edges.length} edges to Neo4j`);
    }

    return { edges: edges.length };
  }

  /**
   * Recompute EigenTrust scores for the entire graph
   */
  async recomputeGlobalScores(): Promise<{
    nodes: number;
    iterations: number;
    converged: boolean;
  }> {
    console.log("[TrustScoreTool] Recomputing global EigenTrust scores...");

    const allEdges = await this.graph.getAllEdges();
    const result = this.eigenTrust.compute(allEdges);

    // Store scores back in Neo4j
    await this.graph.storeEigenTrustScores(result.scores);

    console.log(
      `[TrustScoreTool] Computed scores for ${result.scores.size} nodes in ${result.iterations} iterations (converged: ${result.converged})`
    );

    return {
      nodes: result.scores.size,
      iterations: result.iterations,
      converged: result.converged,
    };
  }

  /**
   * Get graph statistics
   */
  async getGraphStats(): Promise<{
    nodeCount: number;
    edgeCount: number;
  }> {
    return this.graph.getStats();
  }

  // ============================================
  // Private: Factor Computation
  // ============================================

  /**
   * Compute EigenTrust-based trust factor
   */
  private async computeEigenTrust(
    target: string,
    depth: number
  ): Promise<{ factors: TrustFactor[] }> {
    try {
      // Get local neighborhood and compute EigenTrust on it
      const neighborhood = await this.graph.getNeighborhood(target, depth);

      if (neighborhood.edges.length === 0) {
        return { factors: [] };
      }

      const result = this.eigenTrust.compute(neighborhood.edges);
      const rawScore = result.scores.get(target) ?? 0;

      // Normalize: EigenTrust raw scores are typically small decimals
      const maxScore = Math.max(...Array.from(result.scores.values()), 0.001);
      const normalized = normalizeScore(rawScore, 0, maxScore);

      // Get direct connections for context
      const connections = await this.graph.getDirectConnections(target);

      return {
        factors: [
          {
            name: "Graph Trust (EigenTrust)",
            score: normalized,
            weight: 0.35,
            description: `Score from ${neighborhood.nodes.length} nodes, ${connections.trustors.length} trustors, ${connections.trustees.length} trustees`,
          },
        ],
      };
    } catch (error) {
      console.warn("[TrustScoreTool] EigenTrust computation failed:", error);
      return { factors: [] };
    }
  }

  /**
   * Compute trust factors from Intuition attestations
   */
  private async computeAttestationFactors(
    target: string
  ): Promise<TrustFactor[]> {
    try {
      const [attestations, stats] = await Promise.all([
        this.intuition.fetchAttestationsForAddress(target, 100),
        this.intuition.getAccountStats(target),
      ]);

      if (attestations.length === 0 && !stats) return [];

      const factors: TrustFactor[] = [];

      // Attestation volume
      const attCount = attestations.length;
      factors.push({
        name: "Attestation Volume",
        score: this.scoreAttestationCount(attCount),
        weight: 0.15,
        description: `${attCount} attestations found`,
      });

      // Attestation sentiment (ratio of positive to negative)
      if (attCount > 0) {
        const positive = attestations.filter((a) => a.value > 0).length;
        const negative = attestations.filter((a) => a.value < 0).length;
        const sentiment =
          attCount > 0 ? Math.round((positive / attCount) * 100) : 50;

        factors.push({
          name: "Attestation Sentiment",
          score: sentiment,
          weight: 0.15,
          description: `${positive} positive, ${negative} negative attestations`,
        });
      }

      // Stake weight (if account has vault data)
      if (stats && stats.totalStaked > 0) {
        factors.push({
          name: "Stake Weight",
          score: this.scoreStakeWeight(stats.totalStaked),
          weight: 0.1,
          description: `${stats.totalStaked} total shares staked`,
        });
      }

      return factors;
    } catch (error) {
      console.warn("[TrustScoreTool] Attestation fetch failed:", error);
      return [];
    }
  }

  /**
   * Compute trust factors from on-chain activity
   */
  private async computeOnChainFactors(target: string): Promise<TrustFactor[]> {
    try {
      const activities = await this.onchain.analyze(target);
      if (activities.length === 0) return [];
      return this.onchain.activityToFactors(activities);
    } catch (error) {
      console.warn("[TrustScoreTool] On-chain analysis failed:", error);
      return [];
    }
  }

  // ============================================
  // Private: Helpers
  // ============================================

  private calculateConfidence(
    hasGraph: boolean,
    hasAttestations: boolean,
    hasOnChain: boolean
  ): number {
    let sources = 0;
    if (hasGraph) sources++;
    if (hasAttestations) sources++;
    if (hasOnChain) sources++;

    // Confidence scales with number of data sources
    if (sources === 3) return 0.95;
    if (sources === 2) return 0.75;
    if (sources === 1) return 0.5;
    return 0.1;
  }

  private scoreAttestationCount(count: number): number {
    if (count >= 50) return 100;
    if (count >= 20) return 80;
    if (count >= 10) return 60;
    if (count >= 5) return 40;
    if (count >= 1) return 20;
    return 0;
  }

  private scoreStakeWeight(totalShares: number): number {
    if (totalShares >= 1000000) return 100;
    if (totalShares >= 100000) return 80;
    if (totalShares >= 10000) return 60;
    if (totalShares >= 1000) return 40;
    if (totalShares >= 100) return 20;
    return 0;
  }

  private buildExplanation(score: TrustScore): string {
    const lines: string[] = [];

    lines.push(
      `Trust score for ${score.address}: ${score.score}/100 (${score.level.replace("_", " ")})`
    );
    lines.push(
      `Confidence: ${Math.round(score.confidence * 100)}% — based on ${score.factors.length} factors across ${score.confidence >= 0.75 ? "multiple" : "limited"} data sources.`
    );

    if (score.factors.length > 0) {
      lines.push("\nKey factors:");
      const sorted = [...score.factors].sort((a, b) => b.weight - a.weight);
      for (const factor of sorted) {
        lines.push(`- ${factor.name}: ${factor.score}/100 (${factor.description})`);
      }
    }

    if (score.score >= 70) {
      lines.push(
        "\nThis address shows strong trust signals across the analyzed data sources."
      );
    } else if (score.score >= 50) {
      lines.push(
        "\nThis address shows moderate trust. Some positive signals but limited history or mixed attestations."
      );
    } else if (score.score >= 30) {
      lines.push(
        "\nThis address has low trust signals. Limited on-chain history or few positive attestations."
      );
    } else {
      lines.push(
        "\nInsufficient data to establish trust, or concerning signals detected. Exercise caution."
      );
    }

    return lines.join("\n");
  }

  private buildErrorResponse(query: TrustQuery, error: string): TrustResponse {
    return {
      query,
      score: {
        address: query.target,
        score: 0,
        confidence: 0,
        level: "unknown",
        factors: [],
        metadata: {
          chain: query.chain || "unknown",
          entityType: "unknown",
        },
        timestamp: Date.now(),
      },
      explanation: `Error: ${error}`,
    };
  }
}
