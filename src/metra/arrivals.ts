#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Chicago Metra Commuter Rail -- CLI Entry Point
// Real-time train arrivals (GTFS-RT protobuf), vehicle positions, service alerts,
// schedule info, and fare calculation for all 11 Metra lines.
// ---------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parsePbWithAuth } from '../shared/proto.js';
import { toLocalDate, localNow, fmtTime, fmtTimeHM, fmtDateTimeShort } from '../shared/time.js';
import { haversine } from '../shared/geo.js';
import { refreshGtfs } from '../shared/gtfs.js';
import type {
  CliOptions,
  ArrivalEntry,
  ScheduledDeparture,
  VehicleEntry,
  AlertEntry,
  ScheduleEntry,
} from './types.js';
import {
  METRA_API_KEY,
  FEEDS,
  GTFS_STATIC_URL,
  GTFS_PUBLISHED_URL,
  GTFS_DIR,
  TZ,
  METRA_LINES,
  requireApiKey,
  resolveLineCode,
  searchStation,
  resolveStopIds,
  lineFromTripId,
  trainNumberFromTripId,
  directionLabel,
  fmtGtfsTime,
  metraLoadStops,
  metraLoadRoutes,
  metraLoadTrips,
  metraGetActiveServiceIds,
  metraEnsureGtfs,
  loadStopTimesForStop,
  loadStopTimesForTrip,
  loadMetraCsv,
  FARE_TABLE,
  ZONE_LETTER_MAP,
  zoneIdToFareZone,
  getFareKey,
  STATIONS,
  clearCaches,
} from './client.js';
import type { MetraLineInfo, FareKey } from './types.js';

// ---------------------------------------------------------------------------
// Protobuf helper (Metra uses Bearer token auth)
// ---------------------------------------------------------------------------

async function parsePb(url: string): Promise<any> {
  if (!METRA_API_KEY) throw new Error('METRA_API_KEY is not set');
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { 'Authorization': `Bearer ${METRA_API_KEY}` },
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Authentication failed. Check your METRA_API_KEY.');
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  // Use shared parsePbWithAuth for the actual decoding; we handle the auth
  // error ourselves above for the specific 401/403 message. Re-fetch would
  // be wasteful, so decode the buffer directly.
  const { getProtobufRoot } = await import('../shared/proto.js');
  const root = await getProtobufRoot();
  const FeedMessage = root.lookupType('transit_realtime.FeedMessage');
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > 0 && buf[0] === 0x3c) {
    throw new Error('Feed returned HTML instead of protobuf — endpoint may be temporarily unavailable');
  }
  return FeedMessage.decode(buf);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRefreshGtfs(): Promise<void> {
  console.log(`Downloading GTFS static data to ${GTFS_DIR} ...`);
  fs.mkdirSync(GTFS_DIR, { recursive: true });

  // Check published timestamp
  try {
    const pubResp = await fetch(GTFS_PUBLISHED_URL, { signal: AbortSignal.timeout(10_000) });
    if (pubResp.ok) {
      const pubText = (await pubResp.text()).trim();
      console.log(`Schedule last published: ${pubText}`);
    }
  } catch { /* ignore */ }

  await refreshGtfs(GTFS_STATIC_URL, GTFS_DIR);
  clearCaches();

  const files = fs.readdirSync(GTFS_DIR).filter(f => f.endsWith('.txt')).sort();
  console.log(`Extracted ${files.length} files:`);
  for (const f of files) console.log(`  ${f}`);
  console.log('GTFS data refreshed successfully.');
}

// ---- Arrivals ----

