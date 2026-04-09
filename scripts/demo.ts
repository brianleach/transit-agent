/**
 * Demo script: creates a one-shot session, asks a transit question, prints the result.
 * Good for testing the setup end-to-end.
 *
 * Usage:  bun run demo
 *         bun run demo "is the Northern line running?"
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const client = new Anthropic();

function loadConfig(): { agent_id: string; environment_id: string } {
  const configPath = path.join(import.meta.dirname, '..', '.transit-agent.json');
  if (!fs.existsSync(configPath)) {
    console.error('No .transit-agent.json found. Run: bun run setup');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function main() {
  const config = loadConfig();
  const query = process.argv[2] || "What's the current status of the London Underground?";

  console.log(`Query: ${query}\n`);

  // Create session
  const session = await client.beta.sessions.create({
    agent: config.agent_id,
    environment_id: config.environment_id,
    title: 'Transit demo',
  });

  // Stream the response
  const stream = await (client.beta.sessions.events as any).stream(session.id);

  await client.beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [{ type: 'text', text: query }],
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
      case 'session.status_idle':
        process.stdout.write('\n');
        // Clean up
        await client.beta.sessions.delete(session.id);
        return;
    }
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
