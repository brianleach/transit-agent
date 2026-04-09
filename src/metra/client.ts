// ---------------------------------------------------------------------------
// Chicago Metra Commuter Rail -- Constants, Data, and Helpers
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadEnv } from '../shared/env.js';
import { parseCsvLine, loadCsv, loadStopTimesForStopFiltered, ensureGtfs } from '../shared/csv.js';
import { loadStops, loadRoutes, loadTrips, getActiveServiceIds } from '../shared/gtfs.js';
import { haversine } from '../shared/geo.js';
import type {
  MetraLineInfo,
  MetraLineCode,
  MetraStation,
  StationSearchResult,
  FareEntry,
  FareKey,
  ZoneLetter,
} from './types.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

loadEnv(path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..'));

// ---------------------------------------------------------------------------
// API Configuration
// ---------------------------------------------------------------------------

export const METRA_API_KEY = process.env.METRA_API_KEY || '';

export const FEED_BASE = 'https://gtfspublic.metrarr.com/gtfs/public';
export const FEEDS = {
  trip_updates: `${FEED_BASE}/tripupdates`,
  vehicle_positions: `${FEED_BASE}/positions`,
  alerts: `${FEED_BASE}/alerts`,
};

export const GTFS_STATIC_URL = 'https://schedules.metrarail.com/gtfs/schedule.zip';
export const GTFS_PUBLISHED_URL = 'https://schedules.metrarail.com/gtfs/published.txt';
export const GTFS_DIR = path.join(os.homedir(), '.metra', 'gtfs');

export const TZ = 'US/Central' as const;

// ---------------------------------------------------------------------------
// Metra Lines Metadata
// ---------------------------------------------------------------------------

export const METRA_LINES: Record<MetraLineCode, MetraLineInfo> = {
  'BNSF':  { name: 'BNSF Railway',              color: 'Orange',      terminal: 'Union Station (CUS)',                    outer: 'Aurora' },
  'ME':    { name: 'Metra Electric',             color: 'Teal',        terminal: 'Millennium Station',                     outer: 'University Park / South Chicago / Blue Island' },
  'HC':    { name: 'Heritage Corridor',          color: 'Purple',      terminal: 'Union Station (CUS)',                    outer: 'Joliet' },
  'MD-N':  { name: 'Milwaukee District North',   color: 'Light Green', terminal: 'Union Station (CUS)',                    outer: 'Fox Lake' },
  'MD-W':  { name: 'Milwaukee District West',    color: 'Light Green', terminal: 'Union Station (CUS)',                    outer: 'Elburn / Big Timber' },
  'NCS':   { name: 'North Central Service',      color: 'Gold',        terminal: 'Union Station (CUS)',                    outer: 'Antioch' },
  'RI':    { name: 'Rock Island',                color: 'Red',         terminal: 'LaSalle Street Station',                 outer: 'Joliet' },
  'SWS':   { name: 'SouthWest Service',          color: 'Dark Purple', terminal: 'Union Station (CUS)',                    outer: 'Manhattan' },
  'UP-N':  { name: 'Union Pacific North',        color: 'Dark Green',  terminal: 'Ogilvie Transportation Center (OTC)',    outer: 'Kenosha' },
  'UP-NW': { name: 'Union Pacific Northwest',    color: 'Blue',        terminal: 'Ogilvie Transportation Center (OTC)',    outer: 'Harvard / McHenry' },
  'UP-W':  { name: 'Union Pacific West',         color: 'Blue',        terminal: 'Ogilvie Transportation Center (OTC)',    outer: 'Elburn' },
};

// ---------------------------------------------------------------------------
// Route code aliases for user-friendly matching
// ---------------------------------------------------------------------------

export const ROUTE_ALIASES: Record<string, MetraLineCode> = {
  'bnsf': 'BNSF', 'burlington': 'BNSF', 'burlington northern': 'BNSF',
  'me': 'ME', 'metra electric': 'ME', 'electric': 'ME',
  'hc': 'HC', 'heritage': 'HC', 'heritage corridor': 'HC',
  'md-n': 'MD-N', 'mdn': 'MD-N', 'milwaukee north': 'MD-N', 'mil north': 'MD-N', 'milwaukee district north': 'MD-N',
  'md-w': 'MD-W', 'mdw': 'MD-W', 'milwaukee west': 'MD-W', 'mil west': 'MD-W', 'milwaukee district west': 'MD-W',
  'ncs': 'NCS', 'north central': 'NCS', 'north central service': 'NCS',
  'ri': 'RI', 'rock island': 'RI', 'rock': 'RI',
  'sws': 'SWS', 'southwest': 'SWS', 'south west': 'SWS', 'southwest service': 'SWS',
  'up-n': 'UP-N', 'upn': 'UP-N', 'union pacific north': 'UP-N',
  'up-nw': 'UP-NW', 'upnw': 'UP-NW', 'union pacific northwest': 'UP-NW',
  'up-w': 'UP-W', 'upw': 'UP-W', 'union pacific west': 'UP-W',
};

// ---------------------------------------------------------------------------
// Major Stations with Aliases (for fuzzy matching without GTFS)
// ---------------------------------------------------------------------------

export const STATIONS: MetraStation[] = [
  // Downtown terminals
  { name: 'Chicago Union Station', lines: ['BNSF', 'HC', 'MD-N', 'MD-W', 'NCS', 'SWS'], aliases: ['union station', 'cus', 'chicago union station', 'union', 'chicago union'] },
  { name: 'Ogilvie Transportation Center', lines: ['UP-N', 'UP-NW', 'UP-W'], aliases: ['ogilvie', 'otc', 'ogilvie transportation center', 'northwestern station', 'ogilvie transportation'] },
  { name: 'LaSalle Street Station', lines: ['RI'], aliases: ['lasalle', 'lasalle street', 'lasalle street station', 'la salle', 'lasalle station'] },
  { name: 'Millennium Station', lines: ['ME'], aliases: ['millennium', 'millennium station', 'randolph street'] },
  // BNSF line
  { name: 'Naperville', lines: ['BNSF'], aliases: ['naperville'] },
  { name: 'Aurora', lines: ['BNSF'], aliases: ['aurora'] },
  { name: 'Route 59', lines: ['BNSF'], aliases: ['route 59'] },
  { name: 'Lisle', lines: ['BNSF'], aliases: ['lisle'] },
  { name: 'Downers Grove Main Street', lines: ['BNSF'], aliases: ['downers grove', 'downers grove main'] },
  { name: 'Westmont', lines: ['BNSF'], aliases: ['westmont'] },
  { name: 'Clarendon Hills', lines: ['BNSF'], aliases: ['clarendon hills'] },
  { name: 'Hinsdale', lines: ['BNSF'], aliases: ['hinsdale'] },
  { name: 'Western Springs', lines: ['BNSF'], aliases: ['western springs'] },
  { name: 'LaGrange Road', lines: ['BNSF'], aliases: ['lagrange', 'la grange', 'lagrange road'] },
  { name: 'Brookfield', lines: ['BNSF'], aliases: ['brookfield bnsf'] },
  { name: 'Berwyn', lines: ['BNSF'], aliases: ['berwyn'] },
  { name: 'Cicero', lines: ['BNSF'], aliases: ['cicero bnsf'] },
  { name: 'Halsted Street', lines: ['BNSF'], aliases: ['halsted bnsf'] },
  // UP-N line
  { name: 'Clybourn', lines: ['UP-N'], aliases: ['clybourn'] },
  { name: 'Ravenswood', lines: ['UP-N'], aliases: ['ravenswood'] },
  { name: 'Rogers Park', lines: ['UP-N'], aliases: ['rogers park'] },
  { name: 'Evanston Davis Street', lines: ['UP-N'], aliases: ['evanston', 'davis street', 'davis st', 'evanston davis'] },
  { name: 'Wilmette', lines: ['UP-N'], aliases: ['wilmette'] },
  { name: 'Kenilworth', lines: ['UP-N'], aliases: ['kenilworth'] },
  { name: 'Winnetka', lines: ['UP-N'], aliases: ['winnetka'] },
  { name: 'Glencoe', lines: ['UP-N'], aliases: ['glencoe'] },
  { name: 'Highland Park', lines: ['UP-N'], aliases: ['highland park'] },
  { name: 'Lake Forest', lines: ['UP-N'], aliases: ['lake forest'] },
  { name: 'Waukegan', lines: ['UP-N'], aliases: ['waukegan'] },
  { name: 'Kenosha', lines: ['UP-N'], aliases: ['kenosha'] },
  // UP-NW line
  { name: 'Arlington Heights', lines: ['UP-NW'], aliases: ['arlington heights'] },
  { name: 'Palatine', lines: ['UP-NW'], aliases: ['palatine'] },
  { name: 'Barrington', lines: ['UP-NW'], aliases: ['barrington'] },
  { name: 'Crystal Lake', lines: ['UP-NW'], aliases: ['crystal lake'] },
  { name: 'Harvard', lines: ['UP-NW'], aliases: ['harvard'] },
  { name: 'McHenry', lines: ['UP-NW'], aliases: ['mchenry'] },
  { name: 'Cary', lines: ['UP-NW'], aliases: ['cary'] },
  { name: 'Des Plaines', lines: ['UP-NW'], aliases: ['des plaines up-nw'] },
  { name: 'Mount Prospect', lines: ['UP-NW'], aliases: ['mount prospect', 'mt prospect'] },
  // UP-W line
  { name: 'Elmhurst', lines: ['UP-W'], aliases: ['elmhurst'] },
  { name: 'Glen Ellyn', lines: ['UP-W'], aliases: ['glen ellyn'] },
  { name: 'Wheaton', lines: ['UP-W'], aliases: ['wheaton'] },
  { name: 'Geneva', lines: ['UP-W'], aliases: ['geneva'] },
  { name: 'Elburn', lines: ['UP-W'], aliases: ['elburn'] },
  { name: 'West Chicago', lines: ['UP-W'], aliases: ['west chicago'] },
  { name: 'Villa Park', lines: ['UP-W'], aliases: ['villa park'] },
  { name: 'Lombard', lines: ['UP-W'], aliases: ['lombard'] },
  // MD-N line
  { name: 'Libertyville', lines: ['MD-N'], aliases: ['libertyville'] },
  { name: 'Vernon Hills', lines: ['MD-N'], aliases: ['vernon hills'] },
  { name: 'Lake Cook Road', lines: ['MD-N', 'NCS'], aliases: ['lake cook', 'lake cook road'] },
  { name: 'Fox Lake', lines: ['MD-N'], aliases: ['fox lake'] },
  { name: 'Deerfield', lines: ['MD-N'], aliases: ['deerfield'] },
  { name: 'Morton Grove', lines: ['MD-N'], aliases: ['morton grove'] },
  // MD-W line
  { name: 'Elgin', lines: ['MD-W'], aliases: ['elgin'] },
  { name: 'Bensenville', lines: ['MD-W'], aliases: ['bensenville'] },
  { name: 'Roselle', lines: ['MD-W'], aliases: ['roselle'] },
  { name: 'Itasca', lines: ['MD-W'], aliases: ['itasca'] },
  { name: 'Hanover Park', lines: ['MD-W'], aliases: ['hanover park'] },
  { name: 'Schaumburg', lines: ['MD-W'], aliases: ['schaumburg'] },
  { name: 'Franklin Park', lines: ['MD-W'], aliases: ['franklin park'] },
  // ME line
  { name: 'University Park', lines: ['ME'], aliases: ['university park'] },
  { name: '93rd Street (South Chicago)', lines: ['ME'], aliases: ['south chicago', '93rd st', '93rd street'] },
  { name: 'Blue Island', lines: ['ME'], aliases: ['blue island'] },
  { name: 'McCormick Place', lines: ['ME'], aliases: ['mccormick', 'mccormick place'] },
  { name: 'Museum Campus/11th Street', lines: ['ME'], aliases: ['museum campus', '11th st', '11th street'] },
  { name: 'Hyde Park (53rd Street)', lines: ['ME'], aliases: ['hyde park', '53rd st', '53rd street'] },
  { name: 'Homewood', lines: ['ME'], aliases: ['homewood'] },
  // RI line
  { name: 'Joliet', lines: ['RI', 'HC'], aliases: ['joliet'] },
  { name: 'New Lenox', lines: ['RI'], aliases: ['new lenox'] },
  { name: '35th Street/"Lou Jones"', lines: ['RI'], aliases: ['35th st', '35th street', 'bronzeville'] },
  { name: 'Oak Forest', lines: ['RI'], aliases: ['oak forest'] },
  { name: 'Tinley Park', lines: ['RI'], aliases: ['tinley park'] },
  // NCS line
  { name: 'Antioch', lines: ['NCS'], aliases: ['antioch'] },
  { name: 'Prairie Crossing', lines: ['NCS'], aliases: ['prairie crossing'] },
  // SWS line
  { name: 'Manhattan', lines: ['SWS'], aliases: ['manhattan sws'] },
  { name: 'Orland Park', lines: ['SWS'], aliases: ['orland park'] },
  { name: 'Palos Heights', lines: ['SWS'], aliases: ['palos heights'] },
  { name: 'Chicago Ridge', lines: ['SWS'], aliases: ['chicago ridge'] },
  // HC line
  { name: 'Lockport', lines: ['HC'], aliases: ['lockport'] },
  { name: 'Lemont', lines: ['HC'], aliases: ['lemont'] },
  { name: 'Summit', lines: ['HC'], aliases: ['summit'] },
];

// ---------------------------------------------------------------------------
// Fare Data (4-Zone System, effective Feb 2024)
// ---------------------------------------------------------------------------

export const ZONE_LETTER_MAP: Record<ZoneLetter, number> = {
  'A': 1, 'B': 1, 'C': 2, 'D': 2, 'E': 3, 'F': 3, 'G': 3, 'H': 4, 'I': 4, 'J': 4,
};

export const FARE_TABLE: Record<FareKey, FareEntry> = {
  '1-2':  { oneWay: 3.75,  dayPass: 7.50,  dayPass5: 35.75,  monthly: 75.00 },
  '1-3':  { oneWay: 5.50,  dayPass: 11.00, dayPass5: 52.25,  monthly: 110.00 },
  '1-4':  { oneWay: 6.75,  dayPass: 13.50, dayPass5: 64.25,  monthly: 135.00 },
  '2-4':  { oneWay: 3.75,  dayPass: 7.50,  dayPass5: 35.75,  monthly: 75.00 },
};

// ---------------------------------------------------------------------------
// Fare helpers
// ---------------------------------------------------------------------------

export function zoneIdToFareZone(zoneId: string): number | null {
  if (!zoneId) return null;
  const upper = zoneId.toUpperCase().trim() as ZoneLetter;
  if (ZONE_LETTER_MAP[upper] !== undefined) return ZONE_LETTER_MAP[upper];
  const num = parseInt(upper);
  if (num >= 1 && num <= 4) return num;
  return null;
}

export function getFareKey(zone1: number, zone2: number): FareKey {
  const lo = Math.min(zone1, zone2);
  const hi = Math.max(zone1, zone2);
  if (lo === hi) return `${lo}-${lo + 1}` as FareKey; // Same zone -> minimum fare
  if (lo === 1) return `1-${hi}` as FareKey;
  return '2-4'; // Neither end is zone 1
}

// ---------------------------------------------------------------------------
// Line / Route Resolution
// ---------------------------------------------------------------------------

export function resolveLineCode(input: string): string | null {
  if (!input) return null;
  const upper = input.toUpperCase();
  if ((METRA_LINES as Record<string, MetraLineInfo>)[upper]) return upper;
  return ROUTE_ALIASES[input.toLowerCase()] || upper;
}

// ---------------------------------------------------------------------------
// Trip ID helpers
// ---------------------------------------------------------------------------

export function lineFromTripId(tripId: string): string {
  if (!tripId) return '';
  const prefix = tripId.split('_')[0];
  if ((METRA_LINES as Record<string, MetraLineInfo>)[prefix]) return prefix;
  for (const code of Object.keys(METRA_LINES)) {
    if (tripId.toUpperCase().startsWith(code + '_') || tripId.toUpperCase().startsWith(code.replace('-', '') + '_')) {
      return code;
    }
  }
  return prefix;
}

export function trainNumberFromTripId(tripId: string): string {
  if (!tripId) return '';
  const parts = tripId.split('_');
  return parts.length >= 2 ? parts[1] : tripId;
}

export function directionLabel(directionId: number | string | undefined): string {
  if (directionId === 0 || directionId === '0') return 'Outbound';
  if (directionId === 1 || directionId === '1') return 'Inbound';
  return '';
}

// ---------------------------------------------------------------------------
// GTFS Time formatting
// ---------------------------------------------------------------------------

export function fmtGtfsTime(timeStr: string): string {
  if (!timeStr) return '??';
  const [h, m] = timeStr.split(':');
  let hr = parseInt(h);
  if (isNaN(hr)) return timeStr;
  // GTFS allows hours >= 24 for next-day trips
  if (hr >= 24) hr -= 24;
  const ampm = hr >= 12 ? 'PM' : 'AM';
  if (hr > 12) hr -= 12; else if (hr === 0) hr = 12;
  return `${hr}:${m} ${ampm}`;
}

// ---------------------------------------------------------------------------
// Metra-specific GTFS CSV loader (trims headers and values)
// ---------------------------------------------------------------------------

const _metraCsvCache = new Map<string, Record<string, string>[]>();

export function loadMetraCsv(filename: string): Record<string, string>[] {
  const key = `${GTFS_DIR}/${filename}`;
  if (_metraCsvCache.has(key)) return _metraCsvCache.get(key)!;
  const filePath = path.join(GTFS_DIR, filename);
  if (!fs.existsSync(filePath)) { _metraCsvCache.set(key, []); return []; }
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) { _metraCsvCache.set(key, []); return []; }
  // Metra GTFS CSVs have spaces after commas -- trim all headers and values
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (vals[j] || '').trim();
    }
    rows.push(obj);
  }
  _metraCsvCache.set(key, rows);
  return rows;
}