async function cmdArrivals(opts: CliOptions): Promise<void> {
  if (!requireApiKey()) return;

  const stationName = opts.station;
  const lineFilter = opts.line ? resolveLineCode(opts.line) : null;

  if (!stationName) {
    console.log('Provide --station with a station name.');
    console.log("Use 'stops --search <name>' to find stations.");
    return;
  }

  // Resolve station
  const matches = searchStation(stationName, lineFilter);
  if (!matches.length) {
    console.log(`No stations found matching '${stationName}'.`);
    console.log("Try 'stops --search <name>' to search all stops.");
    return;
  }

  if (matches.length > 1 && matches[0].score > 0) {
    console.log(`Found ${matches.length} stations matching '${stationName}':`);
    for (const s of matches.slice(0, 8)) {
      const lineStr = s.lines?.length ? ` (${s.lines.join(', ')})` : '';
      console.log(`  ${s.name}${lineStr}`);
    }
    console.log(`\nUsing best match: ${matches[0].name}\n`);
  }

  const station = matches[0];
  const stopIds = resolveStopIds(station.name, lineFilter);

  if (!stopIds.length) {
    console.log(`Could not resolve stop IDs for '${station.name}'.`);
    console.log('Try running refresh-gtfs to update station data.');
    return;
  }

  const targetSet = new Set(stopIds);
  const stationLabel = station.name;
  const lineInfo = lineFilter && (METRA_LINES as Record<string, MetraLineInfo>)[lineFilter]
    ? (METRA_LINES as Record<string, MetraLineInfo>)[lineFilter]
    : null;

  console.log(`\n\u{1F686} === Arrivals at: ${stationLabel} ===`);
  if (lineInfo) console.log(`    Line: ${lineInfo.name}`);
  console.log();

  // Fetch trip updates
  const feed = await parsePb(FEEDS.trip_updates);
  const routes = metraEnsureGtfs() ? metraLoadRoutes() : {};
  const trips = metraEnsureGtfs() ? metraLoadTrips() : {};
  const now = localNow(TZ);
  const arrivals: ArrivalEntry[] = [];

  for (const entity of feed.entity || []) {
    const tu = entity.tripUpdate || entity.trip_update;
    if (!tu) continue;

    const tripId = tu.trip?.tripId || tu.trip?.trip_id || '';
    const routeId = tu.trip?.routeId || tu.trip?.route_id || '';
    const dirId = tu.trip?.directionId ?? tu.trip?.direction_id;
    const rShort = routes[routeId]?.route_short_name || routeId;
    const tripLine = rShort || lineFromTripId(tripId);

    if (lineFilter && tripLine.toUpperCase() !== lineFilter) continue;

    const tripInfo = trips[tripId] || {};
    const trainNum = tripInfo.trip_short_name || trainNumberFromTripId(tripId);
    const headsign = tripInfo.trip_headsign || '';
    const dir = directionLabel(dirId !== undefined ? dirId : tripInfo.direction_id);

    for (const stu of tu.stopTimeUpdate || tu.stop_time_update || []) {
      const stopId = stu.stopId || stu.stop_id || '';
      if (!targetSet.has(stopId)) continue;

      let arrivalTime: Date | null = null;
      let delay = 0;
      if (stu.arrival?.time) {
        arrivalTime = toLocalDate(Number(stu.arrival.time), TZ);
        delay = stu.arrival.delay || 0;
      } else if (stu.departure?.time) {
        arrivalTime = toLocalDate(Number(stu.departure.time), TZ);
        delay = stu.departure.delay || 0;
      }
      if (!arrivalTime) continue;

      const minsAway = (arrivalTime.getTime() - now.getTime()) / 60000;
      if (minsAway < -2) continue;

      const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[tripLine] ||
        (METRA_LINES as Record<string, MetraLineInfo>)[tripLine.toUpperCase()];

      arrivals.push({
        line: tripLine,
        lineName: lineMeta?.name || tripLine,
        trainNum,
        headsign,
        direction: dir,
        arrival: fmtTimeHM(arrivalTime),
        minsAway: Math.round(minsAway),
        delayMins: delay ? Math.round(delay / 60) : 0,
        terminal: lineMeta?.terminal || '',
      });
    }
  }

  // Apply headsign filter if provided
  const headsignFilter = opts.headsign ? opts.headsign.toLowerCase() : null;
  let filteredArrivals = arrivals;
  if (headsignFilter && arrivals.length > 0) {
    filteredArrivals = arrivals.filter(a =>
      a.headsign.toLowerCase().includes(headsignFilter)
    );
    if (filteredArrivals.length === 0) {
      const availableHeadsigns = [...new Set(arrivals.map(a => a.headsign).filter(Boolean))];
      if (opts.json) {
        console.log(JSON.stringify({
          station: stationLabel,
          error: `No arrivals matching headsign '${opts.headsign}'`,
          availableHeadsigns,
          totalArrivals: arrivals.length,
        }, null, 2));
      } else {
        console.log(`No arrivals matching headsign '${opts.headsign}'.`);
        console.log(`Available headsigns: ${availableHeadsigns.length ? availableHeadsigns.join(', ') : '(none)'}`);
      }
      return;
    }
  }

  if (!filteredArrivals.length) {
    if (opts.json) {
      console.log(JSON.stringify({ station: stationLabel, arrivals: [], source: 'scheduled' }, null, 2));
    } else {
      console.log('No real-time arrivals found.');
      console.log('Falling back to scheduled times...\n');
    }
    if (!opts.json) showScheduledArrivals(stopIds, lineFilter);
    return;
  }

  filteredArrivals.sort((a, b) => a.minsAway - b.minsAway);

  if (opts.json) {
    console.log(JSON.stringify({
      station: stationLabel,
      line: lineFilter || null,
      arrivals: filteredArrivals.slice(0, 20),
      source: 'realtime',
    }, null, 2));
    return;
  }

  for (const a of filteredArrivals.slice(0, 20)) {
    const eta = a.minsAway <= 0 ? 'Due' : a.minsAway === 1 ? '1 min' : `${a.minsAway} min`;
    const delayStr = a.delayMins > 0 ? ` (+${a.delayMins}m late)` : '';
    const dirStr = a.direction ? ` ${a.direction}` : '';
    const hsStr = a.headsign ? ` -> ${a.headsign}` : '';

    console.log(`  \u{1F686} ${a.lineName} Train ${a.trainNum}${dirStr}${hsStr}`);
    console.log(`     ${a.arrival} (${eta})${delayStr}`);
    console.log();
  }
}

