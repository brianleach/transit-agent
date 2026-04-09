#!/usr/bin/env bash
# Start the Transit MCP server with config from the parent project.
# Usage: ./start.sh [port]

set -euo pipefail
cd "$(dirname "$0")"

CONFIG="../.transit-agent.json"
ENV="../.env"

if [ ! -f "$CONFIG" ]; then
  echo "Missing $CONFIG — run 'bun run setup' in the parent directory first."
  exit 1
fi

# Load agent/environment IDs from config
export TRANSIT_AGENT_ID=$(grep -o '"agent_id": "[^"]*"' "$CONFIG" | cut -d'"' -f4)
export TRANSIT_ENVIRONMENT_ID=$(grep -o '"environment_id": "[^"]*"' "$CONFIG" | cut -d'"' -f4)

# Load API keys from .env
if [ -f "$ENV" ]; then
  set -a
  source "$ENV"
  set +a
fi

export PORT="${1:-8787}"

echo "Starting Transit MCP Server..."
exec bun run server.ts
