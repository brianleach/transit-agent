/**
 * Interactive session: starts a Transit agent session and streams a conversation.
 *
 * Usage:  bun run session
 *         bun run session "when's the next Red Line train?"
 *
 * Reads agent/environment IDs from .transit-agent.json (created by setup.ts).
 * Reads transit API keys from .env and injects them into the container.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const client = new Anthropic();

function loadConfig(): { agent_id: string; environment_id: string } {
  const configPath = path.join(import.meta.dirname, '..', '.transit-agent.json');
  if (!fs.existsSync(configPath)) {
    console.error('No .transit-agent.json found. Run: bun run setup');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function loadTransitKeys(): Record<string, string> {
  const keys: Record<string, string> = {};
  const envNames = [
    'CTA_TRAIN_API_KEY',
    'CTA_BUS_API_KEY',
    'MTA_BUS_API_KEY',
    'TFL_API_KEY',
    'METRA_API_KEY',
  ];

  // Load from .env file
  const envPath = path.join(import.meta.dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (envNames.includes(key) && val) keys[key] = val;
    }
  }

  // Override with process.env
  for (const name of envNames) {
    if (process.env[name]) keys[name] = process.env[name]!;
  }

  return keys;
}

function buildEnvSetupCommand(keys: Record<string, string>): string {
  const exports = Object.entries(keys)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join(' && ');
  return exports || 'true';
}

async function createSession(config: { agent_id: string; environment_id: string }) {
  return client.beta.sessions.create({
    agent: config.agent_id,
    environment_id: config.environment_id,
    title: `Transit session ${new Date().toISOString()}`,
  });
}

async function sendAndStream(sessionId: string, text: string): Promise<void> {
  const stream = await (client.beta.sessions.events as any).stream(sessionId);

  await client.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text }],
      },
    ],
  });

  for await (const event of stream) {
    switch (event.type) {
      case 'agent.message':
        for (const block of (event as any).content) {
          if (block.type === 'text') process.stdout.write(block.text);
        }
        break;
      case 'agent.tool_use':
        process.stdout.write(`\n  [${(event as any).name}] `);
        break;
      case 'agent.tool_result':
        // Tool finished — output continues in next agent.message
        break;
      case 'session.status_idle':
        process.stdout.write('\n');
        return;
    }
  }
}

async function main() {
  const config = loadConfig();
  const keys = loadTransitKeys();

  const keyCount = Object.keys(keys).length;
  console.log(`Transit Agent (${keyCount} API key${keyCount !== 1 ? 's' : ''} loaded)\n`);

  // Create session
  const session = await createSession(config);
  console.log(`Session: ${session.id}\n`);

  // Bootstrap: upload transit scripts and set env vars
  const bootstrapParts: string[] = [];

  // Set API keys as env vars
  const envCmd = buildEnvSetupCommand(keys);
  if (envCmd !== 'true') {
    bootstrapParts.push(
      `Set these environment variables in your shell before running transit scripts:\n\`\`\`bash\n${envCmd}\n\`\`\``,
    );
  }

  // Upload transit scripts and references
  const transitDir = path.join(import.meta.dirname, '..', 'transit');
  if (fs.existsSync(transitDir)) {
    bootstrapParts.push(
      'The transit skill files (scripts and reference docs) need to be available in the working directory. ' +
      'I will provide them to you via file writes in the first turn.',
    );
  }

  // First message: bootstrap the environment
  const bootstrapMsg = [
    'You are starting a new Transit agent session. Before taking any user queries, set up the environment:',
    '',
    '1. Write the transit scripts and reference docs to the working directory (I will provide them).',
    '2. Set the following environment variables in your shell profile so they persist across bash calls:',
    '',
    '```bash',
    `cat >> ~/.bashrc << 'ENVEOF'`,
    ...Object.entries(keys).map(([k, v]) => `export ${k}="${v}"`),
    'ENVEOF',
    'source ~/.bashrc',
    '```',
    '',
    '3. Run `node transit/scripts/cta_arrivals.js refresh-gtfs` to verify the scripts work (this downloads CTA GTFS data).',
    '',
    'Once setup is complete, respond with a brief ready message listing which cities have API keys configured.',
  ].join('\n');

  console.log('Bootstrapping environment...');
  await sendAndStream(session.id, bootstrapMsg);

  // Interactive loop
  const query = process.argv[2];
  if (query) {
    // One-shot mode
    await sendAndStream(session.id, query);
  } else {
    // Interactive REPL
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question('\n> ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === 'exit' || trimmed === 'quit') {
          console.log('Ending session.');
          rl.close();
          return;
        }
        await sendAndStream(session.id, trimmed);
        prompt();
      });
    };

    prompt();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