function showScheduledArrivals(stopIds: string[], lineFilter: string | null): void {
  if (!metraEnsureGtfs()) return;

  const routes = metraLoadRoutes();
  const trips = metraLoadTrips();
  const now = localNow(TZ);
  const yyyy = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}${mo}${dd}`;
  const activeServices = metraGetActiveServiceIds(todayStr);

  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const currentTime = `${hh}:${mm}:${ss}`;

  const upcoming: ScheduledDeparture[] = [];
  const seen = new Set<string>();

  for (const stopId of stopIds) {
    const stopTimes = loadStopTimesForStop(stopId);
    for (const st of stopTimes) {
      const tripInfo = trips[st.trip_id] || {};
      const routeId = tripInfo.route_id || '';
      const serviceId = tripInfo.service_id || '';
      if (!activeServices.has(serviceId)) continue;

      const rShort = routes[routeId]?.route_short_name || routeId;
      if (lineFilter && rShort.toUpperCase() !== lineFilter) continue;

      const depTime = st.departure_time || st.arrival_time || '';
      if (depTime <= currentTime) continue;

      const trainNum = tripInfo.trip_short_name || trainNumberFromTripId(st.trip_id);
      const headsign = tripInfo.trip_headsign || '';
      const dir = directionLabel(tripInfo.direction_id);
      const dedup = `${rShort}|${depTime}|${trainNum}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[rShort] ||
        (METRA_LINES as Record<string, MetraLineInfo>)[rShort.toUpperCase()];

      upcoming.push({
        line: rShort,
        lineName: lineMeta?.name || rShort,
        trainNum,
        headsign,
        direction: dir,
        time: depTime,
      });
    }
  }

  upcoming.sort((a, b) => a.time.localeCompare(b.time));

  if (!upcoming.length) {
    console.log('No upcoming scheduled departures found for today.');
    return;
  }

  console.log('Scheduled departures (no real-time data available):');
  for (const u of upcoming.slice(0, 15)) {
    const dirStr = u.direction ? ` ${u.direction}` : '';
    const hsStr = u.headsign ? ` -> ${u.headsign}` : '';
    console.log(`  \u{1F686} ${u.lineName} Train ${u.trainNum}${dirStr}${hsStr}`);
    console.log(`     ${fmtGtfsTime(u.time)} (scheduled)`);
    console.log();
  }
}

// ---- Vehicles ----

async function cmdVehicles(opts: CliOptions): Promise<void> {
  if (!requireApiKey()) return;

  const lineFilter = opts.line ? resolveLineCode(opts.line) : null;
  if (!lineFilter) {
    console.log('Provide --line with a Metra line code.');
    console.log('Valid lines: ' + Object.keys(METRA_LINES).join(', '));
    return;
  }

  const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[lineFilter];
  if (!lineMeta) {
    console.log(`Unknown Metra line: ${opts.line}`);
    console.log('Valid lines: ' + Object.keys(METRA_LINES).join(', '));
    return;
  }

  console.log(`\nFetching ${lineMeta.name} vehicle positions...`);

  const feed = await parsePb(FEEDS.vehicle_positions);
  const stops = metraEnsureGtfs() ? metraLoadStops() : {};
  const routes = metraEnsureGtfs() ? metraLoadRoutes() : {};
  const trips = metraEnsureGtfs() ? metraLoadTrips() : {};
  const vehicles: VehicleEntry[] = [];

  for (const entity of feed.entity || []) {
    const v = entity.vehicle;
    if (!v) continue;

    const tripId = v.trip?.tripId || v.trip?.trip_id || '';
    const routeId = v.trip?.routeId || v.trip?.route_id || '';
    const rShort = routes[routeId]?.route_short_name || routeId;
    const tripLine = rShort || lineFromTripId(tripId);

    if (tripLine.toUpperCase() !== lineFilter) continue;

    const pos = v.position || {};
    const stopId = v.stopId || v.stop_id || '';
    const status = v.currentStatus ?? v.current_status ?? 0;
    const ts = v.timestamp;
    const dirId = v.trip?.directionId ?? v.trip?.direction_id;

    const tripInfo = trips[tripId] || {};
    const trainNum = tripInfo.trip_short_name || trainNumberFromTripId(tripId);
    const headsign = tripInfo.trip_headsign || '';
    const dir = directionLabel(dirId !== undefined ? dirId : tripInfo.direction_id);
    const stopName = stops[stopId]?.stop_name || stopId;
    const statusLabels: Record<number, string> = { 0: 'Approaching', 1: 'Stopped at', 2: 'In transit to' };
    const statusStr = statusLabels[status] || 'En route to';

    let timeStr = '';
    if (ts) {
      try { timeStr = fmtTime(toLocalDate(Number(ts), TZ)); } catch { timeStr = String(ts); }
    }

    vehicles.push({
      trainNum,
      headsign,
      direction: dir,
      stopName,
      status: statusStr,
      lat: pos.latitude,
      lon: pos.longitude,
      bearing: pos.bearing,
      speed: pos.speed,
      time: timeStr,
    });
  }

  if (!vehicles.length) {
    if (opts.json) {
      console.log(JSON.stringify({ line: lineFilter, lineName: lineMeta.name, vehicles: [] }, null, 2));
    } else {
      console.log(`No active trains found on ${lineMeta.name}.`);
      console.log('Trains may be underground or at terminals (GPS loss), or service may not be running.');
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify({ line: lineFilter, lineName: lineMeta.name, vehicles }, null, 2));
    return;
  }

  console.log(`\n\u{1F686} === ${lineMeta.name} Positions (${vehicles.length} active) ===\n`);

  for (const v of vehicles) {
    const dirStr = v.direction ? ` \u2014 ${v.direction}` : '';
    const hsStr = v.headsign ? ` -> ${v.headsign}` : '';

    console.log(`  \u{1F686} Train ${v.trainNum}${dirStr}${hsStr}`);
    console.log(`     ${v.status} ${v.stopName}`);
    if (v.lat && v.lon) {
      let posStr = `     Position: (${Number(v.lat).toFixed(5)}, ${Number(v.lon).toFixed(5)})`;
      if (v.bearing) posStr += ` bearing ${v.bearing}\u00B0`;
      if (v.speed) posStr += ` @ ${(v.speed * 2.237).toFixed(0)} mph`;
      console.log(posStr);
    }
    if (v.time) console.log(`     Last update: ${v.time}`);
    console.log();
  }
}

