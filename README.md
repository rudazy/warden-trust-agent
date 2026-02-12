# Warden Trust Agent

AI-powered trust and reputation scoring agent for the [Warden Protocol](https://wardenprotocol.org) ecosystem. Built with `@wardenprotocol/agent-kit`, compatible with the Warden App and Studio via both **A2A** and **LangGraph** protocols.

## What It Does

Ask natural language questions about any wallet, agent, or contract — get a trust score backed by real data:

```
"Is 0x742d35Cc... trustworthy?"
"Score this agent's reputation"
"Show me the trust path between these two addresses"
"Who are the most trusted entities in this network?"
```

## How It Works

The agent combines multiple trust signals into a single score:

1. **EigenTrust Algorithm** — Iterative global trust computation over the trust graph, based on the [EigenTrust paper](https://nlp.stanford.edu/pubs/eigentrust.pdf)
2. **Multi-Hop Graph Traversal** — Neo4j-powered path analysis to find trust relationships across multiple hops
3. **Attestation Data** — On-chain attestations from [Intuition Protocol](https://intuition.systems) providing human-sourced trust signals
4. **On-Chain Activity Analysis** — Transaction history, contract interactions, wallet age, and activity patterns across chains
5. **AI Reasoning** — LLM-powered interpretation that explains scores in plain language

## Architecture

```
                    Warden App / Studio
                   (6.5M+ users discover agents)
                    |                  |
                    | A2A Protocol     | LangGraph API
                    v                  v
    +---------------------------------------------+
    |           Warden Trust Agent                 |
    |                                              |
    |  AgentKit Server   LLM Layer    Trust Tools  |
    |  (A2A + LG API)   (GPT/Claude)  - Score     |
    |                                  - Paths     |
    |                                  - Network   |
    +----------------------|-----------------------+
                           |
         +---------+-------+--------+---------+
         |         |                |         |
       Neo4j    Intuition       On-Chain    Warden
       Graph    GraphQL API     RPCs        Chain
       DB       (attestations)  (ETH/Base)
```

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript
- **Agent Framework**: `@wardenprotocol/agent-kit` (A2A + LangGraph dual protocol)
- **Trust Engine**: Custom EigenTrust implementation
- **Graph DB**: Neo4j (trust graph storage and traversal)
- **Data Sources**: Intuition Protocol, EVM RPCs, Warden Chain
- **LLM**: OpenAI GPT-4o or Anthropic Claude (configurable)
- **Chain Client**: viem (multi-chain EVM support)

## Quick Start

### Prerequisites

- Node.js 18+
- Neo4j instance (local or cloud)
- OpenAI or Anthropic API key
- (Optional) Intuition Protocol API key
- (Optional) Alchemy/Infura RPC URLs

### Installation

```bash
git clone https://github.com/rudazy/warden-trust-agent.git
cd warden-trust-agent
npm install
```

### Configuration

```bash
cp .env.example .env
# Edit .env with your API keys and config
```

Required:
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` — for natural language processing
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` — for trust graph storage

Optional:
- `INTUITION_API_URL`, `INTUITION_API_KEY` — for attestation data
- `ETH_RPC_URL`, `BASE_RPC_URL` — for on-chain activity analysis
- `WARDEN_RPC_URL` — for Warden chain analysis

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm start

# Run tests
npm test
```

Your agent will be available at `http://localhost:3000` with:
- **A2A Discovery**: `GET /.well-known/agent-card.json`
- **A2A Messaging**: `POST /` (JSON-RPC)
- **LangGraph API**: `/assistants`, `/threads`, `/runs`

## Agent Skills

| Skill | Description |
|-------|-------------|
| **Trust Scoring** | Score any wallet, agent, or contract for trustworthiness (0-100) |
| **Trust Path Finder** | Find the shortest trust path between two addresses |
| **Trust Network Analysis** | Analyze who trusts an address and who it trusts |

## Scoring Methodology

The final trust score combines weighted factors from three data sources:

### EigenTrust Graph Score (35%)
- Iterative global trust computation across the trust network
- Considers multi-hop transitive trust relationships
- Pre-trusted peers anchor the scoring

### Attestation Signals (30%)
- **Volume** (15%): Number of attestations about this address
- **Sentiment** (15%): Ratio of positive to negative attestations from Intuition Protocol

### On-Chain Activity (35%)
- **Account Age** (25%): Older wallets score higher
- **Transaction Volume** (20%): More activity indicates genuine usage
- **Interaction Diversity** (20%): More unique counterparties is better
- **Multi-Chain Presence** (15%): Active across chains suggests legitimacy
- **Builder Activity** (20%): Contract deployers get bonus trust

**Confidence Level**: Scales with data availability — 3 sources = 95%, 2 = 75%, 1 = 50%

## Agent-to-Agent (A2A) Usage

Other Warden agents can query trust scores programmatically:

```typescript
import { createA2AOnlyClient } from "@wardenprotocol/agent-kit";

const client = createA2AOnlyClient({ url: "http://trust-agent:3000" });

// Score a wallet
const result = await client.sendText(
  "Score 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
);

// Find trust path
const path = await client.sendText(
  "Trust path from 0xabc... to 0xdef..."
);

// Multi-turn conversation
const t1 = await client.sendText("Score 0xabc...", { contextId: "session-1" });
const t2 = await client.sendText("What factors hurt the score?", { contextId: "session-1" });
```

## LangGraph SDK Usage

```typescript
import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "http://localhost:3000" });
const assistants = await client.assistants.search();
const thread = await client.threads.create();

for await (const event of client.runs.stream(
  thread.thread_id,
  assistants[0].assistant_id,
  {
    input: {
      messages: [
        { role: "user", content: "Is 0x742d35Cc... trustworthy?" },
      ],
    },
    streamMode: "messages",
  }
)) {
  if (event.event === "messages") {
    console.log(event.data);
  }
}
```

## Project Structure

```
warden-trust-agent/
├── src/
│   ├── agent.ts                 # Main entry point (AgentKit server)
│   ├── config/
│   │   └── index.ts             # Environment config loader
│   ├── core/
│   │   ├── eigentrust.ts        # EigenTrust algorithm
│   │   └── eigentrust.test.ts   # EigenTrust tests
│   ├── services/
│   │   ├── graph.service.ts     # Neo4j graph operations
│   │   ├── intuition.service.ts # Intuition Protocol API client
│   │   ├── onchain.service.ts   # On-chain activity analyzer
│   │   └── llm.service.ts       # OpenAI/Anthropic abstraction
│   ├── tools/
│   │   ├── index.ts             # Barrel export
│   │   ├── trust-score.tool.ts  # Main scoring tool
│   │   └── trust-path.tool.ts   # Path finding tool
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   └── utils/
│       ├── helpers.ts           # Utility functions
│       └── helpers.test.ts      # Utility tests
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## Development Roadmap

- [x] Project scaffolding and repo setup
- [x] Type definitions and config
- [x] EigenTrust scoring engine
- [x] Neo4j graph service
- [x] Intuition data integration
- [x] On-chain activity analyzer
- [x] Trust tools (score, paths, network)
- [x] Agent server with AgentKit
- [x] LLM integration and natural language
- [x] Tests and documentation
- [ ] Deploy to Warden Studio
- [ ] AVR module for on-chain verification
- [ ] Warden Chain native agent passport
- [ ] Additional chain support (Solana, Cosmos)

## Built With

- [Warden Protocol](https://wardenprotocol.org) — AI-native L1 for the Agent economy
- [Intuition Protocol](https://intuition.systems) — On-chain attestation and trust data
- [EigenTrust](https://nlp.stanford.edu/pubs/eigentrust.pdf) — Reputation algorithm
- [Neo4j](https://neo4j.com) — Graph database for trust traversal
- [viem](https://viem.sh) — TypeScript EVM client

## License

MIT
