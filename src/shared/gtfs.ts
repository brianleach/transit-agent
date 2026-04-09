import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadCsv } from './csv.js';

export function loadStops(
  gtfsDir: string,
): Record<string, Record<string, string>> {
  const rows = loadCsv('stops.txt', gtfsDir);
  const map: Record<string, Record<string, string>> = {};
  for (const r of rows) map[r.stop_id] = r;
  return map;
}

export function loadRoutes(
  gtfsDir: string,
): Record<string, Record<string, string>> {
  const rows = loadCsv('routes.txt', gtfsDir);
  const map: Record<string, Record<string, string>> = {};
  for (const r of rows) map[r.route_id] = r;
  return map;
}

export function loadTrips(
  gtfsDir: string,
): Record<string, Record<string, string>> {
  const rows = loadCsv('trips.txt', gtfsDir);
  const map: Record<string, Record<string, string>> = {};
  for (const r of rows) map[r.trip_id] = r;
  return map;
}

export function getActiveServiceIds(gtfsDir: string): Set<string> {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun
  const dayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const todayStr =
    String(now.getFullYear()) +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');

  const ids = new Set<string>();
  const calendar = loadCsv('calendar.txt', gtfsDir);
  for (const row of calendar) {
    if (row[dayNames[dow]] === '1' && todayStr >= row.start_date && todayStr <= row.end_date) {
      ids.add(row.service_id);
    }
  }
  const dates = loadCsv('calendar_dates.txt', gtfsDir);
  for (const row of dates) {
    if (row.date === todayStr) {
      if (row.exception_type === '1') ids.add(row.service_id);
      else if (row.exception_type === '2') ids.delete(row.service_id);
    }
  }
  return ids;
}

export async function refreshGtfs(
  url: string,
  gtfsDir: string,
  timeout = 120_000,
): Promise<void> {
  const dir = path.dirname(gtfsDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(gtfsDir, { recursive: true });
  const zipPath = path.join(dir, 'gtfs.zip');
  console.log(`Downloading GTFS static data...`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} downloading GTFS`);
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(zipPath, buf);
  console.log(`Extracting to ${gtfsDir}...`);
  execFileSync('unzip', ['-o', zipPath, '-d', gtfsDir], { stdio: 'pipe' });
  fs.unlinkSync(zipPath);
  console.log('GTFS data refreshed successfully.');
}