// ---------------------------------------------------------------------------
// Metra-specific GTFS data loaders (with trimming)
// ---------------------------------------------------------------------------

let _stopsCache: Record<string, Record<string, string>> | null = null;
export function metraLoadStops(): Record<string, Record<string, string>> {
  if (_stopsCache) return _stopsCache;
  const rows = loadMetraCsv('stops.txt');
  const m: Record<string, Record<string, string>> = {};
  for (const r of rows) m[r.stop_id] = r;
  _stopsCache = m;
  return m;
}

let _routesCache: Record<string, Record<string, string>> | null = null;
export function metraLoadRoutes(): Record<string, Record<string, string>> {
  if (_routesCache) return _routesCache;
  const rows = loadMetraCsv('routes.txt');
  const m: Record<string, Record<string, string>> = {};
  for (const r of rows) m[r.route_id] = r;
  _routesCache = m;
  return m;
}

let _tripsCache: Record<string, Record<string, string>> | null = null;
export function metraLoadTrips(): Record<string, Record<string, string>> {
  if (_tripsCache) return _tripsCache;
  const rows = loadMetraCsv('trips.txt');
  const m: Record<string, Record<string, string>> = {};
  for (const r of rows) m[r.trip_id] = r;
  _tripsCache = m;
  return m;
}

