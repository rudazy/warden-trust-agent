/**
 * Core type definitions for the Warden Trust Agent
 */

// ============================================
// Trust Score Types
// ============================================

export interface TrustScore {
  address: string;
  score: number;
  confidence: number;
  level: TrustLevel;
  factors: TrustFactor[];
  metadata: TrustMetadata;
  timestamp: number;
}

export type TrustLevel =
  | "unknown"
  | "suspicious"
  | "low"
  | "moderate"
  | "high"
  | "very_high";

export interface TrustFactor {
  name: string;
  score: number;
  weight: number;
  description: string;
}

export interface TrustMetadata {
  chain: string;
  entityType: EntityType;
  firstSeen?: string;
  lastActive?: string;
  totalTransactions?: number;
  attestationCount?: number;
  graphDepth?: number;
}

export type EntityType = "wallet" | "agent" | "contract" | "unknown";

// ============================================
// EigenTrust Types
// ============================================

export interface TrustEdge {
  from: string;
  to: string;
  weight: number;
  source: string;
  timestamp: number;
}

export interface TrustNode {
  address: string;
  eigenTrustScore: number;
  directTrustors: number;
  directTrustees: number;
  isPreTrusted: boolean;
}

export interface EigenTrustConfig {
  maxIterations: number;
  convergenceThreshold: number;
  preTrustedWeight: number;
  decayFactor: number;
}

export interface EigenTrustResult {
  scores: Map<string, number>;
  iterations: number;
  converged: boolean;
}

// ============================================
// Graph Types
// ============================================

export interface GraphPath {
  nodes: string[];
  edges: TrustEdge[];
  totalWeight: number;
  hops: number;
}

export interface GraphNeighborhood {
  center: string;
  nodes: TrustNode[];
  edges: TrustEdge[];
  depth: number;
}

// ============================================
// Data Source Types
// ============================================

export interface AttestationData {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  creator: string;
  value: number;
  timestamp: number;
  chain: string;
}

export interface OnChainActivity {
  address: string;
  chain: string;
  transactionCount: number;
  uniqueInteractions: number;
  contractsDeployed: number;
  totalValueTransferred: bigint;
  firstTransaction: string;
  lastTransaction: string;
  age: number;
}

// ============================================
// Agent Types
// ============================================

export interface TrustQuery {
  target: string;
  chain?: string;
  depth?: number;
  includeFactors?: boolean;
  includePaths?: boolean;
}

export interface TrustResponse {
  query: TrustQuery;
  score: TrustScore;
  paths?: GraphPath[];
  neighborhood?: GraphNeighborhood;
  explanation: string;
}

// ============================================
// Config Types
// ============================================

export interface AgentConfig {
  port: number;
  agentUrl: string;
  llm: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey: string;
  };
  neo4j: {
    uri: string;
    user: string;
    password: string;
  };
  intuition: {
    apiUrl: string;
    apiKey: string;
  };
  rpc: {
    ethereum?: string;
    base?: string;
    warden?: string;
  };
  eigenTrust: EigenTrustConfig;
}
