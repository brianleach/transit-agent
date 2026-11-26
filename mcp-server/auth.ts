/**
 * Bearer token auth for the HTTP bridge (Vercel function and standalone server).
 *
 * Fails closed: when TRANSIT_AGENT_BRIDGE_TOKEN is unset or shorter than
 * MIN_TOKEN_LENGTH, every request gets 503. A missing or wrong token gets 401.
 * The stdio transport (local Claude Desktop) does not use this.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const BRIDGE_TOKEN_ENV = 'TRANSIT_AGENT_BRIDGE_TOKEN';
export const MIN_TOKEN_LENGTH = 32;

type Handler = (req: Request) => Promise<Response>;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison; hashing first hides the length difference too. */
export function tokensMatch(given: string, expected: string): boolean {
  return timingSafeEqual(digest(given), digest(expected));
}

export function checkBridgeAuth(req: Request): Response | null {
  const expected = process.env[BRIDGE_TOKEN_ENV];
  if (!expected || expected.length < MIN_TOKEN_LENGTH) {
    return new Response('Bridge auth is not configured', { status: 503 });
  }
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match || !tokensMatch(match[1].trim(), expected)) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'www-authenticate': 'Bearer' },
    });
  }
  return null;
}

/** Wrap a handler so it only runs for requests with the right bearer token. */
export function withBridgeAuth(handler: Handler): Handler {
  return async (req) => checkBridgeAuth(req) ?? handler(req);
}