// ---- Alerts ----

async function cmdAlerts(opts: CliOptions): Promise<void> {
  if (!requireApiKey()) return;

  const lineFilter = opts.line ? resolveLineCode(opts.line) : null;

  const feed = await parsePb(FEEDS.alerts);
  const routes = metraEnsureGtfs() ? metraLoadRoutes() : {};

  if (!feed.entity || feed.entity.length === 0) {
    const filterMsg = lineFilter ? ` for ${(METRA_LINES as Record<string, MetraLineInfo>)[lineFilter]?.name || lineFilter}` : '';
    console.log(`No active service alerts${filterMsg}.`);
    return;
  }

  let entities = feed.entity as any[];
  if (lineFilter) {
    entities = entities.filter((e: any) => {
      const alert = e.alert;
      if (!alert?.informedEntity && !alert?.informed_entity) return false;
      return (alert.informedEntity || alert.informed_entity || []).some((ie: any) => {
        const rid = ie.routeId || ie.route_id || '';
        const rShort = routes[rid]?.route_short_name || rid;
        return rShort.toUpperCase() === lineFilter || rid.toUpperCase() === lineFilter;
      });
    });
  }

  if (!entities.length) {
    const filterMsg = lineFilter ? ` for ${(METRA_LINES as Record<string, MetraLineInfo>)[lineFilter]?.name || lineFilter}` : '';
    if (opts.json) {
      console.log(JSON.stringify({ alerts: [], line: lineFilter || null }, null, 2));
    } else {
      console.log(`No active alerts${filterMsg}.`);
    }
    return;
  }

  // Collect alert data
  const alertData: AlertEntry[] = [];
  for (const entity of entities) {
    const alert = entity.alert;
    if (!alert) continue;

    let header = '';
    const headerText = alert.headerText || alert.header_text;
    if (headerText?.translation?.length)
      header = headerText.translation[0].text;
    let desc = '';
    const descText = alert.descriptionText || alert.description_text;
    if (descText?.translation?.length)
      desc = descText.translation[0].text;

    const affected: string[] = [];
    const informedEntity = alert.informedEntity || alert.informed_entity;
    if (informedEntity) {
      for (const ie of informedEntity) {
        const rid = ie.routeId || ie.route_id || '';
        if (rid) {
          const rShort = routes[rid]?.route_short_name || rid;
          if (!affected.includes(rShort)) affected.push(rShort);
        }
      }
    }

    const periods: string[] = [];
    const activePeriod = alert.activePeriod || alert.active_period;
    if (activePeriod) {
      for (const ap of activePeriod) {
        const start = ap.start ? fmtDateTimeShort(toLocalDate(Number(ap.start), TZ)) : '?';
        const end = ap.end ? fmtDateTimeShort(toLocalDate(Number(ap.end), TZ)) : 'ongoing';
        periods.push(`${start} - ${end}`);
      }
    }

    alertData.push({ header, description: desc, affectedLines: affected, periods, effect: alert.effect || 0 });
  }

  if (opts.json) {
    console.log(JSON.stringify({ alerts: alertData, line: lineFilter || null }, null, 2));
    return;
  }

  console.log(`\n\u26A0\uFE0F === Metra Service Alerts (${entities.length} active) ===\n`);

  for (const a of alertData) {
    const effect = a.effect;
    let icon = '';
    if (effect === 1) icon = '  '; // NO_SERVICE
    else if (effect === 2 || effect === 3) icon = '  '; // REDUCED/DELAYS
    else icon = '  ';

    console.log(`${icon} ${a.header || '(No headline)'}`);
    if (a.affectedLines.length) console.log(`   Lines: ${a.affectedLines.join(', ')}`);
    if (a.periods.length) console.log(`   Period: ${a.periods[0]}${a.periods.length > 1 ? ` (+${a.periods.length - 1} more)` : ''}`);
    let desc = a.description;
    if (desc) {
      if (desc.length > 400) desc = desc.slice(0, 400) + '...';
      console.log(`   ${desc}`);
    }
    console.log();
  }
}

// ---- Routes ----

function cmdRoutes(opts: CliOptions): void {
  if (opts?.json) {
    const lines = Object.entries(METRA_LINES).map(([code, line]) => ({ code, ...line }));
    console.log(JSON.stringify({ lines }, null, 2));
    return;
  }
  console.log('\n\u{1F686} === Metra Commuter Rail Lines (11 lines) ===\n');
  for (const [code, line] of Object.entries(METRA_LINES)) {
    console.log(`  ${code.padEnd(6)} | ${line.name.padEnd(28)} | ${line.color}`);
    console.log(`  ${''.padEnd(6)} | ${line.terminal.padEnd(28)} | -> ${line.outer}`);
  }
}

// ---- Stops ----

