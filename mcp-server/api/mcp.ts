/**
 * Transit MCP Server — Vercel serverless function.
 *
 * Bridges claude.ai to the Transit managed agent via MCP Streamable HTTP.
 * Each invocation is stateless — a new MCP server + transport per request.
 *
 * Add as a custom connector in claude.ai: https://<your-app>.vercel.app/api/mcp
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config from Vercel environment variables
// ---------------------------------------------------------------------------
const AGENT_ID = process.env.TRANSIT_AGENT_ID!;
const ENVIRONMENT_ID = process.env.TRANSIT_ENVIRONMENT_ID!;

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

  try {
    return await sendAndCollect(session.id, parts.join('\n'));
  } finally {
    await anthropic.beta.sessions.delete(session.id).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MCP Server factory
// ---------------------------------------------------------------------------
function createMcpServer(): McpServer {
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

  return server;
}

// ---------------------------------------------------------------------------
// Vercel handler — stateless, one transport per request
// ---------------------------------------------------------------------------
export async function GET(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: Request): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function DELETE(req: Request): Promise<Response> {
  return new Response(null, { status: 200 });
}
