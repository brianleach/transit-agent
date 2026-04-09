# Transit Agent

Multi-city public transit agent built on [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview). Real-time arrivals, service alerts, route info, and journey planning for **Austin**, **Chicago**, **NYC**, and **London**.

## What Is This?

A hosted transit assistant powered by Claude. Instead of uploading a skill zip to your Claude account, you deploy a managed agent that runs in Anthropic's cloud infrastructure — complete with network access to transit APIs, pre-configured environment, and API key management.

This project migrates five standalone [OpenClaw](https://openclaw.com) transit skills into a single Claude Managed Agent. See the [blog post series](#blog-series) for the full migration story.

## Supported Cities

| City | Agency | Modes | API Key |
|------|--------|-------|---------|
| Austin, TX | CapMetro | MetroBus, MetroRapid, MetroRail | None needed |
| Chicago, IL | CTA | L trains (8 lines), buses | Free key required |
| Chicago, IL | Metra | Commuter rail (11 lines) | Free key required |
| New York, NY | MTA | Subway (27 lines), buses | Free key for bus |
| London, UK | TfL | Tube, DLR, Overground, Elizabeth line, buses | Optional (higher rate limits) |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) installed
- An [Anthropic API key](https://console.anthropic.com/settings/keys)
- (Optional) Transit agency API keys — see `.env.example`

### Setup

```bash
git clone https://github.com/brianleach/transit-agent.git
cd transit-agent
bun install

# Configure API keys
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and any transit keys

# Build transit scripts (compiles TypeScript → bundled JS)
bun run build

# Create the agent and environment on Anthropic's platform
bun run setup
```

### Run

```bash
# Interactive session
bun run session

# One-shot query
bun run demo "when's the next Red Line train?"
bun run demo "is the Northern line running?"
```

## Architecture

```
You (CLI/app) → Anthropic Managed Agents API → Cloud Container
                                                  ├── Claude (Sonnet 4.6)
                                                  ├── Transit scripts (Node.js)
                                                  ├── Reference docs
                                                  └── Network access to transit APIs
```

**How it works:**
1. `setup.ts` creates a reusable **agent** (system prompt + tools) and **environment** (container config with network access to transit API hosts)
2. `session.ts` starts a **session** (running container), injects API keys, and opens an interactive conversation
3. When you ask a transit question, Claude reads the relevant reference doc and runs the appropriate Node.js script to fetch live data
4. The script calls the transit agency's API directly from the container, parses the response, and returns formatted results

**Key design choices:**
- **Limited networking** — the container can only reach the specific transit API hosts, not the whole internet
- **Scripts are self-contained** — each agency's script is a single bundled JS file with all dependencies (including protobufjs) inlined
- **API keys via env vars** — injected into the container's shell profile at session start

## Project Structure

```
transit-agent/
├── agent-prompt.md              ← Agent system prompt
├── scripts/
│   ├── setup.ts                 ← One-time: create agent + environment
│   ├── session.ts               ← Interactive session with REPL
│   └── demo.ts                  ← One-shot query for testing
├── src/                         ← TypeScript source (transit logic)
│   ├── shared/                  ← Common utilities
│   ├── capmetro/                ← Austin CapMetro
│   ├── cta/                     ← Chicago CTA
│   ├── mta/                     ← NYC MTA
│   ├── tfl/                     ← London TfL
│   └── metra/                   ← Chicago Metra
├── transit/                     ← Built artifacts (loaded into container)
│   ├── references/              ← Per-agency reference docs
│   └── scripts/                 ← Compiled JS (build output)
├── build.sh                     ← Compile TS → bundled JS
├── .env.example                 ← API key template
└── .transit-agent.json          ← Saved agent/environment IDs (created by setup)
```

## Development

```bash
bun install          # Install dependencies
bun run build        # Compile TS → JS, verify output
bun run typecheck    # Type-check without emitting
```

The transit logic (API clients, parsers, CLI scripts) lives in `src/`. It compiles to self-contained Node.js scripts in `transit/scripts/` via `bun build --target=node`.

## License

MIT
