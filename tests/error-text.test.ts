// Error messages must never carry the query string of the URL that failed:
// transit API keys travel there (for example `?key=`), and error text can
// reach the model and the user.
import { afterEach, describe, expect, test } from 'bun:test';
import { safeUrl } from '../src/shared/url.ts';
import { fetchJSON } from '../src/mta/client.ts';
import { parsePb, parsePbWithAuth } from '../src/shared/proto.ts';

const SECRET = 'SECRET1234567890';
const URL_WITH_KEY = `https://bustime.example.com/api/siri/stop-monitoring.json?key=${SECRET}&MonitoringRef=1`;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(status: number): void {
  globalThis.fetch = (async () => new Response('denied', { status })) as unknown as typeof fetch;
}

async function errorText(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return String((err as Error).message);
  }
  throw new Error('expected a rejection');
}

describe('safeUrl', () => {
  test('keeps scheme, host and path, drops query and fragment', () => {
    expect(safeUrl(`${URL_WITH_KEY}#frag`)).toBe(
      'https://bustime.example.com/api/siri/stop-monitoring.json',
    );
  });

  test('strips the query from a string that does not parse as a URL', () => {
    expect(safeUrl(`not a url?key=${SECRET}`)).toBe('not a url');
  });
});

describe('fetch errors', () => {
  test('MTA fetchJSON error has no key', async () => {
    stubFetch(403);
    const msg = await errorText(() => fetchJSON(URL_WITH_KEY));
    expect(msg).toContain('HTTP 403');
    expect(msg).not.toContain(SECRET);
  });

  test('shared parsePb error has no key', async () => {
    stubFetch(500);
    const msg = await errorText(() => parsePb(URL_WITH_KEY));
    expect(msg).toContain('HTTP 500');
    expect(msg).not.toContain(SECRET);
  });

  test('shared parsePbWithAuth error has no key', async () => {
    stubFetch(502);
    const msg = await errorText(() => parsePbWithAuth(URL_WITH_KEY, 'Bearer x'));
    expect(msg).toContain('HTTP 502');
    expect(msg).not.toContain(SECRET);
  });
});
