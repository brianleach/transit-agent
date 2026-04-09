/**
 * TfL London Transit — Client, Constants, and Helpers
 * API access, line metadata, station data, and search utilities.
 */

import { loadEnv } from '../shared/env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  TubeLineInfo,
  OtherLineInfo,
  StationEntry,
  ScoredStation,
} from './types.js';

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.resolve(__dirname, '..', '..'));

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------
export const TFL_API_KEY: string = process.env.TFL_API_KEY || '';
export const TFL_BASE = 'https://api.tfl.gov.uk';

let _keyWarningShown = false;

export function noteApiKey(): void {
  if (!TFL_API_KEY && !_keyWarningShown) {
    _keyWarningShown = true;
    console.log('Note: TFL_API_KEY not set. Requests are rate-limited.');
    console.log('Get a free key at: https://api-portal.tfl.gov.uk/');
    console.log('With a key you get 500 requests/minute.\n');
  }
}

export function apiUrl(endpoint: string): string {
  const sep = endpoint.includes('?') ? '&' : '?';
  return TFL_API_KEY
    ? `${TFL_BASE}${endpoint}${sep}app_key=${encodeURIComponent(TFL_API_KEY)}`
    : `${TFL_BASE}${endpoint}`;
}

// ---------------------------------------------------------------------------
// Simple in-memory cache (TTL-based, avoids redundant API calls in one run)
// ---------------------------------------------------------------------------
interface CacheEntry {
  data: unknown;
  ts: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function fetchTfl<T = unknown>(
  url: string,
  { cacheTtl = CACHE_TTL_MS }: { cacheTtl?: number } = {},
): Promise<T> {
  const now = Date.now();
  const cached = _cache.get(url);
  if (cached && now - cached.ts < cacheTtl) return cached.data as T;

  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (resp.status === 429) {
    throw new Error(
      'Rate limited by TfL API. Set TFL_API_KEY for 500 requests/minute. Get a free key at: https://api-portal.tfl.gov.uk/',
    );
  }
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { message?: string };
      if (body.message) msg += `: ${body.message}`;
    } catch {
      // ignore JSON parse errors on error responses
    }
    throw new Error(msg);
  }
  const data = (await resp.json()) as T;
  _cache.set(url, { data, ts: now });
  return data;
}

// ---------------------------------------------------------------------------
// Tube Lines
// ---------------------------------------------------------------------------
export const TUBE_LINES: Record<string, TubeLineInfo> = {
  bakerloo: {
    name: 'Bakerloo',
    emoji: '\u{1F7E4}',
    terminals: ['Harrow & Wealdstone', 'Elephant & Castle'],
  },
  central: {
    name: 'Central',
    emoji: '\u{1F534}',
    terminals: ['Epping / Ealing Broadway', 'West Ruislip'],
  },
  circle: {
    name: 'Circle',
    emoji: '\u{1F7E1}',
    terminals: ['Hammersmith (loop via Liverpool Street)'],
  },
  district: {
    name: 'District',
    emoji: '\u{1F7E2}',
    terminals: ['Richmond / Ealing Broadway', 'Upminster'],
  },
  'hammersmith-city': {
    name: 'Hammersmith & City',
    emoji: '\u{1FA77}',
    terminals: ['Hammersmith', 'Barking'],
  },
  jubilee: {
    name: 'Jubilee',
    emoji: '\u26AA',
    terminals: ['Stanmore', 'Stratford'],
  },
  metropolitan: {
    name: 'Metropolitan',
    emoji: '\u{1F7E3}',
    terminals: ['Chesham / Amersham / Uxbridge', 'Aldgate'],
  },
  northern: {
    name: 'Northern',
    emoji: '\u26AB',
    terminals: ['Edgware / High Barnet', 'Morden / Battersea'],
  },
  piccadilly: {
    name: 'Piccadilly',
    emoji: '\u{1F535}',
    terminals: ['Heathrow T5 / Uxbridge', 'Cockfosters'],
  },
  victoria: {
    name: 'Victoria',
    emoji: '\u{1FA75}',
    terminals: ['Walthamstow Central', 'Brixton'],
  },
  'waterloo-city': {
    name: 'Waterloo & City',
    emoji: '\u{1F986}',
    terminals: ['Waterloo', 'Bank'],
  },
};