function cmdStops(opts: CliOptions): void {
  if (opts.search) {
    const query = opts.search;
    const results = searchStation(query, null);
    if (!results.length) {
      console.log(`No stations found matching '${query}'.`);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify({ query, stops: results.slice(0, 25).map(s => ({ name: s.name, lines: s.lines, zone_id: s.zone_id || null, stop_id: s.stop_id || null })) }, null, 2));
      return;
    }
    console.log(`\n\u{1F686} === Stations matching '${query}' (${results.length} found) ===\n`);
    for (const s of results.slice(0, 25)) {
      const lineStr = s.lines?.length ? ` (${s.lines.join(', ')})` : '';
      const zoneStr = s.zone_id ? ` [Zone ${s.zone_id}]` : '';
      console.log(`  \u{1F4CD} ${s.name}${lineStr}${zoneStr}`);
      if (s.stop_id) console.log(`     ID: ${s.stop_id}`);
      console.log();
    }
  } else if (opts.line) {
    const lineCode = resolveLineCode(opts.line);
    if (!lineCode || !(METRA_LINES as Record<string, MetraLineInfo>)[lineCode]) {
      console.log(`Unknown line: ${opts.line}`);
      console.log('Valid lines: ' + Object.keys(METRA_LINES).join(', '));
      return;
    }
    if (!metraEnsureGtfs()) return;

    const routes = metraLoadRoutes();
    const trips = metraLoadTrips();
    const stops = metraLoadStops();
    const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[lineCode];

    console.log(`\n\u{1F686} === Stops on ${lineMeta.name} (${lineCode}) ===`);
    console.log(`    ${lineMeta.terminal} -> ${lineMeta.outer}\n`);

    // Find a trip for this route to get stop sequence
    const routeTrips = Object.values(trips).filter(t => {
      const rShort = routes[t.route_id]?.route_short_name || t.route_id || '';
      return rShort.toUpperCase() === lineCode || t.route_id.toUpperCase() === lineCode;
    });

    if (!routeTrips.length) {
      console.log('No trip data found. Try running refresh-gtfs.');
      return;
    }

    // Metra: direction_id 1 = inbound (toward downtown)
    const dir0 = routeTrips.filter(t => t.direction_id === '1');
    // Pick the trip with the most stops for completeness
    let bestTrip: Record<string, string> | null = null;
    let bestCount = 0;
    for (const t of (dir0.length ? dir0 : routeTrips)) {
      const st = loadStopTimesForTrip(t.trip_id);
      if (st.length > bestCount) {
        bestTrip = t;
        bestCount = st.length;
      }
    }

    if (!bestTrip) {
      console.log('No stop sequence found.');
      return;
    }

    const stopTimes = loadStopTimesForTrip(bestTrip.trip_id);
    for (const st of stopTimes) {
      const s = stops[st.stop_id];
      const sname = s?.stop_name || st.stop_id;
      const zone = s?.zone_id ? ` [Zone ${s.zone_id}]` : '';
      console.log(`  ${(st.stop_sequence || '').padStart(3)}. ${sname}${zone}`);
    }
  } else if (opts.near) {
    if (!metraEnsureGtfs()) return;
    const parts = opts.near.split(',');
    if (parts.length !== 2) { console.log('Invalid format. Use: --near LAT,LON'); return; }
    const [lat, lon] = parts.map(Number);
    if (isNaN(lat) || isNaN(lon)) { console.log('Invalid format. Use: --near LAT,LON'); return; }
    const radius = opts.radius ? parseFloat(opts.radius) : 1.0;

    const stops = metraLoadStops();
    const nearby: [number, Record<string, string>][] = [];
    for (const s of Object.values(stops)) {
      const slat = parseFloat(s.stop_lat);
      const slon = parseFloat(s.stop_lon);
      if (isNaN(slat) || isNaN(slon)) continue;
      const dist = haversine(lat, lon, slat, slon);
      if (dist <= radius) nearby.push([dist, s]);
    }
    nearby.sort((a, b) => a[0] - b[0]);

    if (!nearby.length) {
      if (opts.json) console.log(JSON.stringify({ lat, lon, radius, stops: [] }, null, 2));
      else console.log(`No Metra stations found within ${radius} miles of (${lat}, ${lon}).`);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify({ lat, lon, radius, stops: nearby.slice(0, 20).map(([dist, s]) => ({ name: s.stop_name, stop_id: s.stop_id, distance_mi: parseFloat(dist.toFixed(2)), zone_id: s.zone_id || null })) }, null, 2));
      return;
    }
    console.log(`\n\u{1F686} === Nearby Metra Stations (${nearby.length} within ${radius} mi) ===\n`);
    for (const [dist, s] of nearby.slice(0, 20)) {
      const zone = s.zone_id ? ` [Zone ${s.zone_id}]` : '';
      console.log(`  \u{1F4CD} ${s.stop_name} \u2014 ${dist.toFixed(2)} mi${zone}`);
      console.log(`     ID: ${s.stop_id}`);
      console.log();
    }
  } else {
    console.log('Provide --search <name>, --line <code>, or --near LAT,LON');
  }
}

// ---- Route Info ----

