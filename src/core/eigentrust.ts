/**
 * EigenTrust Algorithm Implementation
 *
 * Computes global trust values through iterative convergence over a trust graph.
 * Based on the EigenTrust paper by Kamvar, Schlosser & Garcia-Molina (2003).
 *
 * How it works:
 * 1. Build a normalized trust matrix from edges (each row sums to 1)
 * 2. Initialize trust vector from pre-trusted peers (or uniform)
 * 3. Iterate: t(k+1) = (1-a) * p + a * C^T * t(k)
 * 4. Stop when convergence threshold is met or max iterations reached
 *
 * The decay factor `a` controls how much weight is given to the network's
 * opinion (transitive trust) vs the pre-trusted distribution.
 */

import type {
  TrustEdge,
  EigenTrustConfig,
  EigenTrustResult,
} from "../types/index.js";

const DEFAULT_CONFIG: EigenTrustConfig = {
  maxIterations: 50,
  convergenceThreshold: 0.0001,
  preTrustedWeight: 0.1,
  decayFactor: 0.85,
};

export class EigenTrustEngine {
  private config: EigenTrustConfig;

  constructor(config: Partial<EigenTrustConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute global trust scores for all nodes in the graph
   *
   * @param edges - Trust relationships between addresses
   * @param preTrusted - Set of addresses considered inherently trustworthy
   * @returns Map of address -> trust score, plus convergence info
   */
  compute(
    edges: TrustEdge[],
    preTrusted: Set<string> = new Set()
  ): EigenTrustResult {
    // Collect all unique nodes from edges
    const nodeSet = new Set<string>();
    for (const edge of edges) {
      nodeSet.add(edge.from);
      nodeSet.add(edge.to);
    }
    const nodes = Array.from(nodeSet);
    const n = nodes.length;

    if (n === 0) {
      return { scores: new Map(), iterations: 0, converged: true };
    }

    // Map each address to a matrix index
    const nodeIndex = new Map<string, number>();
    nodes.forEach((node, i) => nodeIndex.set(node, i));

    // Build normalized trust matrix C where C[i][j] = normalized trust from i to j
    const C = this.buildNormalizedTrustMatrix(edges, nodes, nodeIndex);

    // Initialize pre-trusted distribution vector p
    const p = new Float64Array(n);
    if (preTrusted.size > 0) {
      const preTrustValue = 1 / preTrusted.size;
      for (const addr of preTrusted) {
        const idx = nodeIndex.get(addr);
        if (idx !== undefined) {
          p[idx] = preTrustValue;
        }
      }
    } else {
      // Uniform distribution when no pre-trusted peers specified
      const uniform = 1 / n;
      p.fill(uniform);
    }

    // Start with trust vector t = p
    let t = new Float64Array(p);
    const a = this.config.decayFactor;

    let iterations = 0;
    let converged = false;

    // Iterate until convergence: t(k+1) = (1-a) * p + a * C^T * t(k)
    while (iterations < this.config.maxIterations) {
      const tNew = new Float64Array(n);

      // Matrix-vector multiply: C^T * t
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += C[i][j] * t[i];
        }
        // Blend network trust with pre-trusted baseline
        tNew[j] = (1 - a) * p[j] + a * sum;
      }

      // Check convergence via L1 norm of difference
      let diff = 0;
      for (let i = 0; i < n; i++) {
        diff += Math.abs(tNew[i] - t[i]);
      }

      t = tNew;
      iterations++;

      if (diff < this.config.convergenceThreshold) {
        converged = true;
        break;
      }
    }

    // Package results
    const scores = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      scores.set(nodes[i], t[i]);
    }

    return { scores, iterations, converged };
  }

  /**
   * Get the trust score for a specific address
   * Returns 0 if address is not in the graph
   */
  scoreFor(result: EigenTrustResult, address: string): number {
    return result.scores.get(address.toLowerCase()) ?? 0;
  }

  /**
   * Get the top N most trusted addresses
   */
  topN(result: EigenTrustResult, n: number): Array<{ address: string; score: number }> {
    return Array.from(result.scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([address, score]) => ({ address, score }));
  }

  /**
   * Build the row-normalized trust matrix from edges
   *
   * For each node i, outgoing trust values are normalized so they sum to 1.
   * Negative weights are clamped to 0 (distrust is handled separately).
   * Nodes with no outgoing edges get a uniform row (dangling node handling).
   */
  private buildNormalizedTrustMatrix(
    edges: TrustEdge[],
    nodes: string[],
    nodeIndex: Map<string, number>
  ): number[][] {
    const n = nodes.length;
    const matrix: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(0)
    );

    // Populate raw trust values (clamp negatives to 0)
    for (const edge of edges) {
      const i = nodeIndex.get(edge.from);
      const j = nodeIndex.get(edge.to);
      if (i !== undefined && j !== undefined && i !== j) {
        matrix[i][j] = Math.max(0, edge.weight);
      }
    }

    // Row-normalize: each row sums to 1
    for (let i = 0; i < n; i++) {
      let rowSum = 0;
      for (let j = 0; j < n; j++) {
        rowSum += matrix[i][j];
      }

      if (rowSum > 0) {
        for (let j = 0; j < n; j++) {
          matrix[i][j] /= rowSum;
        }
      } else {
        // Dangling node: distribute trust uniformly
        const uniform = 1 / n;
        for (let j = 0; j < n; j++) {
          matrix[i][j] = uniform;
        }
      }
    }

    return matrix;
  }
}
