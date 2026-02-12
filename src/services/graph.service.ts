/**
 * Neo4j Graph Service
 *
 * Manages the trust graph in Neo4j — storing nodes and edges,
 * running multi-hop traversals, finding shortest trust paths,
 * and extracting neighborhoods for the EigenTrust engine.
 */

import neo4j, { type Driver, type Session } from "neo4j-driver";
import type {
  TrustEdge,
  TrustNode,
  GraphPath,
  GraphNeighborhood,
} from "../types/index.js";

export class GraphService {
  private driver: Driver | null = null;
  private uri: string;
  private user: string;
  private password: string;

  constructor(uri: string, user: string, password: string) {
    this.uri = uri;
    this.user = user;
    this.password = password;
  }

  /**
   * Connect to Neo4j and verify connectivity
   */
  async connect(): Promise<void> {
    this.driver = neo4j.driver(
      this.uri,
      neo4j.auth.basic(this.user, this.password)
    );
    await this.driver.verifyConnectivity();
    await this.ensureIndexes();
    console.log("[GraphService] Connected to Neo4j");
  }

  /**
   * Close the Neo4j connection
   */
  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      console.log("[GraphService] Disconnected from Neo4j");
    }
  }

  /**
   * Create indexes for fast lookups
   */
  private async ensureIndexes(): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        "CREATE INDEX address_index IF NOT EXISTS FOR (n:Address) ON (n.address)"
      );
      await session.run(
        "CREATE INDEX trust_edge_index IF NOT EXISTS FOR ()-[r:TRUSTS]-() ON (r.source)"
      );
    } finally {
      await session.close();
    }
  }

  // ============================================
  // Write Operations
  // ============================================

  /**
   * Upsert a trust node (address) into the graph
   */
  async upsertNode(address: string, properties: Record<string, unknown> = {}): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `MERGE (n:Address {address: $address})
         SET n += $props, n.updatedAt = timestamp()`,
        { address: address.toLowerCase(), props: properties }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Upsert a trust edge between two addresses
   */
  async upsertEdge(edge: TrustEdge): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `MERGE (a:Address {address: $from})
         MERGE (b:Address {address: $to})
         MERGE (a)-[r:TRUSTS {source: $source}]->(b)
         SET r.weight = $weight, r.timestamp = $timestamp, r.updatedAt = timestamp()`,
        {
          from: edge.from.toLowerCase(),
          to: edge.to.toLowerCase(),
          weight: edge.weight,
          source: edge.source,
          timestamp: edge.timestamp,
        }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Bulk upsert edges for efficient batch loading
   */
  async upsertEdgesBatch(edges: TrustEdge[]): Promise<void> {
    const session = this.getSession();
    try {
      await session.run(
        `UNWIND $edges AS e
         MERGE (a:Address {address: e.from})
         MERGE (b:Address {address: e.to})
         MERGE (a)-[r:TRUSTS {source: e.source}]->(b)
         SET r.weight = e.weight, r.timestamp = e.timestamp, r.updatedAt = timestamp()`,
        {
          edges: edges.map((e) => ({
            from: e.from.toLowerCase(),
            to: e.to.toLowerCase(),
            weight: e.weight,
            source: e.source,
            timestamp: e.timestamp,
          })),
        }
      );
    } finally {
      await session.close();
    }
  }

  // ============================================
  // Read Operations
  // ============================================

  /**
   * Get all edges from the graph (for EigenTrust computation)
   */
  async getAllEdges(): Promise<TrustEdge[]> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (a:Address)-[r:TRUSTS]->(b:Address)
         RETURN a.address AS from, b.address AS to, r.weight AS weight,
                r.source AS source, r.timestamp AS timestamp`
      );
      return result.records.map((record) => ({
        from: record.get("from"),
        to: record.get("to"),
        weight: record.get("weight"),
        source: record.get("source"),
        timestamp: record.get("timestamp"),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Get the local neighborhood of an address up to a given depth
   */
  async getNeighborhood(
    address: string,
    depth: number = 2
  ): Promise<GraphNeighborhood> {
    const session = this.getSession();
    try {
      const addr = address.toLowerCase();

      // Get nodes within depth
      const nodesResult = await session.run(
        `MATCH (center:Address {address: $address})
         CALL apoc.path.subgraphNodes(center, {maxLevel: $depth, relationshipFilter: "TRUSTS>"})
         YIELD node
         RETURN node.address AS address,
                node.eigenTrustScore AS eigenTrustScore,
                node.isPreTrusted AS isPreTrusted`,
        { address: addr, depth: neo4j.int(depth) }
      );

      // Fallback: if APOC is not available, use basic traversal
      let nodes: TrustNode[];
      if (nodesResult.records.length === 0) {
        const fallback = await session.run(
          `MATCH path = (center:Address {address: $address})-[:TRUSTS*1..${depth}]->(neighbor:Address)
           WITH DISTINCT neighbor
           RETURN neighbor.address AS address,
                  neighbor.eigenTrustScore AS eigenTrustScore,
                  neighbor.isPreTrusted AS isPreTrusted`,
          { address: addr }
        );
        nodes = fallback.records.map((r) => this.recordToNode(r));
      } else {
        nodes = nodesResult.records.map((r) => this.recordToNode(r));
      }

      // Get edges between neighborhood nodes
      const addresses = [addr, ...nodes.map((n) => n.address)];
      const edgesResult = await session.run(
        `MATCH (a:Address)-[r:TRUSTS]->(b:Address)
         WHERE a.address IN $addresses AND b.address IN $addresses
         RETURN a.address AS from, b.address AS to, r.weight AS weight,
                r.source AS source, r.timestamp AS timestamp`,
        { addresses }
      );

      const edges: TrustEdge[] = edgesResult.records.map((record) => ({
        from: record.get("from"),
        to: record.get("to"),
        weight: record.get("weight"),
        source: record.get("source"),
        timestamp: record.get("timestamp"),
      }));

      return { center: addr, nodes, edges, depth };
    } finally {
      await session.close();
    }
  }

  /**
   * Find the shortest trust path between two addresses
   */
  async findTrustPath(
    from: string,
    to: string,
    maxHops: number = 5
  ): Promise<GraphPath | null> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH path = shortestPath(
           (a:Address {address: $from})-[:TRUSTS*1..${maxHops}]->(b:Address {address: $to})
         )
         WITH path, relationships(path) AS rels, nodes(path) AS ns
         RETURN [n IN ns | n.address] AS nodeAddresses,
                [r IN rels | {weight: r.weight, source: r.source, timestamp: r.timestamp}] AS edgeData`,
        { from: from.toLowerCase(), to: to.toLowerCase() }
      );

      if (result.records.length === 0) return null;

      const record = result.records[0];
      const nodeAddresses: string[] = record.get("nodeAddresses");
      const edgeData: Array<{ weight: number; source: string; timestamp: number }> =
        record.get("edgeData");

      const edges: TrustEdge[] = edgeData.map((e, i) => ({
        from: nodeAddresses[i],
        to: nodeAddresses[i + 1],
        weight: e.weight,
        source: e.source,
        timestamp: e.timestamp,
      }));

      const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0) / edges.length;

      return {
        nodes: nodeAddresses,
        edges,
        totalWeight,
        hops: edges.length,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Get direct trustors (who trusts this address) and trustees (who it trusts)
   */
  async getDirectConnections(
    address: string
  ): Promise<{ trustors: string[]; trustees: string[] }> {
    const session = this.getSession();
    try {
      const addr = address.toLowerCase();

      const trustorsResult = await session.run(
        `MATCH (a:Address)-[:TRUSTS]->(target:Address {address: $address})
         RETURN a.address AS address`,
        { address: addr }
      );

      const trusteesResult = await session.run(
        `MATCH (target:Address {address: $address})-[:TRUSTS]->(b:Address)
         RETURN b.address AS address`,
        { address: addr }
      );

      return {
        trustors: trustorsResult.records.map((r) => r.get("address")),
        trustees: trusteesResult.records.map((r) => r.get("address")),
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Store computed EigenTrust scores back into node properties
   */
  async storeEigenTrustScores(scores: Map<string, number>): Promise<void> {
    const session = this.getSession();
    try {
      const entries = Array.from(scores.entries()).map(([address, score]) => ({
        address,
        score,
      }));

      await session.run(
        `UNWIND $entries AS entry
         MATCH (n:Address {address: entry.address})
         SET n.eigenTrustScore = entry.score, n.scoredAt = timestamp()`,
        { entries }
      );
    } finally {
      await session.close();
    }
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{ nodeCount: number; edgeCount: number }> {
    const session = this.getSession();
    try {
      const result = await session.run(
        `MATCH (n:Address) WITH count(n) AS nodes
         MATCH ()-[r:TRUSTS]->() WITH nodes, count(r) AS edges
         RETURN nodes, edges`
      );
      const record = result.records[0];
      return {
        nodeCount: record.get("nodes").toNumber(),
        edgeCount: record.get("edges").toNumber(),
      };
    } finally {
      await session.close();
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private getSession(): Session {
    if (!this.driver) {
      throw new Error("[GraphService] Not connected. Call connect() first.");
    }
    return this.driver.session();
  }

  private recordToNode(record: { get: (key: string) => unknown }): TrustNode {
    return {
      address: record.get("address") as string,
      eigenTrustScore: (record.get("eigenTrustScore") as number) ?? 0,
      directTrustors: 0,
      directTrustees: 0,
      isPreTrusted: (record.get("isPreTrusted") as boolean) ?? false,
    };
  }
}
