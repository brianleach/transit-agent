/**
 * Setup script: creates the Transit skill, agent, and environment on Claude Managed Agents.
 *
 * Run once:  bun run setup
 * Outputs:   skill ID, agent ID, environment ID — saved to .transit-agent.json
 *
 * The skill bundles transit/SKILL.md + transit/scripts/* + transit/references/*
 * so the agent container has everything pre-loaded — no git clone bootstrap needed.
 */

import Anthropic from '@anthropic-ai/sdk';
import { toFile } from '@anthropic-ai/sdk/uploads';
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

// ---------------------------------------------------------------------------
// Collect transit skill files for upload
// ---------------------------------------------------------------------------
function collectSkillFiles(transitDir: string): { relativePath: string; absolutePath: string }[] {
  const files: { relativePath: string; absolutePath: string }[] = [];

  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else {
        // Relative path keeps "transit/" prefix so the skill directory is preserved
        files.push({
          relativePath: path.relative(path.dirname(transitDir), abs),
          absolutePath: abs,
        });
      }
    }
  }

  walk(transitDir);
  return files;
}

async function main() {
  console.log('=== Transit Agent Setup ===\n');

  const transitDir = path.join(import.meta.dirname, '..', 'transit');

  // 1. Create the skill from the transit/ directory
  console.log('Creating skill from transit/ directory...');
  const skillFiles = collectSkillFiles(transitDir);
  console.log(`  Found ${skillFiles.length} files to upload`);

  const uploadables = await Promise.all(
    skillFiles.map(async (f) => {
      const content = fs.readFileSync(f.absolutePath);
      return toFile(content, f.relativePath);
    }),
  );

  const skill = await client.beta.skills.create({
    display_title: 'Transit',
    files: uploadables,
  });
  console.log(`  Skill ID: ${skill.id} (version ${skill.latest_version})`);

  // 2. Create the agent with the skill attached
  console.log('Creating agent...');
  const agent = await client.beta.agents.create({
    name: 'Transit',
    model: 'claude-sonnet-4-6',
    system: SYSTEM_PROMPT,
    tools: [{ type: 'agent_toolset_20260401' }],
    skills: [{ type: 'custom', skill_id: skill.id }],
  });
  console.log(`  Agent ID: ${agent.id} (version ${agent.version})`);

  // 3. Create the environment
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

  // 4. Save IDs for later use
  const config = {
    skill_id: skill.id,
    skill_version: skill.latest_version,
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