export function metraGetActiveServiceIds(dateStr: string): Set<string> {
  const active = new Set<string>();
  const calRows = loadMetraCsv('calendar.txt');
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const y = parseInt(dateStr.slice(0, 4));
  const m = parseInt(dateStr.slice(4, 6)) - 1;
  const d = parseInt(dateStr.slice(6, 8));
  const dayOfWeek = new Date(Date.UTC(y, m, d)).getUTCDay();
  const dayCol = dayNames[dayOfWeek];
  for (const r of calRows) {
    if (r[dayCol] === '1' && dateStr >= r.start_date && dateStr <= r.end_date) {
      active.add(r.service_id);
    }
  }
  const exceptRows = loadMetraCsv('calendar_dates.txt');
  for (const r of exceptRows) {
    if (r.date !== dateStr) continue;
    if (r.exception_type === '1') active.add(r.service_id);
    else if (r.exception_type === '2') active.delete(r.service_id);
  }
  return active;
}

// ---------------------------------------------------------------------------
// Metra-specific stop_times loaders (with trimming)
// ---------------------------------------------------------------------------

function loadStopTimesFiltered(filterKey: string, filterValue: string): Record<string, string>[] {
  const filename = 'stop_times.txt';
  const filePath = path.join(GTFS_DIR, filename);
  if (!fs.existsSync(filePath)) return [];
  const cacheKey = `${GTFS_DIR}/${filename}`;
  // If already fully cached, just filter the cache
  if (_metraCsvCache.has(cacheKey)) {
    return _metraCsvCache.get(cacheKey)!.filter(r => r[filterKey] === filterValue);
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const keyIdx = headers.indexOf(filterKey);
  if (keyIdx === -1) return [];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if ((vals[keyIdx] || '').trim() === filterValue) {
      const obj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = (vals[j] || '').trim();
      }
      rows.push(obj);
    }
  }
  return rows;
}

