/**
 * Trust Path Tool
 *
 * Finds and explains trust paths between two addresses
 * in the trust graph. Useful for answering questions like
 * "How is address A connected to address B?"
 */

import { GraphService } from "../services/graph.service.js";
import { isValidAddress, shortenAddress } from "../utils/helpers.js";
import type { GraphPath, AgentConfig } from "../types/index.js";

export class TrustPathTool {
  private graph: GraphService;

  constructor(config: AgentConfig) {
    this.graph = new GraphService(
      config.neo4j.uri,
      config.neo4j.user,
      config.neo4j.password
    );
  }

  async initialize(): Promise<void> {
    await this.graph.connect();
  }

  async shutdown(): Promise<void> {
    await this.graph.disconnect();
  }

  /**
   * Find the trust path between two addresses
   */
  async findPath(
    from: string,
    to: string,
    maxHops = 5
  ): Promise<{ path: GraphPath | null; explanation: string }> {
    if (!isValidAddress(from) || !isValidAddress(to)) {
      return {
        path: null,
        explanation: "One or both addresses are invalid.",
      };
    }

    if (from.toLowerCase() === to.toLowerCase()) {
      return {
        path: null,
        explanation: "Both addresses are the same.",
      };
    }

    console.log(
      `[TrustPathTool] Finding path: ${shortenAddress(from)} -> ${shortenAddress(to)}`
    );

    const path = await this.graph.findTrustPath(from, to, maxHops);

    if (!path) {
      return {
        path: null,
        explanation: `No trust path found between ${shortenAddress(from)} and ${shortenAddress(to)} within ${maxHops} hops. These addresses may not be connected in the trust graph.`,
      };
    }

    const explanation = this.explainPath(path);
    return { path, explanation };
  }

  /**
   * Get all direct trust connections for an address
   */
  async getConnections(
    address: string
  ): Promise<{
    trustors: string[];
    trustees: string[];
    explanation: string;
  }> {
    if (!isValidAddress(address)) {
      return {
        trustors: [],
        trustees: [],
        explanation: "Invalid address format.",
      };
    }

    const connections = await this.graph.getDirectConnections(address);
    const short = shortenAddress(address);

    const explanation = [
      `Direct trust connections for ${short}:`,
      `- ${connections.trustors.length} address(es) trust this address`,
      `- This address trusts ${connections.trustees.length} address(es)`,
    ].join("\n");

    return { ...connections, explanation };
  }

  /**
   * Build a human-readable explanation of a trust path
   */
  private explainPath(path: GraphPath): string {
    const lines: string[] = [];

    lines.push(
      `Trust path found: ${path.hops} hop(s), average weight: ${path.totalWeight.toFixed(3)}`
    );
    lines.push("");

    for (let i = 0; i < path.edges.length; i++) {
      const edge = path.edges[i];
      const from = shortenAddress(edge.from);
      const to = shortenAddress(edge.to);
      const strength =
        edge.weight >= 0.7
          ? "strong"
          : edge.weight >= 0.4
            ? "moderate"
            : "weak";

      lines.push(
        `  ${i + 1}. ${from} --[${strength} trust (${edge.weight.toFixed(2)}), via ${edge.source}]--> ${to}`
      );
    }

    lines.push("");

    if (path.hops <= 2 && path.totalWeight >= 0.6) {
      lines.push("This is a strong, short trust path.");
    } else if (path.hops <= 3) {
      lines.push("This is a moderate trust path with a few intermediaries.");
    } else {
      lines.push(
        "This is a long trust path — the connection is indirect and may carry less weight."
      );
    }

    return lines.join("\n");
  }
}
