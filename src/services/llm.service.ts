/**
 * LLM Service
 *
 * Abstracts OpenAI and Anthropic APIs for:
 * - Parsing natural language trust queries
 * - Generating human-friendly explanations of trust scores
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { TrustQuery, TrustResponse } from "../types/index.js";
import { formatTrustScore } from "../utils/helpers.js";

type Provider = "openai" | "anthropic";

const SYSTEM_PROMPT = `You are the Warden Trust Agent — an AI-powered trust and reputation scoring system for the blockchain ecosystem.

Your job is to:
1. Understand what the user is asking about trust, reputation, or safety of a wallet/agent/contract
2. Extract the target address and parameters from their query
3. Present trust scores and analysis in clear, actionable language

When presenting results, be direct and specific. Lead with the score and level, then explain the key factors. If trust is low or unknown, say so clearly with recommendations.

You can help users with:
- Scoring a wallet/agent/contract address
- Finding trust paths between two addresses
- Explaining what factors contribute to a trust score
- Syncing and refreshing the trust graph data
- General questions about how trust scoring works

Always refer to specific data when available. Never fabricate scores — if data is unavailable, say so.`;

export class LLMService {
  private provider: Provider;
  private openai?: OpenAI;
  private anthropic?: Anthropic;
  private model: string;

  constructor(provider: Provider, apiKey: string, model: string) {
    this.provider = provider;
    this.model = model;

    if (provider === "openai") {
      this.openai = new OpenAI({ apiKey });
    } else {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Parse a natural language query to extract trust query parameters
   */
  async parseQuery(userMessage: string): Promise<{
    intent: "score" | "path" | "connections" | "sync" | "stats" | "explain" | "general";
    target?: string;
    target2?: string;
    chain?: string;
    depth?: number;
  }> {
    const parsePrompt = `Extract the intent and parameters from this user message about trust/reputation scoring.

User message: "${userMessage}"

Respond in JSON only, no markdown:
{
  "intent": "score" | "path" | "connections" | "sync" | "stats" | "explain" | "general",
  "target": "0x address if present or null",
  "target2": "second 0x address if present (for path queries) or null",
  "chain": "ethereum | base | warden or null",
  "depth": number or null
}

Intent guide:
- "score": user wants to score/check/verify an address
- "path": user wants trust path between two addresses
- "connections": user wants to see who trusts or is trusted by an address
- "sync": user wants to refresh/sync the trust graph data
- "stats": user wants graph statistics
- "explain": user wants to understand how scoring works
- "general": anything else`;

    try {
      const response = await this.complete(parsePrompt, "user");
      const cleaned = response.replace(/```json?|```/g, "").trim();
      return JSON.parse(cleaned);
    } catch {
      return { intent: "general" };
    }
  }

  /**
   * Generate a natural language response from trust data
   */
  async generateResponse(
    userMessage: string,
    trustData: {
      response?: TrustResponse;
      pathResult?: { path: unknown; explanation: string };
      connections?: { trustors: string[]; trustees: string[]; explanation: string };
      stats?: { nodeCount: number; edgeCount: number };
      syncResult?: { edges: number };
      error?: string;
    }
  ): Promise<string> {
    let context = "";

    if (trustData.response) {
      const score = trustData.response.score;
      context = `Trust Score Result:\n${formatTrustScore(score)}\n\nDetailed explanation:\n${trustData.response.explanation}`;
    } else if (trustData.pathResult) {
      context = `Path Result:\n${trustData.pathResult.explanation}`;
    } else if (trustData.connections) {
      context = `Connections:\n${trustData.connections.explanation}`;
    } else if (trustData.stats) {
      context = `Graph Statistics:\n- ${trustData.stats.nodeCount} nodes\n- ${trustData.stats.edgeCount} edges`;
    } else if (trustData.syncResult) {
      context = `Sync completed: ${trustData.syncResult.edges} edges synced to the trust graph.`;
    } else if (trustData.error) {
      context = `Error occurred: ${trustData.error}`;
    }

    const prompt = `User asked: "${userMessage}"

Here is the data from our trust analysis:

${context}

Respond naturally to the user's question using this data. Be concise but informative. If the data shows concerning signals, be direct about it.`;

    return this.complete(prompt, "user");
  }

  /**
   * Low-level completion call
   */
  private async complete(prompt: string, _role: "user" | "system"): Promise<string> {
    if (this.provider === "openai" && this.openai) {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1024,
      });
      return response.choices[0]?.message?.content ?? "";
    }

    if (this.provider === "anthropic" && this.anthropic) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 1024,
      });
      const block = response.content[0];
      return block.type === "text" ? block.text : "";
    }

    throw new Error(`LLM provider ${this.provider} not configured`);
  }
}
