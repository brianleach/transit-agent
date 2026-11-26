// The HTTP bridge fails closed: no configured token means 503 for everyone,
// a wrong token means 401, and only the right bearer token reaches the handler.
// No Anthropic call is made: the handler is a stub, and the Vercel exports are
// only exercised on requests that auth refuses.
import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { BRIDGE_TOKEN_ENV, withBridgeAuth } from '../mcp-server/auth.ts';

const GOOD = 'a'.repeat(40);
const saved = process.env[BRIDGE_TOKEN_ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[BRIDGE_TOKEN_ENV];
  else process.env[BRIDGE_TOKEN_ENV] = saved;
});

let calls = 0;
const handler = withBridgeAuth(async () => {
  calls += 1;
  return new Response('ok', { status: 200 });
});

function req(token?: string): Request {
  const headers: Record<string, string> = { origin: 'https://evil.example' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost/mcp', { method: 'POST', headers, body: '{}' });
}

function expectNoCors(res: Response): void {
  for (const name of res.headers.keys()) {
    expect(name.toLowerCase().startsWith('access-control-')).toBe(false);
  }
}

describe('withBridgeAuth', () => {
  test('503 when the token env is unset', async () => {
    delete process.env[BRIDGE_TOKEN_ENV];
    calls = 0;
    const res = await handler(req(GOOD));
    expect(res.status).toBe(503);
    expect(calls).toBe(0);
    expectNoCors(res);
  });

  test('503 when the token env is shorter than 32 characters', async () => {
    process.env[BRIDGE_TOKEN_ENV] = 'short';
    calls = 0;
    const res = await handler(req('short'));
    expect(res.status).toBe(503);
    expect(calls).toBe(0);
  });

  test('401 with a wrong or missing token', async () => {
    process.env[BRIDGE_TOKEN_ENV] = GOOD;
    calls = 0;
    const wrong = await handler(req('b'.repeat(40)));
    const missing = await handler(req());
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(calls).toBe(0);
    expectNoCors(wrong);
  });

  test('reaches the handler with the right token', async () => {
    process.env[BRIDGE_TOKEN_ENV] = GOOD;
    calls = 0;
    const res = await handler(req(GOOD));
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
    expectNoCors(res);
  });
});

describe('Vercel function', () => {
  test('exports refuse requests without the right token', async () => {
    process.env.ANTHROPIC_API_KEY ??= 'test-key-not-used';
    const mod = await import('../mcp-server/api/mcp.ts');
    delete process.env[BRIDGE_TOKEN_ENV];
    for (const method of [mod.GET, mod.POST, mod.DELETE]) {
      expect((await method(req(GOOD))).status).toBe(503);
    }
    process.env[BRIDGE_TOKEN_ENV] = GOOD;
    for (const method of [mod.GET, mod.POST, mod.DELETE]) {
      const res = await method(req('wrong'));
      expect(res.status).toBe(401);
      expectNoCors(res);
    }
  });

  test('vercel.json sends no CORS headers', () => {
    const raw = fs.readFileSync(path.join(import.meta.dir, '..', 'mcp-server', 'vercel.json'), 'utf-8');
    expect(raw.toLowerCase()).not.toContain('access-control-');
  });
});
