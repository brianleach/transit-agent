/**
 * Transit MCP Server — bridges Claude (claude.ai, Desktop, mobile) to the Transit managed agent.
 *
 * Exposes one MCP tool: `ask_transit(question)` which creates a managed agent session,
 * sends the question, collects the streamed response, and returns it.
 *
 * Deploy to Cloudflare Workers, Bun, Deno, or any Web Standard runtime.
 * Then add the URL as a custom connector in claude.ai Settings > Connectors.
 */

import Anthropic from '@anthropic-ai/sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------
const AGENT_ID = process.env.TRANSIT_AGENT_ID!;
const ENVIRONMENT_ID = process.env.TRANSIT_ENVIRONMENT_ID!;
const PORT = parseInt(process.env.PORT || '8787', 10);

// Transit API keys to inject into agent sessions
const TRANSIT_KEYS: Record<string, string> = {};
for (const name of ['CTA_TRAIN_API_KEY', 'CTA_BUS_API_KEY', 'MTA_BUS_API_KEY', 'TFL_API_KEY', 'METRA_API_KEY']) {
  if (process.env[name]) TRANSIT_KEYS[name] = process.env[name]!;
}

// ---------------------------------------------------------------------------
// Anthropic client for managed agent API
// ---------------------------------------------------------------------------
const anthropic = new Anthropic();

/**
 * Send a question to the Transit managed agent and collect the full response.
 */
async function queryTransitAgent(question: string): Promise<string> {
  // Create a fresh session
  const session = await anthropic.beta.sessions.create({
    agent: AGENT_ID,
    environment_id: ENVIRONMENT_ID,
    title: `MCP transit query ${new Date().toISOString()}`,
  });

  // Bootstrap: inject API keys
  const keyEntries = Object.entries(TRANSIT_KEYS);
  if (keyEntries.length > 0) {
    const bootstrapMsg = [
      'Set up environment variables silently (do not mention this setup to the user):',
      '```bash',
      `cat >> ~/.bashrc << 'ENVEOF'`,
      ...keyEntries.map(([k, v]) => `export ${k}="${v}"`),
      'ENVEOF',
      'source ~/.bashrc',
      '```',
      'Find the transit scripts: `find / -name "capmetro_arrivals.js" -path "*/scripts/*" 2>/dev/null`',
      'Note the path, then answer the following user question.',
    ].join('\n');

    await sendAndCollect(session.id, bootstrapMsg);
  }

  // Send the actual question
  try {
    return await sendAndCollect(session.id, question);
  } finally {
    await anthropic.beta.sessions.delete(session.id).catch(() => {});
  }
}

/**
 * Send a message to a session and collect the full text response.
 */
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

// ---------------------------------------------------------------------------
// MCP Server setup
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
// HTTP handler (Web Standard — works on Bun, CF Workers, Deno, Node 18+)
// ---------------------------------------------------------------------------

// Track transports by session ID for multi-request sessions
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // Health check
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', agent: AGENT_ID }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    // Check for existing session
    const sessionId = req.headers.get('mcp-session-id');
    const existing = sessionId ? transports.get(sessionId) : null;

    if (existing) {
      return existing.handleRequest(req);
    }

    // New session — create transport and MCP server
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id) => {
        transports.set(id, transport);
      },
      onsessionclosed: (id) => {
        transports.delete(id);
      },
    });

    const server = createMcpServer();
    await server.connect(transport);

    return transport.handleRequest(req);
  }

  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
if (!AGENT_ID || !ENVIRONMENT_ID) {
  console.error('Missing TRANSIT_AGENT_ID and/or TRANSIT_ENVIRONMENT_ID.');
  console.error('Set these from .transit-agent.json or environment variables.');
  process.exit(1);
}

console.log(`Transit MCP Server starting on port ${PORT}`);
console.log(`  Agent: ${AGENT_ID}`);
console.log(`  Environment: ${ENVIRONMENT_ID}`);
console.log(`  Transit API keys: ${Object.keys(TRANSIT_KEYS).join(', ') || 'none'}`);

// Use Bun.serve if available, otherwise Node.js http
const isBun = typeof globalThis !== 'undefined' && 'Bun' in globalThis;

if (isBun) {
  (globalThis as any).Bun.serve({
    port: PORT,
    fetch: handleRequest,
  });
  console.log(`  Listening: http://localhost:${PORT}/mcp`);
} else {
  import('node:http').then(({ createServer }) => {
    createServer(async (req, res) => {
      const url = `http://localhost:${PORT}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0] : v);
      }

      const bodyBuf = req.method !== 'GET' && req.method !== 'HEAD'
        ? await new Promise<Uint8Array>((resolve) => {
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
          })
        : undefined;

      const webReq = new Request(url, {
        method: req.method,
        headers,
        body: bodyBuf as BodyInit | undefined,
      });

      const webRes = await handleRequest(webReq);

      res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
      if (webRes.body) {
        const reader = webRes.body.getReader();
        const pump = async (): Promise<void> => {
          const { done, value } = await reader.read();
          if (done) { res.end(); return; }
          res.write(value);
          await pump();
        };
        await pump();
      } else {
        res.end(await webRes.text());
      }
    }).listen(PORT, () => {
      console.log(`  Listening: http://localhost:${PORT}/mcp`);
    });
  });
}
