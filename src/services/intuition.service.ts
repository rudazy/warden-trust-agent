/**
 * Intuition Protocol Data Service
 *
 * Fetches attestation data from Intuition's GraphQL API and converts
 * it into trust edges for the EigenTrust engine.
 *
 * Intuition's knowledge graph uses:
 * - Atoms: individual entities (wallets, concepts, labels)
 * - Triples: subject-predicate-object relationships between atoms
 * - Positions: stakes (for/against) on atoms and triples
 *
 * We convert positive positions into trust edges and negative positions
 * into distrust signals, building a weighted trust graph.
 */

import { GraphQLClient, gql } from "graphql-request";
import type { TrustEdge, AttestationData } from "../types/index.js";

// ============================================
// GraphQL Queries
// ============================================

const QUERY_TRIPLES = gql`
  query GetTriples($limit: Int!, $offset: Int!) {
    triples(limit: $limit, offset: $offset, order_by: { block_timestamp: desc }) {
      id
      subject {
        id
        label
        type
        wallet_id
      }
      predicate {
        id
        label
      }
      object {
        id
        label
        type
        wallet_id
      }
      creator {
        id
        label
      }
      vault {
        total_shares
        current_share_price
        position_count
      }
      counter_vault {
        total_shares
        current_share_price
        position_count
      }
      block_timestamp
    }
  }
`;

const QUERY_TRIPLES_FOR_ADDRESS = gql`
  query GetTriplesForAddress($address: String!, $limit: Int!) {
    triples(
      limit: $limit
      where: {
        _or: [
          { subject: { wallet_id: { _eq: $address } } }
          { object: { wallet_id: { _eq: $address } } }
          { creator: { id: { _eq: $address } } }
        ]
      }
      order_by: { block_timestamp: desc }
    ) {
      id
      subject {
        id
        label
        type
        wallet_id
      }
      predicate {
        id
        label
      }
      object {
        id
        label
        type
        wallet_id
      }
      creator {
        id
        label
      }
      vault {
        total_shares
        current_share_price
        position_count
      }
      counter_vault {
        total_shares
        current_share_price
        position_count
      }
      block_timestamp
    }
  }
`;

const QUERY_POSITIONS_FOR_ADDRESS = gql`
  query GetPositionsForAddress($address: String!, $limit: Int!) {
    positions(
      limit: $limit
      where: { account_id: { _eq: $address } }
      order_by: { block_timestamp: desc }
    ) {
      id
      account_id
      vault_id
      shares
      vault {
        triple {
          id
          subject {
            id
            label
            wallet_id
          }
          predicate {
            id
            label
          }
          object {
            id
            label
            wallet_id
          }
        }
        atom {
          id
          label
          wallet_id
        }
        total_shares
        position_count
      }
      block_timestamp
    }
  }
`;

const QUERY_ACCOUNT_STATS = gql`
  query GetAccountStats($address: String!) {
    account(id: $address) {
      id
      label
      type
      atom {
        id
        vault {
          total_shares
          position_count
        }
      }
    }
  }
`;

// ============================================
// Types for GraphQL Responses
// ============================================

interface AtomNode {
  id: string;
  label: string | null;
  type: string | null;
  wallet_id: string | null;
}

interface VaultData {
  total_shares: string;
  current_share_price: string;
  position_count: number;
}

interface TripleData {
  id: string;
  subject: AtomNode;
  predicate: AtomNode;
  object: AtomNode;
  creator: { id: string; label: string | null };
  vault: VaultData | null;
  counter_vault: VaultData | null;
  block_timestamp: string;
}

// ============================================
// Service
// ============================================

export class IntuitionService {
  private client: GraphQLClient;

