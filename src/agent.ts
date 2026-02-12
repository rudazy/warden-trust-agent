/**
 * Warden Trust Agent
 *
 * AI-powered trust and reputation scoring agent for the Warden ecosystem.
 * Built with @wardenprotocol/agent-kit, exposing both A2A and LangGraph protocols.
 *
 * Endpoints:
 * - A2A Discovery: GET /.well-known/agent-card.json
 * - A2A Messaging: POST / (JSON-RPC)
 * - LangGraph API: /assistants, /threads, /runs
 */

import "dotenv/config";
import { AgentServer } from "@wardenprotocol/agent-kit";
import { loadConfig } from "./config/index.js";
import { TrustScoreTool } from "./tools/trust-score.tool.js";
import { TrustPathTool } from "./tools/trust-path.tool.js";
import { LLMService } from "./services/llm.service.js";
import { extractAddress } from "./utils/helpers.js";
import type { AgentConfig } from "./types/index.js";

// ============================================
// Agent Handler
// ============================================

async function createHandler(config: AgentConfig) {
  // Initialize services
  const trustScore = new TrustScoreTool(config);
  const trustPath = new TrustPathTool(config);
  const llm = new LLMService(config.llm.provider, config.llm.apiKey, config.llm.model);

  try {
    await trustScore.initialize();
    await trustPath.initialize();
    console.log("[Agent] All services initialized");
  } catch (error) {
    console.warn("[Agent] Some services failed to initialize, running in limited mode:", error);
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log("[Agent] Shutting down...");
    await trustScore.shutdown();
    await trustPath.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Return the handler function for AgentKit
  return async function* handler(context: {
    message: { parts: Array<{ type: string; text?: string }> };
    contextId?: string;
  }) {
    // Extract user message text
    const userMessage = context.message.parts
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join("\n");

    if (!userMessage.trim()) {
      yield {
        state: "completed" as const,
        message: {
          role: "agent" as const,
          parts: [
            {
              type: "text" as const,
              text: "I'm the Warden Trust Agent. Send me a wallet address and I'll score its trustworthiness, or ask me about trust paths between addresses.",
            },
          ],
        },
      };
      return;
    }

    // Send a "working" status
    yield {
      state: "working" as const,
      message: {
        role: "agent" as const,
        parts: [{ type: "text" as const, text: "Analyzing trust data..." }],
      },
    };

    try {
      // Parse user intent
      const parsed = await llm.parseQuery(userMessage);
      let responseText: string;

      switch (parsed.intent) {
        case "score": {
          const target = parsed.target || extractAddress(userMessage);
          if (!target) {
            responseText = "I need a valid Ethereum address (0x...) to score. Please provide one.";
            break;
          }
          const result = await trustScore.score({
            target,
            chain: parsed.chain,
            depth: parsed.depth,
            includeFactors: true,
          });
          responseText = await llm.generateResponse(userMessage, { response: result });
          break;
        }

        case "path": {
          const addr1 = parsed.target || extractAddress(userMessage);
          const addresses = userMessage.match(/0x[a-fA-F0-9]{40}/g);
          const addr2 = parsed.target2 || (addresses && addresses.length >= 2 ? addresses[1] : null);

          if (!addr1 || !addr2) {
            responseText = "I need two valid Ethereum addresses to find a trust path between them.";
            break;
          }
          const pathResult = await trustPath.findPath(addr1, addr2);
          responseText = await llm.generateResponse(userMessage, { pathResult });
          break;
        }

        case "connections": {
          const target = parsed.target || extractAddress(userMessage);
          if (!target) {
            responseText = "I need a valid address to look up connections.";
            break;
          }
          const connections = await trustPath.getConnections(target);
          responseText = await llm.generateResponse(userMessage, { connections });
          break;
        }

        case "sync": {
          const syncResult = await trustScore.syncTrustGraph();
          responseText = await llm.generateResponse(userMessage, { syncResult });
          break;
        }

        case "stats": {
          const stats = await trustScore.getGraphStats();
          responseText = await llm.generateResponse(userMessage, { stats });
          break;
        }

        case "explain": {
          responseText = await llm.generateResponse(userMessage, {
            response: undefined,
          });
          break;
        }

        default: {
          responseText = await llm.generateResponse(userMessage, {});
          break;
        }
      }

      yield {
        state: "completed" as const,
        message: {
          role: "agent" as const,
          parts: [{ type: "text" as const, text: responseText }],
        },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[Agent] Error handling message:", errMsg);

      const errorResponse = await llm.generateResponse(userMessage, {
        error: errMsg,
      });

      yield {
        state: "completed" as const,
        message: {
          role: "agent" as const,
          parts: [{ type: "text" as const, text: errorResponse }],
        },
      };
    }
  };
}

// ============================================
// Main Entry Point
// ============================================

async function main() {
  console.log("========================================");
  console.log("  Warden Trust Agent");
  console.log("  AI-Powered Trust & Reputation Scoring");
  console.log("========================================\n");

  const config = loadConfig();
  const handler = await createHandler(config);

  const server = new AgentServer({
    agentCard: {
      name: "Warden Trust Agent",
      description:
        "AI-powered trust and reputation scoring for wallets, agents, and contracts. Uses EigenTrust algorithms, on-chain analysis, and Intuition Protocol attestations to compute verifiable trust scores across chains.",
      url: config.agentUrl,
      capabilities: {
        streaming: true,
        multiTurn: true,
      },
      skills: [
        {
          id: "trust-score",
          name: "Trust Scoring",
          description:
            "Score any wallet, agent, or contract address for trustworthiness. Combines graph-based trust, attestation data, and on-chain activity into a 0-100 score.",
          tags: ["trust", "reputation", "scoring", "web3"],
          examples: [
            "Is 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18 trustworthy?",
            "Score this wallet: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
            "Check the reputation of 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B",
          ],
        },
        {
          id: "trust-path",
          name: "Trust Path Finder",
          description:
            "Find the shortest trust path between two addresses in the trust graph. Shows how addresses are connected through chains of trust.",
          tags: ["trust", "path", "graph", "connections"],
          examples: [
            "Trust path from 0xabc... to 0xdef...",
            "How are these two wallets connected?",
          ],
        },
        {
          id: "trust-network",
          name: "Trust Network Analysis",
          description:
            "Analyze the trust connections of an address — who trusts them and who they trust.",
          tags: ["trust", "network", "connections"],
          examples: [
            "Who trusts 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18?",
            "Show connections for this address",
          ],
        },
      ],
    },
    handler,
  });

  await server.listen(config.port);

  console.log(`\nAgent running on ${config.agentUrl}`);
  console.log(`- A2A:      POST ${config.agentUrl}/`);
  console.log(`- Discovery: GET ${config.agentUrl}/.well-known/agent-card.json`);
  console.log(`- LangGraph: ${config.agentUrl}/assistants, /threads, /runs`);
  console.log(`- LLM:      ${config.llm.provider} (${config.llm.model})`);
  console.log("\nReady to score trust!\n");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