// ---------------------------------------------------------------------------
// Other TfL Lines (DLR, Overground, Elizabeth, Trams)
// ---------------------------------------------------------------------------
export const OTHER_LINES: Record<string, OtherLineInfo> = {
  dlr: {
    name: 'DLR',
    emoji: '\u{1F688}',
    type: 'Docklands Light Railway',
  },
  liberty: {
    name: 'Liberty',
    emoji: '\u{1F69D}',
    type: 'Overground (Romford \u2014 Upminster)',
  },
  lioness: {
    name: 'Lioness',
    emoji: '\u{1F69D}',
    type: 'Overground (Watford \u2014 Euston)',
  },
  mildmay: {
    name: 'Mildmay',
    emoji: '\u{1F69D}',
    type: 'Overground (Stratford \u2014 Richmond/Clapham)',
  },
  suffragette: {
    name: 'Suffragette',
    emoji: '\u{1F69D}',
    type: 'Overground (Gospel Oak \u2014 Barking)',
  },
  weaver: {
    name: 'Weaver',
    emoji: '\u{1F69D}',
    type: 'Overground (Liverpool St \u2014 Enfield/Cheshunt/Chingford)',
  },
  windrush: {
    name: 'Windrush',
    emoji: '\u{1F69D}',
    type: 'Overground (Highbury \u2014 Crystal Palace/Clapham/W Croydon)',
  },
  elizabeth: {
    name: 'Elizabeth line',
    emoji: '\u{1F49C}',
    type: 'Crossrail',
  },
  tram: {
    name: 'London Trams',
    emoji: '\u{1F68B}',
    type: 'Croydon Tramlink',
  },
};

// ---------------------------------------------------------------------------
// Line Helpers
// ---------------------------------------------------------------------------
export function lineEmoji(lineId: string): string {
  return TUBE_LINES[lineId]?.emoji || OTHER_LINES[lineId]?.emoji || '\u{1F687}';
}

export function lineName(lineId: string): string {
  return TUBE_LINES[lineId]?.name || OTHER_LINES[lineId]?.name || lineId;
}

/** Mode-level emoji for headers and labels */
export function modeEmoji(mode: string | undefined): string {
  if (!mode) return '\u{1F687}';
  const m = mode.toLowerCase();
  if (m === 'tube' || m === 'underground') return '\u{1F687}';
  if (m === 'bus') return '\u{1F68C}';
  if (m === 'dlr' || m === 'overground' || m === 'elizabeth-line' || m === 'national-rail')
    return '\u{1F686}';
  if (m === 'tram') return '\u{1F68A}';
  if (m === 'walking') return '\u{1F6B6}';
  if (m === 'cycle') return '\u{1F6B4}';
  return '\u{1F687}';
}

// ---------------------------------------------------------------------------
// Line ID Aliases for User-Friendly Matching
// ---------------------------------------------------------------------------
export const LINE_ALIASES: Record<string, string> = {
  baker: 'bakerloo',
  bak: 'bakerloo',
  cen: 'central',
  cir: 'circle',
  dis: 'district',
  dst: 'district',
  hammersmith: 'hammersmith-city',
  ham: 'hammersmith-city',
  'h&c': 'hammersmith-city',
  jub: 'jubilee',
  met: 'metropolitan',
  metro: 'metropolitan',
  nor: 'northern',
  nth: 'northern',
  pic: 'piccadilly',
  picc: 'piccadilly',
  vic: 'victoria',
  waterloo: 'waterloo-city',
  wat: 'waterloo-city',
  'w&c': 'waterloo-city',
  overground: 'lioness',
  over: 'lioness',
  liz: 'elizabeth',
  crossrail: 'elizabeth',
  xr: 'elizabeth',
};

export function resolveLineId(input: string | undefined): string | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  if (TUBE_LINES[lower] || OTHER_LINES[lower]) return lower;
  return LINE_ALIASES[lower] || lower;
}

