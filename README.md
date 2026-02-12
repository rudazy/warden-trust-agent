# 🛡️ Warden Trust Agent

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
┌─────────────────────────────────────────────────┐
│                  Warden App / Studio             │
│              (6.5M+ users discover agents)       │
└──────────────┬──────────────────┬────────────────┘
               │ A2A Protocol     │ LangGraph API
               ▼                  ▼
┌─────────────────────────────────────────────────┐
│              Warden Trust Agent                  │
│  ┌──────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ AgentKit │  │ LLM Layer │  │ Trust Tools  │  │
│  │ Server   │  │ (GPT/     │  │ - Score      │  │
│  │ (A2A +   │  │  Claude)  │  │ - Paths      │  │
│  │  LG API) │  │           │  │ - Network    │  │
│  └──────────┘  └───────────┘  └──────┬───────┘  │
└──────────────────────────────────────┼───────────┘
                                       │
        ┌──────────────────────────────┼──────────┐
        ▼              ▼               ▼          ▼
  ┌──────────┐  ┌───────────┐  ┌──────────┐ ┌────────┐
  │  Neo4j   │  │ Intuition │  │ On-Chain │ │ Warden │
  │  Graph   │  │ GraphQL   │  │ RPCs     │ │ Chain  │
  │  DB      │  │ API       │  │ (ETH,    │ │        │
  │          │  │           │  │  Base)   │ │        │
  └──────────┘  └───────────┘  └──────────┘ └────────┘
```

## Tech Stack

- **Runtime**: Node.js 18+ / TypeScript
- **Agent Framework**: `@wardenprotocol/agent-kit` (A2A + LangGraph dual protocol)
- **Trust Engine**: Custom EigenTrust implementation
- **Graph DB**: Neo4j (trust graph storage & traversal)
- **Data Sources**: Intuition Protocol, EVM RPCs, Warden Chain
- **LLM**: OpenAI GPT-4o or Anthropic Claude (configurable)

## Quick Start

### Prerequisites

- Node.js 18+
- Neo4j instance (local or cloud)
- OpenAI or Anthropic API key

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

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm start
```

Your agent will be available at `http://localhost:3000` with:
- **A2A Discovery**: `GET /.well-known/agent-card.json`
- **A2A Messaging**: `POST /` (JSON-RPC)
- **LangGraph API**: `/assistants`, `/threads`, `/runs`

## Agent-to-Agent (A2A) Usage

Other Warden agents can query trust scores programmatically:

```typescript
import { createA2AOnlyClient } from "@wardenprotocol/agent-kit";

const client = createA2AOnlyClient({ url: "http://trust-agent:3000" });

// Score a wallet
const result = await client.sendText("Score 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18");

// Check trust between two addresses
const path = await client.sendText(
  "Trust path from 0xabc... to 0xdef..."
);
```

## Roadmap

- [x] Step 1: Project scaffolding & repo setup
- [ ] Step 2: Type definitions & config
- [ ] Step 3: EigenTrust scoring engine
- [ ] Step 4: Neo4j graph service
- [ ] Step 5: Intuition data integration
- [ ] Step 6: On-chain activity analyzer
- [ ] Step 7: Trust tools (score, paths, network)
- [ ] Step 8: Agent server with AgentKit
- [ ] Step 9: LLM integration & natural language
- [ ] Step 10: Tests & documentation

## Built With

- [Warden Protocol](https://wardenprotocol.org) — AI-native L1 for the Agent economy
- [Intuition Protocol](https://intuition.systems) — On-chain attestation & trust data
- [EigenTrust](https://nlp.stanford.edu/pubs/eigentrust.pdf) — Reputation algorithm

## License

MIT
