/**
 * CapMetro Austin Transit — Constants and helpers
 */

import path from 'node:path';
import os from 'node:os';
import type { FeedsConfig } from './types.js';
import { loadCsv, loadStopTimesForStopFiltered } from '../shared/csv.js';

// ---------------------------------------------------------------------------
// Feed URLs (Texas Open Data Portal — open access, no key)
// ---------------------------------------------------------------------------

export const FEEDS: FeedsConfig = {
  vehicle_positions_json:
    'https://data.texas.gov/download/cuc7-ywmd/text%2Fplain',
  vehicle_positions_pb:
    'https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream',
  trip_updates_pb:
    'https://data.texas.gov/download/rmk2-acnw/application%2Foctet-stream',
  service_alerts_pb:
    'https://data.texas.gov/download/nusn-7fcn/application%2Foctet-stream',
  gtfs_static:
    'https://data.texas.gov/download/r4v4-vz24/application%2Fx-zip-compressed',
};

// ---------------------------------------------------------------------------
// GTFS directory
// ---------------------------------------------------------------------------

export const GTFS_DIR = path.join(os.homedir(), '.capmetro', 'gtfs');

// ---------------------------------------------------------------------------
// Timezone constant
// ---------------------------------------------------------------------------

export const TZ = 'US/Central' as const;

// ---------------------------------------------------------------------------
// Route emoji helper
// ---------------------------------------------------------------------------

export function getRouteEmoji(
  routeId: string,
  routeType: string | number,
): string {
  // Rail/tram routes get a train emoji; everything else gets a bus
  // route_type 0 = Tram/Light Rail, 2 = Rail; route 550 = MetroRail
  if (
    routeType === '0' ||
    routeType === 0 ||
    routeType === '2' ||
    routeType === 2 ||
    routeId === '550'
  ) {
    return '\u{1F686}'; // train emoji
  }
  return '\u{1F68C}'; // bus emoji
}

// ---------------------------------------------------------------------------
// CapMetro-specific GTFS helpers not in shared
// ---------------------------------------------------------------------------

/**
 * Load stop_times for a specific stop, using the filtered loader when the
 * full stop_times cache is not already loaded. Mirrors original behavior.
 */
export function loadStopTimesForStop(
  stopId: string,
  gtfsDir: string,
): Record<string, string>[] {
  // Check if the full stop_times.txt is already cached by attempting
  // a normal loadCsv — if it returns results, filter from there.
  // Otherwise use the filtered streaming loader.
  const full = loadCsv('stop_times.txt', gtfsDir);
  if (full.length > 0) {
    return full.filter((r) => r.stop_id === stopId);
  }
  return loadStopTimesForStopFiltered(stopId, gtfsDir);
}

/**
 * Load stop_times for a specific trip, sorted by stop_sequence.
 */
export function loadStopTimesForTrip(
  tripId: string,
  gtfsDir: string,
): Record<string, string>[] {
  const rows = loadCsv('stop_times.txt', gtfsDir);
  return rows
    .filter((r) => r.trip_id === tripId)
    .sort(
      (a, b) =>
        parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'),
    );
}

/**
 * Get active service IDs for a specific date string (YYYYMMDD).
 * The shared getActiveServiceIds always uses "today", but CapMetro's
 * arrivals command needs to check both today and tomorrow.
 */
export function getActiveServiceIdsForDate(
  dateStr: string,
  gtfsDir: string,
): Set<string> {
  const active = new Set<string>();

  // calendar.txt: recurring service by day-of-week
  const calRows = loadCsv('calendar.txt', gtfsDir);
  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const y = parseInt(dateStr.slice(0, 4));
  const m = parseInt(dateStr.slice(4, 6)) - 1;
  const d = parseInt(dateStr.slice(6, 8));
  const dayOfWeek = new Date(Date.UTC(y, m, d)).getUTCDay();
  const dayCol = dayNames[dayOfWeek];
  for (const r of calRows) {
    if (
      r[dayCol] === '1' &&
      dateStr >= r.start_date &&
      dateStr <= r.end_date
    ) {
      active.add(r.service_id);
    }
  }

  // calendar_dates.txt: exceptions (type 1 = added, type 2 = removed)
  const exceptRows = loadCsv('calendar_dates.txt', gtfsDir);
  for (const r of exceptRows) {
    if (r.date !== dateStr) continue;
    if (r.exception_type === '1') active.add(r.service_id);
    else if (r.exception_type === '2') active.delete(r.service_id);
  }

  return active;
}
