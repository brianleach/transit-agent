import fs from 'node:fs';
import path from 'node:path';

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

const _csvCache = new Map<string, Record<string, string>[]>();

export function loadCsv(filename: string, gtfsDir: string): Record<string, string>[] {
  const key = `${gtfsDir}/${filename}`;
  if (_csvCache.has(key)) return _csvCache.get(key)!;
  const filePath = path.join(gtfsDir, filename);
  if (!fs.existsSync(filePath)) {
    _csvCache.set(key, []);
    return [];
  }
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    _csvCache.set(key, []);
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[j] || '';
    }
    rows.push(obj);
  }
  _csvCache.set(key, rows);
  return rows;
}

export function loadStopTimesForStopFiltered(
  stopId: string,
  gtfsDir: string,
): Record<string, string>[] {
  const cacheKey = `${gtfsDir}/_stop_times_filtered_${stopId}`;
  if (_csvCache.has(cacheKey)) return _csvCache.get(cacheKey)!;
  const filePath = path.join(gtfsDir, 'stop_times.txt');
  if (!fs.existsSync(filePath)) return [];
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const stopIdIdx = headers.indexOf('stop_id');
  if (stopIdIdx === -1) return [];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = parseCsvLine(lines[i]);
    if (vals[stopIdIdx] !== stopId) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[j] || '';
    }
    rows.push(obj);
  }
  _csvCache.set(cacheKey, rows);
  return rows;
}

export function ensureGtfs(gtfsDir: string, refreshCmd: string): boolean {
  if (!fs.existsSync(path.join(gtfsDir, 'stops.txt'))) {
    console.log(`GTFS static data not found at ${gtfsDir}`);
    console.log(`Run: ${refreshCmd}`);
    return false;
  }
  return true;
}