function cmdRouteInfo(opts: CliOptions): void {
  const lineCode = opts.line ? resolveLineCode(opts.line) : null;
  if (!lineCode) {
    console.log('Provide --line with a Metra line code.');
    console.log('Valid lines: ' + Object.keys(METRA_LINES).join(', '));
    return;
  }

  const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[lineCode];
  if (!lineMeta) {
    console.log(`Unknown line: ${opts.line}`);
    console.log('Valid lines: ' + Object.keys(METRA_LINES).join(', '));
    return;
  }

  console.log(`\n\u{1F686} === ${lineMeta.name} (${lineCode}) ===`);
  console.log(`    Color: ${lineMeta.color}`);
  console.log(`    Downtown Terminal: ${lineMeta.terminal}`);
  console.log(`    Outer Terminal: ${lineMeta.outer}`);
  console.log();

  if (!metraEnsureGtfs()) return;

  const routes = metraLoadRoutes();
  const trips = metraLoadTrips();
  const stops = metraLoadStops();

  // Find route in GTFS
  const routeId = Object.keys(routes).find(k => {
    const rShort = routes[k].route_short_name || '';
    return rShort.toUpperCase() === lineCode || k.toUpperCase() === lineCode;
  });

  if (!routeId) {
    console.log('No GTFS route data found. Try running refresh-gtfs.');
    return;
  }

  const r = routes[routeId];
  if (r.route_long_name) console.log(`    Full Name: ${r.route_long_name}`);

  // Show stops for both directions
  const routeTrips = Object.values(trips).filter(t => t.route_id === routeId);
  if (!routeTrips.length) {
    console.log('\nNo trip data found.');
    return;
  }

  // Metra: direction_id 1 = inbound, 0 = outbound
  for (const dirId of ['1', '0']) {
    const dirTrips = routeTrips.filter(t => t.direction_id === dirId);
    if (!dirTrips.length) continue;

    // Pick trip with most stops
    let bestTrip: Record<string, string> | null = null;
    let bestCount = 0;
    for (const t of dirTrips) {
      const st = loadStopTimesForTrip(t.trip_id);
      if (st.length > bestCount) {
        bestTrip = t;
        bestCount = st.length;
      }
    }

    if (!bestTrip || bestCount === 0) continue;

    const dirLabel = dirId === '1' ? 'Inbound' : 'Outbound';
    const headsign = bestTrip.trip_headsign || dirLabel;
    console.log(`\n${dirLabel} Stops (${headsign}) \u2014 ${bestCount} stops:`);

    const stopTimes = loadStopTimesForTrip(bestTrip.trip_id);
    for (const st of stopTimes) {
      const s = stops[st.stop_id];
      const sname = s?.stop_name || st.stop_id;
      const zone = s?.zone_id ? ` [Zone ${s.zone_id}]` : '';
      console.log(`  ${(st.stop_sequence || '').padStart(3)}. ${sname}${zone}`);
    }
  }
}

// ---- Fares ----

function cmdFares(opts: CliOptions): void {
  const fromStation = opts.from;
  const toStation = opts.to;

  if (fromStation && toStation) {
    // Calculate fare between two stations
    if (!metraEnsureGtfs()) return;
    const stops = metraLoadStops();

    // Find from station
    const fromMatches = searchStation(fromStation, null);
    if (!fromMatches.length) {
      console.log(`No station found matching '${fromStation}'.`);
      return;
    }
    const toMatches = searchStation(toStation, null);
    if (!toMatches.length) {
      console.log(`No station found matching '${toStation}'.`);
      return;
    }

    const fromName = fromMatches[0].name;
    const toName = toMatches[0].name;

    // Get zone IDs
    const fromStopIds = resolveStopIds(fromName, null);
    const toStopIds = resolveStopIds(toName, null);

    let fromZoneId: string | null = null;
    let toZoneId: string | null = null;
    for (const sid of fromStopIds) {
      if (stops[sid]?.zone_id) { fromZoneId = stops[sid].zone_id; break; }
    }
    for (const sid of toStopIds) {
      if (stops[sid]?.zone_id) { toZoneId = stops[sid].zone_id; break; }
    }

    if (!fromZoneId || !toZoneId) {
      console.log('Could not determine fare zones for these stations.');
      console.log('Zone data may not be available in GTFS. Showing general fare table instead.\n');
      showFareTable();
      return;
    }

    const fromFareZone = zoneIdToFareZone(fromZoneId);
    const toFareZone = zoneIdToFareZone(toZoneId);

    if (!fromFareZone || !toFareZone) {
      console.log(`Unknown zone IDs: ${fromZoneId}, ${toZoneId}`);
      console.log('Showing general fare table instead.\n');
      showFareTable();
      return;
    }

    const fareKey = getFareKey(fromFareZone, toFareZone);
    const fares = FARE_TABLE[fareKey];

    if (!fares) {
      console.log('Could not determine fare for this zone pair.');
      showFareTable();
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({
        from: { station: fromName, zone: fromFareZone, zoneId: fromZoneId },
        to: { station: toName, zone: toFareZone, zoneId: toZoneId },
        fareCategory: fareKey,
        fares: { ...fares, onboardSurcharge: 5.00, weekendDayPass: 7.00 },
      }, null, 2));
      return;
    }
    console.log(`\n\u{1F4B0} === Fare: ${fromName} -> ${toName} ===`);
    console.log(`    Zone ${fromFareZone} (${fromZoneId}) -> Zone ${toFareZone} (${toZoneId})`);
    console.log(`    Fare Category: Zones ${fareKey}\n`);
    console.log(`    One-Way:        $${fares.oneWay.toFixed(2)}`);
    console.log(`    Day Pass:       $${fares.dayPass.toFixed(2)}`);
    console.log(`    Day Pass 5-Pk:  $${fares.dayPass5.toFixed(2)}`);
    console.log(`    Monthly Pass:   $${fares.monthly.toFixed(2)}`);
    console.log();
    console.log('    Onboard Surcharge (cash): $5.00 additional');
    console.log('    Weekend Day Pass: $7.00 (systemwide)');
  } else {
    if (opts.json) {
      console.log(JSON.stringify({ fareTable: FARE_TABLE, weekendDayPass: 7.00, onboardSurcharge: 5.00 }, null, 2));
      return;
    }
    showFareTable();
  }
}

