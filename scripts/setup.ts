/**
 * Setup script: creates the Transit agent and environment on Claude Managed Agents.
 *
 * Run once:  bun run setup
 * Outputs:   agent ID, environment ID — save these for creating sessions.
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs';
import path from 'node:path';

const client = new Anthropic();

// ---------------------------------------------------------------------------
// System prompt — the agent's persona and routing logic
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'agent-prompt.md'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Allowed hosts for transit API calls
// ---------------------------------------------------------------------------
const TRANSIT_API_HOSTS = [
  'data.texas.gov',                    // CapMetro GTFS-RT + static
  'lapi.transitchicago.com',           // CTA Train Tracker
  'www.ctabustracker.com',             // CTA Bus Tracker
  'www.transitchicago.com',            // CTA Alerts + GTFS static
  'api-endpoint.mta.info',             // MTA subway + alerts
  'bustime.mta.info',                  // MTA bus (SIRI + OBA)
  'web.mta.info',                      // MTA GTFS static
  'api.tfl.gov.uk',                    // TfL unified API
  'gtfspublic.metrarr.com',            // Metra GTFS-RT
  'schedules.metrarail.com',           // Metra GTFS static
];

async function main() {
  console.log('=== Transit Agent Setup ===\n');

  // 1. Create the agent
  console.log('Creating agent...');
  const agent = await client.beta.agents.create({
    name: 'Transit',
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT,
    tools: [{ type: 'agent_toolset_20260401' }],
  });
  console.log(`  Agent ID: ${agent.id} (version ${agent.version})`);

  // 2. Create the environment
  console.log('Creating environment...');
  const environment = await client.beta.environments.create({
    name: 'transit-env',
    config: {
      type: 'cloud',
      packages: {
        npm: ['protobufjs@7'],
      },
      networking: {
        type: 'limited',
        allowed_hosts: TRANSIT_API_HOSTS,
        allow_package_managers: true,
        allow_mcp_servers: false,
      },
    },
  });
  console.log(`  Environment ID: ${environment.id}`);

  // 3. Save IDs for later use
  const config = {
    agent_id: agent.id,
    agent_version: agent.version,
    environment_id: environment.id,
    created_at: new Date().toISOString(),
  };
  const configPath = path.join(import.meta.dirname, '..', '.transit-agent.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n  Config saved to .transit-agent.json`);

  console.log('\n=== Setup complete ===');
  console.log('\nNext steps:');
  console.log('  1. Copy .env.example to .env and fill in your transit API keys');
  console.log('  2. Run: bun run session');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