// ---------------------------------------------------------------------------
// Station Data (for fuzzy matching -- top stations)
// ---------------------------------------------------------------------------
export const STATIONS: StationEntry[] = [
  {
    naptanId: '940GZZLUKSX',
    name: "King's Cross St. Pancras",
    aliases: ['kings cross', "king's cross", 'kgx', 'st pancras'],
  },
  {
    naptanId: '940GZZLUOXC',
    name: 'Oxford Circus',
    aliases: ['oxford circus', 'oxford st'],
  },
  {
    naptanId: '940GZZLUWLO',
    name: 'Waterloo',
    aliases: ['waterloo'],
  },
  {
    naptanId: '940GZZLUVIC',
    name: 'Victoria',
    aliases: ['victoria station', 'victoria'],
  },
  {
    naptanId: '940GZZLULVT',
    name: 'Liverpool Street',
    aliases: ['liverpool street', 'liverpool st'],
  },
  {
    naptanId: '940GZZLUPAC',
    name: 'Paddington',
    aliases: ['paddington'],
  },
  {
    naptanId: '940GZZLUEUS',
    name: 'Euston',
    aliases: ['euston'],
  },
  {
    naptanId: '940GZZLULNB',
    name: 'London Bridge',
    aliases: ['london bridge'],
  },
  {
    naptanId: '940GZZLUBNK',
    name: 'Bank',
    aliases: ['bank', 'monument'],
  },
  {
    naptanId: '940GZZLUCYF',
    name: 'Canary Wharf',
    aliases: ['canary wharf'],
  },
  {
    naptanId: '940GZZLULSQ',
    name: 'Leicester Square',
    aliases: ['leicester square', 'leicester sq'],
  },
  {
    naptanId: '940GZZLUPCC',
    name: 'Piccadilly Circus',
    aliases: ['piccadilly circus'],
  },
  {
    naptanId: '940GZZLUWSM',
    name: 'Westminster',
    aliases: ['westminster', 'big ben', 'parliament'],
  },
  {
    naptanId: '940GZZLUGPK',
    name: 'Green Park',
    aliases: ['green park'],
  },
  {
    naptanId: '940GZZLUBND',
    name: 'Bond Street',
    aliases: ['bond street'],
  },
  {
    naptanId: '940GZZLUTCR',
    name: 'Tottenham Court Road',
    aliases: ['tottenham court road', 'tcr'],
  },
  {
    naptanId: '940GZZLUCTN',
    name: 'Camden Town',
    aliases: ['camden', 'camden town'],
  },
  {
    naptanId: '940GZZLUBXN',
    name: 'Brixton',
    aliases: ['brixton'],
  },
  {
    naptanId: '940GZZLUSTD',
    name: 'Stratford',
    aliases: ['stratford', 'olympic park'],
  },
  {
    naptanId: '940GZZLUHR5',
    name: 'Heathrow Terminal 5',
    aliases: ['heathrow', 'lhr', 'airport', 'heathrow t5'],
  },
  {
    naptanId: '940GZZLUHR4',
    name: 'Heathrow Terminals 2 & 3',
    aliases: ['heathrow t2', 'heathrow t3', 'heathrow 123'],
  },
  {
    naptanId: '940GZZLUBST',
    name: 'Baker Street',
    aliases: ['baker street', 'sherlock'],
  },
  {
    naptanId: '940GZZLUNHG',
    name: 'Notting Hill Gate',
    aliases: ['notting hill'],
  },
  {
    naptanId: '940GZZLUAGL',
    name: 'Angel',
    aliases: ['angel', 'islington'],
  },
  {
    naptanId: '940GZZLUCPC',
    name: 'Clapham Common',
    aliases: ['clapham common'],
  },
  {
    naptanId: '910GCLPHMJC',
    name: 'Clapham Junction',
    aliases: ['clapham junction'],
  },
  {
    naptanId: '940GZZLUCPS',
    name: 'Clapham South',
    aliases: ['clapham south', 'clapham'],
  },
  {
    naptanId: '940GZZLUWYP',
    name: 'Wembley Park',
    aliases: ['wembley', 'wembley stadium'],
  },
  {
    naptanId: '940GZZLUTFP',
    name: 'Tufnell Park',
    aliases: ['tufnell park'],
  },
  {
    naptanId: '940GZZLUHBT',
    name: 'High Barnet',
    aliases: ['high barnet', 'barnet'],
  },
  {
    naptanId: '940GZZLUEAC',
    name: 'East Acton',
    aliases: ['east acton'],
  },
  {
    naptanId: '940GZZLUKNG',
    name: 'Kennington',
    aliases: ['kennington'],
  },
  {
    naptanId: '940GZZLUSKW',
    name: 'South Kensington',
    aliases: ['south ken', 'south kensington'],
  },
  {
    naptanId: '940GZZLUSKS',
    name: 'Sloane Square',
    aliases: ['sloane square'],
  },
  {
    naptanId: '940GZZLUERB',
    name: 'Edgware Road (Bakerloo)',
    aliases: ['edgware road'],
  },
  {
    naptanId: '940GZZLUMDN',
    name: 'Morden',
    aliases: ['morden'],
  },
  {
    naptanId: '940GZZLUSWN',
    name: 'Stockwell',
    aliases: ['stockwell'],
  },
  {
    naptanId: '940GZZLUBLG',
    name: 'Bethnal Green',
    aliases: ['bethnal green'],
  },
  {
    naptanId: '940GZZLUMSH',
    name: 'Moorgate',
    aliases: ['moorgate'],
  },
  {
    naptanId: '940GZZLUFCN',
    name: 'Farringdon',
    aliases: ['farringdon'],
  },
];

// ---------------------------------------------------------------------------
// Station Search
// ---------------------------------------------------------------------------
export function searchStation(query: string): ScoredStation[] {
  const q = query
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .trim();

  const scored: ScoredStation[] = [];
  for (const s of STATIONS) {
    const nameNorm = s.name.toLowerCase().replace(/['\u2019]/g, '');
    let score = 999;
    if (nameNorm === q) score = 0;
    else if (s.aliases.some((a) => a === q)) score = 1;
    else if (nameNorm.startsWith(q)) score = 2;
    else if (s.aliases.some((a) => a.startsWith(q))) score = 3;
    else if (nameNorm.includes(q)) score = 4;
    else if (s.aliases.some((a) => a.includes(q))) score = 5;
    else if (
      q
        .split(/\s+/)
        .every((w) => nameNorm.includes(w) || s.aliases.some((a) => a.includes(w)))
    )
      score = 6;
    else continue;
    scored.push({ ...s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored;
}
