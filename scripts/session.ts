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

async function deleteSession(sessionId: string) {
  try {
    await client.beta.sessions.delete(sessionId);
    console.log('\nSession deleted.');
  } catch {
    // Session may already be gone — ignore
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

  // Clean up session on exit
  const cleanup = () => deleteSession(session.id).then(() => process.exit(0));
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Bootstrap: inject API keys into the container's shell profile.
  // Transit scripts and references are pre-loaded via the skill — no file upload needed.
  const keyEntries = Object.entries(keys);
  const bootstrapLines = [
    'You are starting a new Transit agent session. Set up the environment:',
    '',
  ];

  if (keyEntries.length > 0) {
    bootstrapLines.push(
      '1. Set these environment variables in your shell profile so they persist across bash calls:',
      '',
      '```bash',
      `cat >> ~/.bashrc << 'ENVEOF'`,
      ...keyEntries.map(([k, v]) => `export ${k}="${v}"`),
      'ENVEOF',
      'source ~/.bashrc',
      '```',
    );
  } else {
    bootstrapLines.push(
      '1. No API keys are configured. CapMetro (Austin), MTA subway (NYC), TfL (London), and CTA alerts will work without keys.',
    );
  }

  bootstrapLines.push(
    '',
    '2. The transit skill files (scripts/ and references/) are pre-loaded in your working directory.',
    '   Find the scripts with: `find / -name "capmetro_arrivals.js" 2>/dev/null` then note the path.',
    '   Use `node --use-env-proxy <path>/scripts/<agency>_arrivals.js` for all script calls.',
    '',
    '3. Verify scripts work by running one quick command (e.g. TfL status or CTA alerts).',
    '',
    'Once setup is complete, respond with a brief ready message listing which cities are available and which have API keys configured.',
  );

  console.log('Bootstrapping environment...');
  await sendAndStream(session.id, bootstrapLines.join('\n'));

  // Interactive loop
  const query = process.argv[2];
  if (query) {
    // One-shot mode
    await sendAndStream(session.id, query);
    await deleteSession(session.id);
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
          rl.close();
          await deleteSession(session.id);
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