function showFareTable(): void {
  console.log(`\n\u{1F4B0} === Metra Fares (4-Zone System, effective Feb 2024) ===\n`);
  console.log('  Ticket Type        | Zones 1-2 | Zones 1-3 | Zones 1-4 | Zones 2-4');
  console.log('  -------------------|-----------|-----------|-----------|----------');
  console.log('  One-Way            |   $3.75   |   $5.50   |   $6.75   |   $3.75');
  console.log('  Day Pass           |   $7.50   |  $11.00   |  $13.50   |   $7.50');
  console.log('  Day Pass 5-Pack    |  $35.75   |  $52.25   |  $64.25   |  $35.75');
  console.log('  Monthly Pass       |  $75.00   | $110.00   | $135.00   |  $75.00');
  console.log();
  console.log('  Special Passes:');
  console.log('    Sat/Sun/Holiday Day Pass:  $7.00 (systemwide)');
  console.log('    Weekend Pass (Ventra app): $10.00 (systemwide)');
  console.log('    Regional Connect (w/ Mo.): $30.00 (adds CTA + Pace)');
  console.log('    Onboard Surcharge (cash):  $5.00');
  console.log();
  console.log('  Monthly Passes: unlimited weekday rides between zones, systemwide on weekends.');
  console.log('  Reduced fares (seniors, students, military): approximately half price.');
}

// ---- Schedule ----