  constructor(apiUrl: string, apiKey?: string) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    this.client = new GraphQLClient(apiUrl, { headers });
  }

  /**
   * Fetch recent triples and convert to trust edges
   */
  async fetchTrustEdges(limit = 1000, offset = 0): Promise<TrustEdge[]> {
    try {
      const data = await this.client.request<{ triples: TripleData[] }>(
        QUERY_TRIPLES,
        { limit, offset }
      );
      return this.triplesToEdges(data.triples);
    } catch (error) {
      console.error("[IntuitionService] Error fetching triples:", error);
      return [];
    }
  }

  /**
   * Fetch trust edges related to a specific address
   */
  async fetchEdgesForAddress(
    address: string,
    limit = 100
  ): Promise<TrustEdge[]> {
    try {
      const data = await this.client.request<{ triples: TripleData[] }>(
        QUERY_TRIPLES_FOR_ADDRESS,
        { address: address.toLowerCase(), limit }
      );
      return this.triplesToEdges(data.triples);
    } catch (error) {
      console.error(
        `[IntuitionService] Error fetching edges for ${address}:`,
        error
      );
      return [];
    }
  }

  /**
   * Fetch attestation data for a specific address
   */
  async fetchAttestationsForAddress(
    address: string,
    limit = 100
  ): Promise<AttestationData[]> {
    try {
      const data = await this.client.request<{ triples: TripleData[] }>(
        QUERY_TRIPLES_FOR_ADDRESS,
        { address: address.toLowerCase(), limit }
      );
      return data.triples.map((triple) => this.tripleToAttestation(triple));
    } catch (error) {
      console.error(
        `[IntuitionService] Error fetching attestations for ${address}:`,
        error
      );
      return [];
    }
  }

  /**
   * Get stats for an account (attestation count, vault data)
   */
  async getAccountStats(
    address: string
  ): Promise<{ attestationCount: number; totalStaked: number } | null> {
    try {
      const data = await this.client.request<{
        account: {
          id: string;
          atom: { vault: VaultData | null } | null;
        } | null;
      }>(QUERY_ACCOUNT_STATS, { address: address.toLowerCase() });

      if (!data.account) return null;

      const vault = data.account.atom?.vault;
      return {
        attestationCount: vault?.position_count ?? 0,
        totalStaked: vault ? parseInt(vault.total_shares, 10) : 0,
      };
    } catch (error) {
      console.error(
        `[IntuitionService] Error fetching account stats for ${address}:`,
        error
      );
      return null;
    }
  }

  /**
   * Fetch all trust edges in batches (for full graph sync)
   */
  async fetchAllEdges(batchSize = 1000, maxBatches = 10): Promise<TrustEdge[]> {
    const allEdges: TrustEdge[] = [];

    for (let i = 0; i < maxBatches; i++) {
      const edges = await this.fetchTrustEdges(batchSize, i * batchSize);
      allEdges.push(...edges);

      console.log(
        `[IntuitionService] Batch ${i + 1}: fetched ${edges.length} edges (total: ${allEdges.length})`
      );

      // Stop if we got fewer than batch size (no more data)
      if (edges.length < batchSize) break;
    }

    return allEdges;
  }

  // ============================================
  // Conversion Helpers
  // ============================================

  /**
   * Convert Intuition triples to trust edges
   *
   * Weight logic:
   * - Creator of a triple signals trust from creator -> subject
   * - Vault positions (for) increase weight
   * - Counter-vault positions (against) decrease weight
   * - Weight is normalized to [-1, 1]
   */
  private triplesToEdges(triples: TripleData[]): TrustEdge[] {
    const edges: TrustEdge[] = [];

    for (const triple of triples) {
      const creatorAddr = triple.creator.id.toLowerCase();

      // Extract subject and object addresses
      const subjectAddr = this.resolveAddress(triple.subject);
      const objectAddr = this.resolveAddress(triple.object);

      if (!subjectAddr && !objectAddr) continue;

      // Calculate weight from vault positions
      const forPositions = triple.vault?.position_count ?? 0;
      const againstPositions = triple.counter_vault?.position_count ?? 0;
      const totalPositions = forPositions + againstPositions;
      const weight =
        totalPositions > 0 ? (forPositions - againstPositions) / totalPositions : 0.5;

      const timestamp = new Date(triple.block_timestamp).getTime();

      // Creator -> Subject edge (creator attests about subject)
      if (subjectAddr && creatorAddr !== subjectAddr) {
        edges.push({
          from: creatorAddr,
          to: subjectAddr,
          weight,
          source: "intuition",
          timestamp,
        });
      }

      // Creator -> Object edge (creator references object)
      if (objectAddr && creatorAddr !== objectAddr) {
        edges.push({
          from: creatorAddr,
          to: objectAddr,
          weight: weight * 0.5, // Lower weight for indirect reference
          source: "intuition",
          timestamp,
        });
      }

      // Subject -> Object edge (semantic relationship)
      if (subjectAddr && objectAddr && subjectAddr !== objectAddr) {
        edges.push({
          from: subjectAddr,
          to: objectAddr,
          weight: weight * 0.3, // Lower weight for semantic link
          source: "intuition-semantic",
          timestamp,
        });
      }
    }

    return edges;
  }

  /**
   * Convert a triple to attestation data format
   */
  private tripleToAttestation(triple: TripleData): AttestationData {
    return {
      id: triple.id,
      subject: triple.subject.label || triple.subject.id,
      predicate: triple.predicate.label || triple.predicate.id,
      object: triple.object.label || triple.object.id,
      creator: triple.creator.id,
      value: this.computeTripleValue(triple),
      timestamp: new Date(triple.block_timestamp).getTime(),
      chain: "base",
    };
  }

  /**
   * Resolve an atom to its wallet address (if it has one)
   */
  private resolveAddress(atom: AtomNode): string | null {
    if (atom.wallet_id) return atom.wallet_id.toLowerCase();
    // Check if the label looks like an address
    if (atom.label && /^0x[a-fA-F0-9]{40}$/.test(atom.label)) {
      return atom.label.toLowerCase();
    }
    return null;
  }

  /**
   * Compute a normalized value for a triple based on vault activity
   */
  private computeTripleValue(triple: TripleData): number {
    const forCount = triple.vault?.position_count ?? 0;
    const againstCount = triple.counter_vault?.position_count ?? 0;
    const total = forCount + againstCount;
    if (total === 0) return 0;
    return (forCount - againstCount) / total;
  }
}
