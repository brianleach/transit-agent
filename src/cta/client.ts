// ---------------------------------------------------------------------------
// CTA Chicago Transit — API Client & Data
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { loadEnv } from '../shared/env.js';
import { loadCsv } from '../shared/csv.js';
import { loadStops } from '../shared/gtfs.js';

import type {
  LLineCode,
  LLineInfo,
  Station,
  ScoredStation,
} from './types.js';

// ---------------------------------------------------------------------------
// Load .env — walk up from this file to find the project root .env
// ---------------------------------------------------------------------------
loadEnv(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------
export const CTA_TRAIN_API_KEY: string = process.env.CTA_TRAIN_API_KEY || '';
export const CTA_BUS_API_KEY: string = process.env.CTA_BUS_API_KEY || '';

export const TRAIN_BASE = 'https://lapi.transitchicago.com/api/1.0';
export const BUS_BASE = 'https://www.ctabustracker.com/bustime/api/v2';
export const ALERTS_BASE = 'https://www.transitchicago.com/api/1.0';
export const GTFS_STATIC_URL =
  'https://www.transitchicago.com/downloads/sch_data/google_transit.zip';

export const GTFS_DIR: string = path.join(os.homedir(), '.cta', 'gtfs');

// ---------------------------------------------------------------------------
// L Train Lines
// ---------------------------------------------------------------------------
export const L_LINES: Record<LLineCode, LLineInfo> = {
  Red: { name: 'Red Line', color: 'Red', terminals: ['Howard', '95th/Dan Ryan'] },
  Blue: { name: 'Blue Line', color: 'Blue', terminals: ["O'Hare", 'Forest Park'] },
  Brn: { name: 'Brown Line', color: 'Brown', terminals: ['Kimball', 'Loop'] },
  G: {
    name: 'Green Line',
    color: 'Green',
    terminals: ['Harlem/Lake', 'Ashland/63rd', 'Cottage Grove'],
  },
  Org: { name: 'Orange Line', color: 'Orange', terminals: ['Midway', 'Loop'] },
  P: { name: 'Purple Line', color: 'Purple', terminals: ['Linden', 'Howard'] },
  Pink: { name: 'Pink Line', color: 'Pink', terminals: ['54th/Cermak', 'Loop'] },
  Y: {
    name: 'Yellow Line',
    color: 'Yellow',
    terminals: ['Dempster-Skokie', 'Howard'],
  },
};

// Route code aliases for user-friendly matching
export const ROUTE_ALIASES: Record<string, string> = {
  red: 'Red',
  blue: 'Blue',
  brown: 'Brn',
  brn: 'Brn',
  green: 'G',
  g: 'G',
  orange: 'Org',
  org: 'Org',
  purple: 'P',
  p: 'P',
  pink: 'Pink',
  yellow: 'Y',
  y: 'Y',
};

// ---------------------------------------------------------------------------
// Key Station Data (for fuzzy matching without GTFS)
// mapid = parent station ID (4xxxx)
// ---------------------------------------------------------------------------
export const STATIONS: Station[] = [
  {
    mapid: '40890',
    name: "O'Hare",
    lines: ['Blue'],
    aliases: ['ohare', 'airport', "o'hare", 'ohare airport'],
  },
  { mapid: '40390', name: 'Forest Park', lines: ['Blue'], aliases: ['forest park'] },
  {
    mapid: '40930',
    name: 'Midway',
    lines: ['Org'],
    aliases: ['midway', 'midway airport'],
  },
  {
    mapid: '40900',
    name: 'Howard',
    lines: ['Red', 'P', 'Y'],
    aliases: ['howard'],
  },
  {
    mapid: '40450',
    name: '95th/Dan Ryan',
    lines: ['Red'],
    aliases: ['95th', 'dan ryan', '95th dan ryan'],
  },
  {
    mapid: '40380',
    name: 'Clark/Lake',
    lines: ['Blue', 'Brn', 'G', 'Org', 'P', 'Pink'],
    aliases: ['clark lake', 'clark and lake'],
  },
  {
    mapid: '40260',
    name: 'State/Lake',
    lines: ['Brn', 'G', 'Org', 'P', 'Pink'],
    aliases: ['state lake', 'state and lake'],
  },
  {
    mapid: '41700',
    name: 'Washington/Wabash',
    lines: ['Brn', 'G', 'Org', 'P', 'Pink'],
    aliases: ['washington wabash', 'washington and wabash'],
  },
  {
    mapid: '40680',
    name: 'Adams/Wabash',
    lines: ['Brn', 'G', 'Org', 'P', 'Pink'],
    aliases: ['adams wabash', 'adams and wabash'],
  },
  {
    mapid: '40850',
    name: 'Harold Washington Library',
    lines: ['Brn', 'Org', 'Pink', 'P'],
    aliases: ['library', 'harold washington', 'harold washington library'],
  },
  {
    mapid: '40160',
    name: 'LaSalle/Van Buren',
    lines: ['Brn', 'Org', 'Pink', 'P'],
    aliases: ['lasalle', 'van buren', 'lasalle van buren'],
  },
  {
    mapid: '40040',
    name: 'Quincy',
    lines: ['Brn', 'Org', 'Pink', 'P'],
    aliases: ['quincy'],
  },
  {
    mapid: '41320',
    name: 'Belmont',
    lines: ['Red', 'Brn', 'P'],
    aliases: ['belmont red', 'belmont brown'],
  },
  {
    mapid: '41220',
    name: 'Fullerton',
    lines: ['Red', 'Brn', 'P'],
    aliases: ['fullerton'],
  },
  {
    mapid: '41400',
    name: 'Roosevelt',
    lines: ['Red', 'Org', 'G'],
    aliases: ['roosevelt'],
  },
  {
    mapid: '40560',
    name: 'Jackson (Red)',
    lines: ['Red'],
    aliases: ['jackson red'],
  },
  {
    mapid: '40070',
    name: 'Jackson (Blue)',
    lines: ['Blue'],
    aliases: ['jackson blue'],
  },
  {
    mapid: '41450',
    name: 'Chicago (Red)',
    lines: ['Red'],
    aliases: ['chicago red', 'chicago ave red'],
  },
  {
    mapid: '41410',
    name: 'Chicago (Blue)',
    lines: ['Blue'],
    aliases: ['chicago blue', 'chicago ave blue'],
  },
  {
    mapid: '40330',
    name: 'Grand (Red)',
    lines: ['Red'],
    aliases: ['grand red'],
  },
  {
    mapid: '40490',
    name: 'Grand (Blue)',
    lines: ['Blue'],
    aliases: ['grand blue'],
  },
  {
    mapid: '41090',
    name: 'Monroe (Red)',
    lines: ['Red'],
    aliases: ['monroe red'],
  },
  {
    mapid: '41160',
    name: 'Monroe (Blue)',
    lines: ['Blue'],
    aliases: ['monroe blue'],
  },
  {
    mapid: '41440',
    name: 'Addison (Red)',
    lines: ['Red'],
    aliases: ['wrigley', 'addison red', 'cubs', 'wrigley field'],
  },
  {
    mapid: '41240',
    name: 'Addison (Brown)',
    lines: ['Brn'],
    aliases: ['addison brown'],
  },
  {
    mapid: '40190',
    name: 'Sox-35th',
    lines: ['Red'],
    aliases: ['sox', 'white sox', '35th', 'guaranteed rate', 'sox 35th'],
  },
  {
    mapid: '40350',
    name: 'UIC-Halsted',
    lines: ['Blue'],
    aliases: ['uic', 'united center', 'bulls', 'blackhawks', 'uic halsted'],
  },
  {
    mapid: '40530',
    name: 'Washington (Blue)',
    lines: ['Blue'],
    aliases: ['washington blue'],
  },
  {
    mapid: '41020',
    name: 'Logan Square',
    lines: ['Blue'],
    aliases: ['logan', 'logan square'],
  },
  {
    mapid: '40590',
    name: 'Damen (Blue)',
    lines: ['Blue'],
    aliases: ['wicker park', 'damen blue'],
  },
  { mapid: '41010', name: 'Kimball', lines: ['Brn'], aliases: ['kimball'] },
  {
    mapid: '40460',
    name: 'Linden',
    lines: ['P'],
    aliases: ['linden', 'wilmette'],
  },
  {
    mapid: '40140',
    name: 'Dempster-Skokie',
    lines: ['Y'],
    aliases: ['dempster', 'skokie'],
  },
  {
    mapid: '40830',
    name: 'Harlem/Lake (Green)',
    lines: ['G'],
    aliases: ['harlem green', 'harlem lake'],
  },
  {
    mapid: '40510',
    name: '54th/Cermak',
    lines: ['Pink'],
    aliases: ['54th cermak', '54th'],
  },
  {
    mapid: '41120',
    name: 'Cermak-Chinatown',
    lines: ['Red'],
    aliases: ['chinatown', 'cermak chinatown'],
  },
  {
    mapid: '40720',
    name: 'Cottage Grove',
    lines: ['G'],
    aliases: ['cottage grove'],
  },
  {
    mapid: '40290',
    name: 'Ashland/63rd',
    lines: ['G'],
    aliases: ['ashland 63rd'],
  },
  {
    mapid: '41000',
    name: 'Randolph/Wabash',
    lines: ['Brn', 'G', 'Org', 'P', 'Pink'],
    aliases: ['millennium', 'randolph', 'randolph wabash'],
  },
  {
    mapid: '40730',
    name: 'Western (Brown)',
    lines: ['Brn'],
    aliases: ['western brown'],
  },
  {
    mapid: '40220',
    name: "Western (Blue - O'Hare)",
    lines: ['Blue'],
    aliases: ['western blue ohare'],
  },
  {
    mapid: '40810',
    name: 'Western (Blue - Forest Park)',
    lines: ['Blue'],
    aliases: ['western blue forest park'],
  },
  {
    mapid: '41480',
    name: 'Western (Orange)',
    lines: ['Org'],
    aliases: ['western orange'],
  },
  {
    mapid: '40750',
    name: 'Merchandise Mart',
    lines: ['Brn', 'P'],
    aliases: ['merchandise mart', 'merch mart'],
  },
  {
    mapid: '40800',
    name: 'Sedgwick',
    lines: ['Brn', 'P'],
    aliases: ['sedgwick'],
  },
  {
    mapid: '40660',
    name: 'Armitage',
    lines: ['Brn', 'P'],
    aliases: ['armitage'],
  },
  {
    mapid: '40570',
    name: 'Diversey',
    lines: ['Brn', 'P'],
    aliases: ['diversey'],
  },
  {
    mapid: '41290',
    name: 'Lake (Red)',
    lines: ['Red'],
    aliases: ['lake red'],
  },
  {
    mapid: '40920',
    name: 'Pulaski (Blue)',
    lines: ['Blue'],
    aliases: ['pulaski blue'],
  },
  {
    mapid: '40180',
    name: 'Halsted (Orange)',
    lines: ['Org'],
    aliases: ['halsted orange'],
  },
  {
    mapid: '40980',
    name: 'Ashland (Orange)',
    lines: ['Org'],
    aliases: ['ashland orange'],
  },
  {
    mapid: '41060',
    name: '35th/Archer',
    lines: ['Org'],
    aliases: ['35th archer'],
  },
];

// ---------------------------------------------------------------------------
// Resolve user-supplied route string to L line code
// ---------------------------------------------------------------------------
export function resolveTrainRoute(input: string): string | null {
  if (!input) return null;
  if (L_LINES[input as LLineCode]) return input;
  return ROUTE_ALIASES[input.toLowerCase()] || input;
}

// ---------------------------------------------------------------------------
// Station search — exact, alias, partial, word matching + GTFS fallback
// ---------------------------------------------------------------------------
export function searchStation(
  query: string,
  routeFilter: string | null,
): ScoredStation[] {
  const q = query.toLowerCase().replace(/['\u2019]/g, '').trim();

  // First try embedded stations
  const scored: ScoredStation[] = [];
  for (const s of STATIONS) {
    if (routeFilter && !s.lines.includes(routeFilter)) continue;
    const nameNorm = s.name.toLowerCase().replace(/['\u2019]/g, '');
    let score = 999;
    if (nameNorm === q) score = 0;
    else if (s.aliases.some((a) => a === q)) score = 1;
    else if (nameNorm.includes(q)) score = 2;
    else if (s.aliases.some((a) => a.includes(q))) score = 3;
    else if (
      q
        .split(/\s+/)
        .every(
          (w) => nameNorm.includes(w) || s.aliases.some((a) => a.includes(w)),
        )
    )
      score = 4;
    else continue;
    scored.push({ ...s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));

  // Also search GTFS stops if available
  if (fs.existsSync(path.join(GTFS_DIR, 'stops.txt'))) {
    const stops = loadStops(GTFS_DIR);
    for (const [sid, s] of Object.entries(stops)) {
      // Only consider parent stations (4xxxx) for train searches
      if (!sid.startsWith('4')) continue;
      if (scored.some((st) => st.mapid === sid)) continue;
      const nameNorm = (s.stop_name || '').toLowerCase().replace(/['\u2019]/g, '');
      let score = 999;
      if (nameNorm === q) score = 5;
      else if (nameNorm.includes(q)) score = 6;
      else continue;
      scored.push({ mapid: sid, name: s.stop_name, lines: [], score, aliases: [] });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  }

  return scored;
}

// ---------------------------------------------------------------------------
// Parse CTA timestamp — all CTA APIs return Central Time.
// Train Tracker uses ISO: "2026-02-16T20:37:05"
// Bus Tracker uses:       "20260216 20:34"
// We store Central Time values in a Date's UTC slots so fmtTimeHM reads
// them directly.
// ---------------------------------------------------------------------------
export function parseCTATimestamp(ts: string): Date | null {
  if (!ts) return null;

  // Bus Tracker format: YYYYMMDD HH:MM or YYYYMMDD HH:MM:SS
  const busMatch = ts.match(
    /^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (busMatch) {
    const [, y, mo, d, h, mi, s] = busMatch;
    return new Date(
      Date.UTC(
        parseInt(y),
        parseInt(mo) - 1,
        parseInt(d),
        parseInt(h),
        parseInt(mi),
        parseInt(s || '0'),
      ),
    );
  }

  // Train Tracker ISO format: YYYY-MM-DDTHH:MM:SS (Central Time, no tz suffix)
  const isoMatch = ts.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/,
  );
  if (isoMatch) {
    const [, y, mo, d, h, mi, s] = isoMatch;
    return new Date(
      Date.UTC(
        parseInt(y),
        parseInt(mo) - 1,
        parseInt(d),
        parseInt(h),
        parseInt(mi),
        parseInt(s),
      ),
    );
  }

  // Fallback: parse manually to avoid timezone interpretation
  const parsed = new Date(ts);
  if (!isNaN(parsed.getTime())) return parsed;
  return null;
}

// ---------------------------------------------------------------------------
// API key guards
// ---------------------------------------------------------------------------
export function requireTrainKey(): boolean {
  if (!CTA_TRAIN_API_KEY) {
    console.log('CTA Train Tracker API key required.');
    console.log(
      'Get a free key at: https://www.transitchicago.com/developers/traintrackerapply/',
    );
    console.log('Then set CTA_TRAIN_API_KEY in your environment.');
    return false;
  }
  return true;
}

export function requireBusKey(): boolean {
  if (!CTA_BUS_API_KEY) {
    console.log('CTA Bus Tracker API key required.');
    console.log(
      'Get a free key at: https://www.transitchicago.com/developers/bustracker/',
    );
    console.log('Then set CTA_BUS_API_KEY in your environment.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
export async function fetchJSON(url: string): Promise<any> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${new URL(url).hostname}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// CTA API error handler — returns true if error was found and reported
// ---------------------------------------------------------------------------
export function handleCTAError(data: any, apiName: string): boolean {
  // Train Tracker errors
  if (data?.ctatt?.errCd && data.ctatt.errCd !== '0') {
    const code: string = data.ctatt.errCd;
    const msg: string = data.ctatt.errNm || 'Unknown error';
    if (code === '101') {
      console.log(`${apiName}: Invalid API key. Check your CTA_TRAIN_API_KEY.`);
    } else if (code === '501') {
      console.log(
        `${apiName}: No arrival data found. The station may not have active service right now.`,
      );
    } else {
      console.log(`${apiName} error (${code}): ${msg}`);
    }
    return true;
  }
  // Bus Tracker errors
  if (data?.['bustime-response']?.error) {
    const errors = data['bustime-response'].error;
    const errArr: any[] = Array.isArray(errors) ? errors : [errors];
    for (const e of errArr) {
      const msg: string = e.msg || e.stpnm || 'Unknown error';
      if (msg.includes('Invalid API access key')) {
        console.log(`${apiName}: Invalid API key. Check your CTA_BUS_API_KEY.`);
      } else if (msg.includes('No data found') || msg.includes('No arrival times')) {
        console.log(
          `${apiName}: No data found. The stop/route may not have active service right now.`,
        );
      } else {
        console.log(`${apiName} error: ${msg}`);
      }
    }
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Emoji helper — pick based on route_type from GTFS
// route_type: 0=tram/light rail, 1=subway, 2=rail, 3=bus
// CTA L trains are route_type 1; buses are route_type 3
// ---------------------------------------------------------------------------
export function getRouteEmoji(routeType: string | number): string {
  const t = String(routeType);
  if (t === '0' || t === '1' || t === '2') return '\u{1F687}';
  if (t === '3') return '\u{1F68C}';
  return '\u{1F687}'; // default for unknown transit
}
