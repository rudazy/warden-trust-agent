import "dotenv/config";
import type { AgentConfig, EigenTrustConfig } from "../types/index.js";

const DEFAULT_EIGENTRUST: EigenTrustConfig = {
  maxIterations: 50,
  convergenceThreshold: 0.0001,
  preTrustedWeight: 0.1,
  decayFactor: 0.85,
};

export function loadConfig(): AgentConfig {
  const provider = (process.env.LLM_PROVIDER || "openai") as
    | "openai"
    | "anthropic";

  const apiKey =
    provider === "anthropic"
      ? process.env.ANTHROPIC_API_KEY
      : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      `Missing API key: set ${provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} in your .env`
    );
  }

  return {
    port: parseInt(process.env.PORT || "3000", 10),
    agentUrl: process.env.AGENT_URL || "http://localhost:3000",
    llm: {
      provider,
      model:
        process.env.LLM_MODEL ||
        (provider === "anthropic" ? "claude-sonnet-4-20250514" : "gpt-4o-mini"),
      apiKey,
    },
    neo4j: {
      uri: process.env.NEO4J_URI || "bolt://localhost:7687",
      user: process.env.NEO4J_USER || "neo4j",
      password: process.env.NEO4J_PASSWORD || "",
    },
    intuition: {
      apiUrl:
        process.env.INTUITION_API_URL ||
        "https://api.intuition.systems/v1/graphql",
      apiKey: process.env.INTUITION_API_KEY || "",
    },
    rpc: {
      ethereum: process.env.ETH_RPC_URL,
      base: process.env.BASE_RPC_URL,
      warden: process.env.WARDEN_RPC_URL,
    },
    eigenTrust: DEFAULT_EIGENTRUST,
  };
}