function cmdSchedule(opts: CliOptions): void {
  const stationName = opts.station;
  const lineFilter = opts.line ? resolveLineCode(opts.line) : null;

  if (!stationName) {
    console.log('Provide --station with a station name.');
    return;
  }

  if (!metraEnsureGtfs()) return;

  const matches = searchStation(stationName, lineFilter);
  if (!matches.length) {
    console.log(`No stations found matching '${stationName}'.`);
    return;
  }

  if (matches.length > 1 && matches[0].score > 0) {
    console.log(`Found ${matches.length} stations matching '${stationName}':`);
    for (const s of matches.slice(0, 8)) {
      const lineStr = s.lines?.length ? ` (${s.lines.join(', ')})` : '';
      console.log(`  ${s.name}${lineStr}`);
    }
    console.log(`\nUsing best match: ${matches[0].name}\n`);
  }

  const station = matches[0];
  const stopIds = resolveStopIds(station.name, lineFilter);

  if (!stopIds.length) {
    console.log(`Could not resolve stop IDs for '${station.name}'.`);
    return;
  }

  const routes = metraLoadRoutes();
  const trips = metraLoadTrips();
  const now = localNow(TZ);
  const yyyy = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}${mo}${dd}`;
  const activeServices = metraGetActiveServiceIds(todayStr);

  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}:00`;

  // Gather departures
  const inbound: ScheduleEntry[] = [];
  const outbound: ScheduleEntry[] = [];
  const seen = new Set<string>();

  for (const stopId of stopIds) {
    const stopTimes = loadStopTimesForStop(stopId);
    for (const st of stopTimes) {
      const tripInfo = trips[st.trip_id] || {};
      const routeId = tripInfo.route_id || '';
      const serviceId = tripInfo.service_id || '';
      if (!activeServices.has(serviceId)) continue;

      const rShort = routes[routeId]?.route_short_name || routeId;
      if (lineFilter && rShort.toUpperCase() !== lineFilter) continue;

      const depTime = st.departure_time || st.arrival_time || '';
      if (depTime <= currentTime) continue;

      const trainNum = tripInfo.trip_short_name || trainNumberFromTripId(st.trip_id);
      const headsign = tripInfo.trip_headsign || '';
      const dir = tripInfo.direction_id;
      const dedup = `${rShort}|${trainNum}|${depTime}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      const lineMeta = (METRA_LINES as Record<string, MetraLineInfo>)[rShort] ||
        (METRA_LINES as Record<string, MetraLineInfo>)[rShort.toUpperCase()];

      const entry: ScheduleEntry = {
        line: rShort,
        lineName: lineMeta?.name || rShort,
        trainNum,
        headsign,
        time: depTime,
      };

      // Metra: direction_id 1 = inbound, 0 = outbound
      if (dir === '1') inbound.push(entry);
      else outbound.push(entry);
    }
  }

  // Apply headsign filter if provided
  const headsignFilter = opts.headsign ? opts.headsign.toLowerCase() : null;
  if (headsignFilter) {
    const filterFn = (e: ScheduleEntry) => e.headsign.toLowerCase().includes(headsignFilter);
    const allEntries = [...inbound, ...outbound];
    const filteredIn = inbound.filter(filterFn);
    const filteredOut = outbound.filter(filterFn);
    if (filteredIn.length === 0 && filteredOut.length === 0 && allEntries.length > 0) {
      const availableHeadsigns = [...new Set(allEntries.map(e => e.headsign).filter(Boolean))];
      if (opts.json) {
        console.log(JSON.stringify({ station: station.name, error: `No departures matching headsign '${opts.headsign}'`, availableHeadsigns }, null, 2));
      } else {
        console.log(`No departures matching headsign '${opts.headsign}'.`);
        console.log(`Available headsigns: ${availableHeadsigns.length ? availableHeadsigns.join(', ') : '(none)'}`);
      }
      return;
    }
    inbound.length = 0; inbound.push(...filteredIn);
    outbound.length = 0; outbound.push(...filteredOut);
  }

  inbound.sort((a, b) => a.time.localeCompare(b.time));
  outbound.sort((a, b) => a.time.localeCompare(b.time));

  const lineName = lineFilter && (METRA_LINES as Record<string, MetraLineInfo>)[lineFilter]
    ? (METRA_LINES as Record<string, MetraLineInfo>)[lineFilter].name
    : null;
  const dayLabel = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()];

  if (opts.json) {
    console.log(JSON.stringify({
      station: station.name,
      date: `${yyyy}-${mo}-${dd}`,
      day: dayLabel,
      line: lineFilter || null,
      inbound: inbound.slice(0, 20).map(e => ({ ...e, timeFormatted: fmtGtfsTime(e.time) })),
      outbound: outbound.slice(0, 20).map(e => ({ ...e, timeFormatted: fmtGtfsTime(e.time) })),
    }, null, 2));
    return;
  }

  console.log(`\n\u{1F686} === Schedule for: ${station.name} ===`);
  console.log(`    ${dayLabel}, ${mo}/${dd}/${yyyy}`);
  if (lineName) console.log(`    Line: ${lineName}`);
  console.log();

  if (inbound.length) {
    console.log(`Inbound (toward downtown Chicago) \u2014 ${inbound.length} remaining today:`);
    for (const e of inbound.slice(0, 20)) {
      const hsStr = e.headsign ? ` -> ${e.headsign}` : '';
      console.log(`  \u{1F686} ${fmtGtfsTime(e.time)}  ${e.lineName} Train ${e.trainNum}${hsStr}`);
    }
    console.log();
  }

  if (outbound.length) {
    console.log(`Outbound (away from downtown) \u2014 ${outbound.length} remaining today:`);
    for (const e of outbound.slice(0, 20)) {
      const hsStr = e.headsign ? ` -> ${e.headsign}` : '';
      console.log(`  \u{1F686} ${fmtGtfsTime(e.time)}  ${e.lineName} Train ${e.trainNum}${hsStr}`);
    }
    console.log();
  }

  if (!inbound.length && !outbound.length) {
    console.log('No remaining departures found for today.');
    console.log('This station may not have service on the current schedule.');
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`\u{1F686} Chicago Metra Commuter Rail \u2014 OpenClaw Skill

Commands:
  arrivals      Train arrivals (--station NAME) [--line CODE] [--headsign TEXT]
  vehicles      Live train positions (--line CODE)
  alerts        Service alerts [--line CODE]
  routes        List all 11 Metra lines
  stops         Search stops (--search NAME | --line CODE | --near LAT,LON [--radius MI])
  route-info    Line details and stops (--line CODE)
  fares         Fare table, or calculate (--from STATION --to STATION)
  schedule      Today's schedule (--station NAME) [--line CODE] [--headsign TEXT]
  refresh-gtfs  Download/refresh GTFS static data

Global Options:
  --json        Output structured JSON instead of formatted text

Metra Lines: BNSF, ME, HC, MD-N, MD-W, NCS, RI, SWS, UP-N, UP-NW, UP-W

Environment: METRA_API_KEY (free, required for all real-time data)
Get a key at: https://metra.com/developers`);
    return;
  }

  const rest = args.slice(1);

  const optDefs: Record<string, { type: 'string' | 'boolean' }> = {
    station: { type: 'string' },
    line: { type: 'string' },
    search: { type: 'string' },
    near: { type: 'string' },
    radius: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    headsign: { type: 'string' },
    json: { type: 'boolean' },
  };

  let opts: CliOptions = {};
  try {
    const parsed = parseArgs({ args: rest, options: optDefs, allowPositionals: true, strict: false });
    opts = parsed.values as unknown as CliOptions;
  } catch (err: any) {
    console.error(`Error parsing arguments: ${err.message}`);
    process.exit(1);
  }

  const handlers: Record<string, () => void | Promise<void>> = {
    'refresh-gtfs': () => cmdRefreshGtfs(),
    arrivals: () => cmdArrivals(opts),
    vehicles: () => cmdVehicles(opts),
    alerts: () => cmdAlerts(opts),
    routes: () => cmdRoutes(opts),
    stops: () => cmdStops(opts),
    'route-info': () => cmdRouteInfo(opts),
    fares: () => cmdFares(opts),
    schedule: () => cmdSchedule(opts),
  };

  if (handlers[command]) {
    Promise.resolve(handlers[command]()).catch((err: any) => {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        console.error('Request timed out. Metra feed may be slow or unreachable. Try again in a moment.');
      } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        console.error('Network error: Could not reach Metra API. Check your internet connection.');
      } else if (err.message?.includes('Authentication failed')) {
        console.error(err.message);
        console.error('Get a free key at: https://metra.com/developers');
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'node scripts/metra.mjs --help' for available commands.");
    process.exit(1);
  }
}

main();