export function loadStopTimesForStop(stopId: string): Record<string, string>[] {
  return loadStopTimesFiltered('stop_id', stopId);
}

export function loadStopTimesForTrip(tripId: string): Record<string, string>[] {
  return loadStopTimesFiltered('trip_id', tripId)
    .sort((a, b) => parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'));
}

// ---------------------------------------------------------------------------
// GTFS data presence check
// ---------------------------------------------------------------------------

export function metraEnsureGtfs(): boolean {
  return ensureGtfs(GTFS_DIR, 'node scripts/metra.mjs refresh-gtfs');
}

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

export function requireApiKey(): boolean {
  if (!METRA_API_KEY) {
    console.log('Metra API key required.');
    console.log('Get a free key at: https://metra.com/developers');
    console.log('Then set METRA_API_KEY in your environment.');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Station Search -- fuzzy matching on embedded data + GTFS stops
// ---------------------------------------------------------------------------

export function searchStation(query: string, lineFilter: string | null): StationSearchResult[] {
  const q = query.toLowerCase().trim();
  const results: StationSearchResult[] = [];
  const seen = new Set<string>();

  // 1. Search embedded major stations
  for (const s of STATIONS) {
    if (lineFilter && !s.lines.includes(lineFilter)) continue;
    const nameNorm = s.name.toLowerCase();
    let score = 999;
    if (nameNorm === q) score = 0;
    else if (s.aliases.some(a => a === q)) score = 1;
    else if (nameNorm.includes(q)) score = 2;
    else if (s.aliases.some(a => a.includes(q))) score = 3;
    else if (q.split(/\s+/).every(w => nameNorm.includes(w) || s.aliases.some(a => a.includes(w)))) score = 4;
    else continue;
    const key = s.name;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...s, score, source: 'embedded' });
  }

  // 2. Search GTFS stops
  if (fs.existsSync(path.join(GTFS_DIR, 'stops.txt'))) {
    const stops = metraLoadStops();
    for (const [sid, s] of Object.entries(stops)) {
      const nameNorm = (s.stop_name || '').toLowerCase();
      let score = 999;
      if (nameNorm === q) score = 5;
      else if (nameNorm.includes(q)) score = 6;
      else continue;
      const key = `gtfs_${sid}`;
      if (seen.has(key)) continue;
      // Also skip if the same name was already matched from embedded data
      if (seen.has(s.stop_name)) continue;
      seen.add(key);
      results.push({
        name: s.stop_name,
        stop_id: sid,
        lines: [],
        aliases: [],
        score,
        source: 'gtfs',
        zone_id: s.zone_id || '',
      });
    }
  }

  results.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return results;
}

// ---------------------------------------------------------------------------
// Resolve GTFS stop_id(s) for a station name
// ---------------------------------------------------------------------------

export function resolveStopIds(stationName: string, lineFilter: string | null): string[] {
  if (!metraEnsureGtfs()) return [];
  const stops = metraLoadStops();
  const routes = metraLoadRoutes();
  const trips = metraLoadTrips();
  const q = stationName.toLowerCase().trim();

  // Direct stop_id match
  if (stops[q] || stops[q.toUpperCase()]) {
    return [q.toUpperCase()];
  }

  // Also check well-known stop_id mappings for embedded stations
  const embeddedMatch = STATIONS.find(s => s.name.toLowerCase() === q || s.aliases.some(a => a === q));

  // Name match -- try multiple strategies
  const matched: string[] = [];
  for (const [sid, s] of Object.entries(stops)) {
    const nameNorm = (s.stop_name || '').toLowerCase();
    // Exact or contains match (either direction)
    if (nameNorm === q || nameNorm.includes(q) || q.includes(nameNorm)) {
      matched.push(sid);
      continue;
    }
    // Try matching individual words from the query
    const queryWords = q.split(/[\s/(),.]+/).filter(w => w.length > 2);
    if (queryWords.length > 0 && queryWords.every(w => nameNorm.includes(w))) {
      matched.push(sid);
      continue;
    }
    // Try aliases from embedded station data
    if (embeddedMatch) {
      for (const alias of embeddedMatch.aliases) {
        if (nameNorm.includes(alias) || alias.includes(nameNorm)) {
          matched.push(sid);
          break;
        }
      }
    }
  }

  // If line filter, verify stops are actually on that line
  if (lineFilter && matched.length > 0) {
    const stopTimesAll = loadMetraCsv('stop_times.txt');
    const lineTrips = new Set<string>();
    for (const [tid, t] of Object.entries(trips)) {
      const routeId = t.route_id || '';
      const rShort = routes[routeId]?.route_short_name || routeId;
      if (rShort.toUpperCase() === lineFilter || routeId.toUpperCase() === lineFilter) {
        lineTrips.add(tid);
      }
    }
    const stopsOnLine = new Set<string>();
    for (const st of stopTimesAll) {
      if (lineTrips.has(st.trip_id)) stopsOnLine.add(st.stop_id);
    }
    const filtered = matched.filter(sid => stopsOnLine.has(sid));
    if (filtered.length > 0) return filtered;
  }

  return matched;
}

// ---------------------------------------------------------------------------
// Clear caches (used after GTFS refresh)
// ---------------------------------------------------------------------------

export function clearCaches(): void {
  _stopsCache = null;
  _routesCache = null;
  _tripsCache = null;
  _metraCsvCache.clear();
}
