// ---------------------------------------------------------------------------
// MTA New York City Transit — Constants, Data, and Helpers
// ---------------------------------------------------------------------------

import path from 'node:path';
import os from 'node:os';

import { loadEnv } from '../shared/env.js';
import { ensureGtfs } from '../shared/csv.js';
import { loadStops } from '../shared/gtfs.js';

import type {
  SubwayLineInfo,
  SubwayLineCode,
  Station,
  ScoredStation,
} from './types.js';

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
loadEnv(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..'));

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------

export const MTA_BUS_API_KEY: string = process.env.MTA_BUS_API_KEY || '';

const FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds';
// MTA requires %2F encoding for the path separator after mtagtfsfeeds
export const subwayFeedUrl = (feed: string): string =>
  `${FEED_BASE}/nyct%2F${feed}`;
export const alertsFeedUrl = (feed: string): string =>
  `${FEED_BASE}/camsys%2F${feed}`;

export const BUS_SIRI_BASE = 'https://bustime.mta.info/api/siri';
export const BUS_OBA_BASE = 'https://bustime.mta.info/api/where';

// HTTP intentional — MTA does not serve this endpoint over HTTPS
// (redirects back to HTTP)
export const GTFS_STATIC_URL =
  'http://web.mta.info/developers/data/nyct/subway/google_transit.zip';

export const GTFS_DIR = path.join(os.homedir(), '.mta', 'gtfs');

export const TIMEZONE = 'US/Eastern' as const;

export const REFRESH_CMD = 'node scripts/mta.mjs refresh-gtfs';

// ---------------------------------------------------------------------------
// Subway Feed Map — which feed to fetch for each line
// ---------------------------------------------------------------------------

export const FEED_MAP: Record<string, string> = {
  '1': 'gtfs',
  '2': 'gtfs',
  '3': 'gtfs',
  '4': 'gtfs',
  '5': 'gtfs',
  '6': 'gtfs',
  '7': 'gtfs',
  GS: 'gtfs',
  A: 'gtfs-ace',
  C: 'gtfs-ace',
  E: 'gtfs-ace',
  H: 'gtfs-ace',
  FS: 'gtfs-ace',
  B: 'gtfs-bdfm',
  D: 'gtfs-bdfm',
  F: 'gtfs-bdfm',
  M: 'gtfs-bdfm',
  G: 'gtfs-g',
  J: 'gtfs-jz',
  Z: 'gtfs-jz',
  L: 'gtfs-l',
  N: 'gtfs-nqrw',
  Q: 'gtfs-nqrw',
  R: 'gtfs-nqrw',
  W: 'gtfs-nqrw',
  SI: 'gtfs-si',
};

export const ALL_FEEDS: string[] = [
  'gtfs',
  'gtfs-ace',
  'gtfs-bdfm',
  'gtfs-g',
  'gtfs-jz',
  'gtfs-l',
  'gtfs-nqrw',
  'gtfs-si',
];

// ---------------------------------------------------------------------------
// Subway Line Metadata (27 lines)
// ---------------------------------------------------------------------------

export const SUBWAY_LINES: Record<string, SubwayLineInfo> = {
  '1': {
    name: '1 train',
    color: 'Red',
    route: '7th Ave Local',
    terminals: ['Van Cortlandt Park-242 St', 'South Ferry'],
  },
  '2': {
    name: '2 train',
    color: 'Red',
    route: '7th Ave Express',
    terminals: ['Wakefield-241 St', 'Flatbush Ave-Brooklyn College'],
  },
  '3': {
    name: '3 train',
    color: 'Red',
    route: '7th Ave Express',
    terminals: ['Harlem-148 St', 'New Lots Ave'],
  },
  '4': {
    name: '4 train',
    color: 'Green',
    route: 'Lexington Ave Express',
    terminals: ['Woodlawn', 'Crown Heights-Utica Ave'],
  },
  '5': {
    name: '5 train',
    color: 'Green',
    route: 'Lexington Ave Express',
    terminals: ['Eastchester-Dyre Ave', 'Flatbush Ave-Brooklyn College'],
  },
  '6': {
    name: '6 train',
    color: 'Green',
    route: 'Lexington Ave Local',
    terminals: ['Pelham Bay Park', 'Brooklyn Bridge-City Hall'],
  },
  '7': {
    name: '7 train',
    color: 'Purple',
    route: 'Flushing',
    terminals: ['Flushing-Main St', '34 St-Hudson Yards'],
  },
  A: {
    name: 'A train',
    color: 'Blue',
    route: '8th Ave Express',
    terminals: ['Inwood-207 St', 'Far Rockaway / Lefferts Blvd'],
  },
  C: {
    name: 'C train',
    color: 'Blue',
    route: '8th Ave Local',
    terminals: ['168 St', 'Euclid Ave'],
  },
  E: {
    name: 'E train',
    color: 'Blue',
    route: '8th Ave Local',
    terminals: ['Jamaica Center', 'World Trade Center'],
  },
  B: {
    name: 'B train',
    color: 'Orange',
    route: '6th Ave Express',
    terminals: ['Bedford Park Blvd', 'Brighton Beach'],
  },
  D: {
    name: 'D train',
    color: 'Orange',
    route: '6th Ave Express',
    terminals: ['Norwood-205 St', 'Coney Island-Stillwell Ave'],
  },
  F: {
    name: 'F train',
    color: 'Orange',
    route: '6th Ave Local',
    terminals: ['Jamaica-179 St', 'Coney Island-Stillwell Ave'],
  },
  M: {
    name: 'M train',
    color: 'Orange',
    route: '6th Ave Local',
    terminals: ['Middle Village-Metropolitan Ave', 'Forest Hills-71 Ave'],
  },
  G: {
    name: 'G train',
    color: 'Light Green',
    route: 'Brooklyn-Queens Crosstown',
    terminals: ['Court Sq', 'Church Ave'],
  },
  J: {
    name: 'J train',
    color: 'Brown',
    route: 'Nassau St',
    terminals: ['Jamaica Center', 'Broad St'],
  },
  Z: {
    name: 'Z train',
    color: 'Brown',
    route: 'Nassau St Express',
    terminals: ['Jamaica Center', 'Broad St'],
  },
  L: {
    name: 'L train',
    color: 'Gray',
    route: '14th St-Canarsie',
    terminals: ['8 Ave', 'Canarsie-Rockaway Pkwy'],
  },
  N: {
    name: 'N train',
    color: 'Yellow',
    route: 'Broadway Express',
    terminals: ['Astoria-Ditmars Blvd', 'Coney Island-Stillwell Ave'],
  },
  Q: {
    name: 'Q train',
    color: 'Yellow',
    route: 'Broadway Express',
    terminals: ['96 St', 'Coney Island-Stillwell Ave'],
  },
  R: {
    name: 'R train',
    color: 'Yellow',
    route: 'Broadway Local',
    terminals: ['Forest Hills-71 Ave', 'Bay Ridge-95 St'],
  },
  W: {
    name: 'W train',
    color: 'Yellow',
    route: 'Broadway Local',
    terminals: ['Astoria-Ditmars Blvd', 'Whitehall St-South Ferry'],
  },
  GS: {
    name: '42 St Shuttle',
    color: 'Gray',
    route: '42nd St Shuttle',
    terminals: ['Times Sq-42 St', 'Grand Central-42 St'],
  },
  FS: {
    name: 'Franklin Ave Shuttle',
    color: 'Gray',
    route: 'Franklin Ave Shuttle',
    terminals: ['Franklin Ave', 'Prospect Park'],
  },
  H: {
    name: 'Rockaway Park Shuttle',
    color: 'Gray',
    route: 'Rockaway Park Shuttle',
    terminals: ['Broad Channel', 'Rockaway Park-Beach 116 St'],
  },
  SI: {
    name: 'Staten Island Railway',
    color: 'Blue',
    route: 'Staten Island Railway',
    terminals: ['St George', 'Tottenville'],
  },
};

// Canonical display order for subway lines
export const LINE_ORDER: SubwayLineCode[] = [
  '1', '2', '3', '4', '5', '6', '7',
  'A', 'C', 'E',
  'B', 'D', 'F', 'M',
  'G',
  'J', 'Z',
  'L',
  'N', 'Q', 'R', 'W',
  'GS', 'FS', 'H', 'SI',
];

// ---------------------------------------------------------------------------
// Major Stations with Aliases (~60 stations for fuzzy matching without GTFS)
// parent_stop_id is the numeric/alphanumeric prefix used in GTFS stop IDs
// ---------------------------------------------------------------------------

export const STATIONS: Station[] = [
  { id: '127', name: 'Times Sq-42 St', lines: ['1', '2', '3', '7', 'N', 'Q', 'R', 'W', 'GS'], aliases: ['times square', '42nd street', '42nd', 'tsq', 'times sq'] },
  { id: '631', name: 'Grand Central-42 St', lines: ['4', '5', '6', '7', 'GS'], aliases: ['grand central', 'gct', 'grand central terminal'] },
  { id: 'A28', name: '34 St-Penn Station', lines: ['A', 'C', 'E'], aliases: ['penn station', 'penn', 'msg', 'madison square garden'] },
  { id: '128', name: '34 St-Penn Station', lines: ['1', '2', '3'], aliases: ['penn station 123', '34th penn 123'] },
  { id: 'D17', name: '34 St-Herald Sq', lines: ['B', 'D', 'F', 'M', 'N', 'Q', 'R', 'W'], aliases: ['herald square', 'macys', '34th herald', 'herald sq'] },
  { id: '635', name: '14 St-Union Sq', lines: ['4', '5', '6', 'L', 'N', 'Q', 'R', 'W'], aliases: ['union square', '14th street', 'union sq'] },
  { id: 'R20', name: 'Fulton St', lines: ['2', '3', '4', '5', 'A', 'C', 'J', 'Z'], aliases: ['fulton', 'fulton street'] },
  { id: 'R31', name: 'Atlantic Ave-Barclays Ctr', lines: ['2', '3', '4', '5', 'B', 'D', 'N', 'Q', 'R'], aliases: ['barclays', 'atlantic', 'barclays center', 'atlantic ave'] },
  { id: 'A41', name: 'Jay St-MetroTech', lines: ['A', 'C', 'F', 'R'], aliases: ['jay street', 'metrotech', 'downtown brooklyn'] },
  { id: 'A34', name: 'Chambers St', lines: ['A', 'C'], aliases: ['chambers'] },
  { id: 'E01', name: 'World Trade Center', lines: ['E'], aliases: ['wtc', 'world trade', 'world trade center'] },
  { id: '137', name: 'Chambers St', lines: ['1', '2', '3'], aliases: ['chambers 123'] },
  { id: 'A24', name: '59 St-Columbus Circle', lines: ['1', 'A', 'B', 'C', 'D'], aliases: ['columbus circle', '59th', '59 st'] },
  { id: '726', name: '34 St-Hudson Yards', lines: ['7'], aliases: ['hudson yards'] },
  { id: '418', name: 'Brooklyn Bridge-City Hall', lines: ['4', '5', '6', 'J', 'Z'], aliases: ['brooklyn bridge', 'city hall'] },
  { id: 'R23', name: 'Wall St', lines: ['2', '3'], aliases: ['wall street'] },
  { id: '629', name: 'Lexington Ave/59 St', lines: ['N', 'R', 'W', '4', '5', '6'], aliases: ['lex', 'lexington', 'bloomingdales', 'lex 59'] },
  { id: 'A12', name: '125 St', lines: ['A', 'B', 'C', 'D'], aliases: ['125th', 'harlem'] },
  { id: '225', name: '125 St', lines: ['1'], aliases: ['125th 1'] },
  { id: '621', name: '125 St', lines: ['4', '5', '6'], aliases: ['125th 456'] },
  { id: 'A32', name: 'Canal St', lines: ['A', 'C', 'E'], aliases: ['canal', 'chinatown'] },
  { id: '640', name: 'Canal St', lines: ['6', 'J', 'Z', 'N', 'Q', 'R', 'W'], aliases: ['canal st 6', 'canal nqrw'] },
  { id: 'A31', name: '14 St/8 Ave', lines: ['A', 'C', 'E', 'L'], aliases: ['8th ave 14th', 'chelsea', '14 st 8 ave'] },
  { id: 'A36', name: 'West 4 St-Washington Sq', lines: ['A', 'B', 'C', 'D', 'E', 'F', 'M'], aliases: ['west 4th', 'washington square', 'nyu', 'west 4 st'] },
  { id: 'D13', name: '161 St-Yankee Stadium', lines: ['4', 'B', 'D'], aliases: ['yankee stadium', 'yankees', '161st'] },
  { id: '702', name: 'Mets-Willets Point', lines: ['7'], aliases: ['citi field', 'mets', 'willets point'] },
  { id: 'H11', name: 'Howard Beach-JFK Airport', lines: ['A'], aliases: ['jfk', 'airport', 'howard beach'] },
  { id: 'D43', name: 'Coney Island-Stillwell Ave', lines: ['D', 'F', 'N', 'Q'], aliases: ['coney island', 'stillwell'] },
  { id: '401', name: 'Borough Hall', lines: ['4', '5'], aliases: ['borough hall'] },
  { id: 'R28', name: 'Court St', lines: ['R'], aliases: ['court st', 'court street'] },
  { id: 'G14', name: 'Court Sq', lines: ['G', '7', 'E', 'M'], aliases: ['court sq', 'court square', 'long island city'] },
  { id: 'L01', name: '8 Ave', lines: ['L'], aliases: ['8 ave l', '8th ave l'] },
  { id: 'L29', name: 'Canarsie-Rockaway Pkwy', lines: ['L'], aliases: ['canarsie', 'rockaway pkwy'] },
  { id: 'R01', name: 'Astoria-Ditmars Blvd', lines: ['N', 'W'], aliases: ['astoria', 'ditmars'] },
  { id: 'Q01', name: '96 St', lines: ['Q'], aliases: ['96th q', '96 st 2nd ave'] },
  { id: '101', name: 'Van Cortlandt Park-242 St', lines: ['1'], aliases: ['van cortlandt', '242 st'] },
  { id: '201', name: 'Wakefield-241 St', lines: ['2'], aliases: ['wakefield', '241 st'] },
  { id: '142', name: 'South Ferry', lines: ['1'], aliases: ['south ferry', 'whitehall', 'staten island ferry'] },
  { id: 'A02', name: 'Inwood-207 St', lines: ['A'], aliases: ['inwood', '207 st'] },
  { id: 'R17', name: '49 St', lines: ['N', 'R', 'W'], aliases: ['49th', 'rockefeller center area'] },
  { id: 'D15', name: '47-50 Sts-Rockefeller Ctr', lines: ['B', 'D', 'F', 'M'], aliases: ['rockefeller', 'rockefeller center', 'rock center', '47-50'] },
  { id: '227', name: '96 St', lines: ['1', '2', '3'], aliases: ['96th 123'] },
  { id: '626', name: '86 St', lines: ['4', '5', '6'], aliases: ['86th lex', '86 st lex'] },
  { id: '132', name: '72 St', lines: ['1', '2', '3'], aliases: ['72nd 123', '72 st 1'] },
  { id: 'R14', name: '57 St-7 Av', lines: ['N', 'Q', 'R', 'W'], aliases: ['57th 7th', '57 st 7 ave'] },
  { id: 'A25', name: '50 St', lines: ['A', 'C', 'E'], aliases: ['50th ace'] },
  { id: '125', name: '50 St', lines: ['1'], aliases: ['50th 1'] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if the bus API key is configured; print guidance if not. */
export function requireBusKey(): boolean {
  if (!MTA_BUS_API_KEY) {
    console.log('MTA BusTime API key required.');
    console.log('Get a free key at: https://register.developer.obanyc.com/');
    console.log('Then set MTA_BUS_API_KEY in your environment.');
    return false;
  }
  return true;
}

/** Fetch JSON with a 30-second timeout. */
export async function fetchJSON<T = any>(url: string): Promise<T> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  return resp.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Station Search — fuzzy matching on embedded data + GTFS stops
// ---------------------------------------------------------------------------

export function searchStation(
  query: string,
  lineFilter: string | undefined,
): ScoredStation[] {
  const q = query.toLowerCase().trim();
  const results: ScoredStation[] = [];
  const seen = new Set<string>();

  // 1. Search embedded major stations
  for (const s of STATIONS) {
    const nameMatch = s.name.toLowerCase().includes(q);
    const aliasMatch = s.aliases.some((a) => a.includes(q) || q.includes(a));
    if (nameMatch || aliasMatch) {
      if (lineFilter && !s.lines.includes(lineFilter)) continue;
      const key = `${s.id}_${s.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Rank: exact alias > alias contains > name contains
      let rank = 3;
      if (s.aliases.some((a) => a === q)) rank = 0;
      else if (s.name.toLowerCase() === q) rank = 0;
      else if (aliasMatch) rank = 1;
      else rank = 2;
      results.push({ ...s, rank });
    }
  }

  // 2. Search GTFS stops (parent stations only — location_type 1 or empty)
  if (ensureGtfs(GTFS_DIR, REFRESH_CMD)) {
    const stops = loadStops(GTFS_DIR);
    for (const s of Object.values(stops)) {
      if (s.location_type !== '1' && s.location_type !== '') continue;
      const nameMatch = (s.stop_name || '').toLowerCase().includes(q);
      if (!nameMatch) continue;

      const pid = s.stop_id;
      const key = `gtfs_${pid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        id: pid,
        name: s.stop_name,
        lines: [],
        aliases: [],
        rank: 4,
        gtfs: true,
      });
    }
  }

  results.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return results;
}

// ---------------------------------------------------------------------------
// Stop ID helpers
// ---------------------------------------------------------------------------

/** Find all GTFS stop IDs that belong to a parent station. */
export function getStopIdsForStation(stationId: string): string[] {
  if (!ensureGtfs(GTFS_DIR, REFRESH_CMD))
    return [stationId + 'N', stationId + 'S'];
  const stops = loadStops(GTFS_DIR);
  const ids: string[] = [];
  for (const [sid, s] of Object.entries(stops)) {
    if (
      sid === stationId ||
      s.parent_station === stationId ||
      sid.startsWith(stationId)
    ) {
      ids.push(sid);
    }
  }
  return ids.length ? ids : [stationId + 'N', stationId + 'S'];
}

/** Determine which feeds to fetch for a station's lines. */
export function getFeedsForStation(station: Station): string[] {
  const feeds = new Set<string>();
  if (station.lines && station.lines.length > 0) {
    for (const line of station.lines) {
      const feed = FEED_MAP[line];
      if (feed) feeds.add(feed);
    }
  }
  if (feeds.size === 0) {
    // Unknown lines — fetch all feeds
    return ALL_FEEDS;
  }
  return [...feeds];
}

/**
 * Get direction label from stop ID suffix or NYCT extension direction enum.
 * Direction enum: 1 = NORTH, 3 = SOUTH (from NyctTripDescriptor.Direction)
 */
export function getDirectionLabel(
  stopId: string,
  nyctDirection: number | null,
): string {
  if (nyctDirection === 1) return 'Uptown & The Bronx';
  if (nyctDirection === 3) return 'Downtown & Brooklyn';
  if (typeof stopId === 'string') {
    if (stopId.endsWith('N')) return 'Uptown & The Bronx';
    if (stopId.endsWith('S')) return 'Downtown & Brooklyn';
  }
  return '';
}
