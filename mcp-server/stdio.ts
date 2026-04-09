/**
 * Transit MCP Server — stdio transport for Claude Desktop.
 *
 * This wraps the same transit agent bridge but uses stdio transport
 * instead of HTTP, which is what Claude Desktop expects for local MCP servers.
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Load config from parent project
// ---------------------------------------------------------------------------
const ROOT = path.join(import.meta.dirname, '..');
const configPath = path.join(ROOT, '.transit-agent.json');
const envPath = path.join(ROOT, '.env');

if (!fs.existsSync(configPath)) {
  console.error('Missing .transit-agent.json — run "bun run setup" first.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const AGENT_ID: string = config.agent_id;
const ENVIRONMENT_ID: string = config.environment_id;

// Load .env file
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (val) process.env[key] = val;
  }
}

// Transit API keys to inject into agent sessions
const TRANSIT_KEYS: Record<string, string> = {};
for (const name of ['CTA_TRAIN_API_KEY', 'CTA_BUS_API_KEY', 'MTA_BUS_API_KEY', 'TFL_API_KEY', 'METRA_API_KEY']) {
  if (process.env[name]) TRANSIT_KEYS[name] = process.env[name]!;
}

// ---------------------------------------------------------------------------
// Anthropic client
// ---------------------------------------------------------------------------
const anthropic = new Anthropic();

async function sendAndCollect(sessionId: string, text: string): Promise<string> {
  const stream = await (anthropic.beta.sessions.events as any).stream(sessionId);

  await anthropic.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text }],
      },
    ],
  });

  const chunks: string[] = [];

  for await (const event of stream) {
    switch (event.type) {
      case 'agent.message':
        for (const block of (event as any).content) {
          if (block.type === 'text') chunks.push(block.text);
        }
        break;
      case 'session.status_idle':
        return chunks.join('');
    }
  }

  return chunks.join('') || '(no response from transit agent)';
}

async function queryTransitAgent(question: string): Promise<string> {
  const session = await anthropic.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    title: `MCP transit query ${new Date().toISOString()}`,
  });

  // Combine bootstrap + question into a single message to avoid two round-trips.
  const keyEntries = Object.entries(TRANSIT_KEYS);
  const parts: string[] = [];

  if (keyEntries.length > 0) {
    parts.push(
      'First, silently set up environment variables (do not mention setup to the user):',
      '```bash',
      `cat >> ~/.bashrc << 'ENVEOF'`,
      ...keyEntries.map(([k, v]) => `export ${k}="${v}"`),
      'ENVEOF',
      'source ~/.bashrc',
      '```',
    );
  }

  parts.push(
    'Find transit scripts: `find / -name "capmetro_arrivals.js" -path "*/scripts/*" 2>/dev/null`',
    '',
    'Then answer this user question:',
    question,
  );

  return sendAndCollect(session.id, parts.join('\n'));
}

// ---------------------------------------------------------------------------
// MCP Server (stdio)
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: 'transit',
  version: '1.0.0',
});

server.tool(
  'ask_transit',
  'Ask a public transit question. Supports real-time arrivals, service alerts, route info, and directions for Austin (CapMetro), Chicago (CTA/Metra), New York (MTA), and London (TfL).',
  {
    question: z.string().describe(
      'The transit question to answer, e.g. "when is the next Red Line train from downtown Austin?" or "is the Northern line running?"'
    ),
  },
  async ({ question }) => {
    try {
      const answer = await queryTransitAgent(question);
      return { content: [{ type: 'text' as const, text: answer }] };
    } catch (err: any) {
      return {
        content: [{ type: 'text' as const, text: `Transit agent error: ${err.message}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
