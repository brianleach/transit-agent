# Transit Agent

Multi-city public transit agent built on [Claude Managed Agents](https://docs.anthropic.com/en/docs/agents). Real-time arrivals, service alerts, route info, and journey planning for **Austin**, **Chicago**, **NYC**, and **London**.

## What Is This?

A hosted transit assistant powered by Claude. You deploy a managed agent that runs in Anthropic's cloud infrastructure — complete with network access to transit APIs, pre-loaded scripts via the Skills API, and API key management. Ask it "when's the next train?" and it figures out the city, runs the right script, and gives you a natural language answer.

This project migrates five standalone [OpenClaw](https://openclaw.com) transit skills into a single Claude Managed Agent.

## Supported Cities

| City | Agency | Modes | API Key |
|------|--------|-------|---------|
| Austin, TX | CapMetro | MetroBus, MetroRapid, MetroRail | None needed |
| Chicago, IL | CTA | L trains (8 lines), buses | Free key required |
| Chicago, IL | Metra | Commuter rail (11 lines) | Free key required |
| New York, NY | MTA | Subway (27 lines), buses | Free key for bus |
| London, UK | TfL | Tube, DLR, Overground, Elizabeth line, buses | Optional (higher rate limits) |

## Architecture

```
                         ┌─────────────────────────────────────────┐
                         │         Anthropic Cloud Container       │
You ──► Anthropic API ──►│  Claude Sonnet                          │
        (sessions)       │  ├── Transit Skill (pre-loaded)         │
                         │  │   ├── scripts/capmetro_arrivals.js   │
                         │  │   ├── scripts/cta_arrivals.js        │
                         │  │   ├── scripts/mta_arrivals.js        │
                         │  │   ├── scripts/tfl_arrivals.js        │
                         │  │   ├── scripts/metra_arrivals.js      │
                         │  │   └── references/*.md                │
                         │  └── Network access (transit APIs only) │
                         └─────────────────────────────────────────┘
```

**How it works:**
1. `setup.ts` uploads transit scripts as a **Skill**, creates a reusable **Agent** (system prompt + skill), and an **Environment** (container config with network access to transit API hosts)
2. `session.ts` starts a **Session** (running container), injects API keys, and opens an interactive conversation
3. When you ask a transit question, Claude reads the relevant reference doc and runs the appropriate Node.js script
4. The script calls the transit agency's API directly, parses the response, and returns formatted results

**Key design choices:**
- **Skills API** for file loading — scripts and reference docs are pre-loaded at `/workspace/skills/transit/` automatically, no git clone needed
- **Limited networking** — the container can only reach specific transit API hosts, not the whole internet
- **Self-contained scripts** — each agency's script is a single bundled JS file with all dependencies (including protobufjs) inlined
- **API keys via env vars** — injected into the container's shell profile at session start
- **`--use-env-proxy`** — required Node.js flag for network access in managed agent containers

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

# Create skill, agent, and environment on Anthropic's platform
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

## MCP Server (claude.ai Integration)

The `mcp-server/` directory contains an MCP bridge that makes the managed agent accessible from claude.ai, Claude Desktop, and Claude mobile as a custom connector.

### How It Works

```
claude.ai → MCP connector (Vercel) → Managed Agent API → Container → Transit scripts → Transit APIs
```

The MCP server exposes a single tool — `ask_transit(question)` — that creates a managed agent session, sends the question, and returns the response.

### Setup

```bash
cd mcp-server
bun install
```

#### Option A: Deploy to Vercel (for claude.ai)

```bash
# Deploy
vercel --prod

# Set environment variables
vercel env add ANTHROPIC_API_KEY production
vercel env add TRANSIT_AGENT_ID production      # from .transit-agent.json
vercel env add TRANSIT_ENVIRONMENT_ID production # from .transit-agent.json
vercel env add CTA_TRAIN_API_KEY production      # optional
vercel env add CTA_BUS_API_KEY production        # optional

# Redeploy to pick up env vars
vercel --prod
```

Then in claude.ai: **Settings → Connectors → Add custom connector** → enter `https://<your-app>.vercel.app/mcp`

#### Option B: Claude Desktop (local)

The stdio transport (`stdio.ts`) runs locally. Add to your Claude Desktop config (`~/.config/Claude/claude_desktop_config.json` on Linux, `~/Library/Application Support/Claude/claude_desktop_config.json` on Mac):

```json
{
  "mcpServers": {
    "transit": {
      "command": "bun",
      "args": ["run", "/path/to/transit-agent/mcp-server/stdio.ts"]
    }
  }
}
```

Restart Claude Desktop and the `ask_transit` tool will be available in conversations.

#### Option C: Self-hosted HTTP server

```bash
./start.sh        # Loads config from ../.transit-agent.json and ../.env
# or
PORT=8787 bun run server.ts
```

### Latency Note

The MCP bridge adds significant latency (30-60s per query) due to managed agent container spin-up, a second Claude invocation inside the container, and the full round-trip chain. For real-time transit queries, this is noticeably slower than direct API integrations. See [Limitations](#limitations) for details.

## Project Structure

```
transit-agent/
├── agent-prompt.md              ← Agent system prompt
├── scripts/
│   ├── setup.ts                 ← Creates skill + agent + environment
│   ├── session.ts               ← Interactive session with REPL
│   └── demo.ts                  ← One-shot query for testing
├── src/                         ← TypeScript source (transit logic)
│   ├── shared/                  ← Common utilities (proto, GTFS, CSV)
│   ├── capmetro/                ← Austin CapMetro
│   ├── cta/                     ← Chicago CTA
│   ├── mta/                     ← NYC MTA
│   ├── tfl/                     ← London TfL
│   └── metra/                   ← Chicago Metra
├── transit/                     ← Skill bundle (loaded into container)
│   ├── SKILL.md                 ← Skill manifest (name, description)
│   ├── references/              ← Per-agency reference docs
│   └── scripts/                 ← Compiled JS (build output)
├── mcp-server/                  ← MCP bridge for claude.ai
│   ├── api/mcp.ts               ← Vercel serverless function
│   ├── server.ts                ← Standalone HTTP server
│   ├── stdio.ts                 ← Claude Desktop (stdio transport)
│   ├── start.sh                 ← Convenience launcher
│   └── vercel.json              ← Vercel deployment config
├── build.sh                     ← Compile TS → bundled JS
└── .env.example                 ← API key template
```

## API Keys

| Agency | Env Var | Required? | Sign Up |
|--------|---------|-----------|---------|
| CapMetro | — | No key needed | — |
| CTA trains | `CTA_TRAIN_API_KEY` | Yes | [transitchicago.com](https://www.transitchicago.com/developers/traintrackerapply/) |
| CTA buses | `CTA_BUS_API_KEY` | Yes | [transitchicago.com](https://www.transitchicago.com/developers/bustracker/) |
| CTA alerts | — | No key needed | — |
| MTA subway | — | No key needed | — |
| MTA buses | `MTA_BUS_API_KEY` | Yes | [register.developer.obanyc.com](https://register.developer.obanyc.com/) |
| TfL | `TFL_API_KEY` | Optional | [api-portal.tfl.gov.uk](https://api-portal.tfl.gov.uk/) |
| Metra | `METRA_API_KEY` | Yes | [metra.com/developers](https://metra.com/developers) |

## Development

```bash
bun install          # Install dependencies
bun run build        # Compile TS → JS, verify output
bun run typecheck    # Type-check without emitting
```

The transit logic (API clients, parsers, CLI scripts) lives in `src/`. It compiles to self-contained Node.js scripts in `transit/scripts/` via `bun build --target=node`.

### Adding a City

Each city is a directory under `src/` with three files:
- `client.ts` — feed URLs, GTFS directory, constants
- `types.ts` — TypeScript interfaces
- `arrivals.ts` — CLI entry point (parses args, calls APIs, formats output)

Plus a reference doc at `transit/references/<agency>.md` and an entry in the agent prompt.

## Limitations

- **MCP bridge latency** — 30-60s per query through the full chain (claude.ai → Vercel → managed agent → container → script → API → back). Managed agents are designed for long-running autonomous tasks, not quick tool calls.
- **Double billing** — when using the MCP bridge, you pay for Claude twice: your claude.ai subscription + the managed agent API call inside the container.
- **No native claude.ai integration** — managed agents can only be accessed via API, CLI, or Console. There's no way to attach one to your personal Claude account directly. The MCP bridge is a workaround.
- **Container cold starts** — each session spins up a fresh container, adding startup latency.
- **CapMetro real-time feed** — protobuf parsing errors on the trip updates feed (wire type mismatch). Schedule data works; live arrivals intermittent.

## License

MIT
