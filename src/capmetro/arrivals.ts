#!/usr/bin/env node
/**
 * CapMetro Austin Transit — CLI entry point
 * Real-time vehicle positions, arrivals, alerts, and route info.
 * All data from Texas Open Data Portal (no API key required).
 *
 * SECURITY MANIFEST
 *   Environment variables: None
 *   External endpoints:    data.texas.gov (read-only GET, open access, no auth)
 *   Local files written:   ~/.capmetro/gtfs/ (GTFS static data cache)
 *   Local files read:      ~/.capmetro/gtfs/*.txt (GTFS CSV files)
 *   User input handling:   Used for local filtering only, never interpolated into
 *                          URLs or shell commands
 */

import { parseArgs } from 'node:util';
import { ensureGtfs } from '../shared/csv.js';
import {
  toLocalDate,
  localNow,
  fmtTime,
  fmtTimeHM,
  fmtDateTimeShort,
} from '../shared/time.js';
import { haversine } from '../shared/geo.js';
import { parsePb } from '../shared/proto.js';
import { loadStops, loadRoutes, loadTrips, refreshGtfs } from '../shared/gtfs.js';
import {
  FEEDS,
  GTFS_DIR,
  TZ,
  getRouteEmoji,
  loadStopTimesForStop,
  loadStopTimesForTrip,
  getActiveServiceIdsForDate,
} from './client.js';
import type {
  CliOptions,
  PbFeedMessage,
  PbFeedEntity,
  VehicleEntry,
  RtArrivalEntry,
  ScheduledArrivalEntry,
} from './types.js';

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function cmdRefreshGtfs(): Promise<void> {
  await refreshGtfs(FEEDS.gtfs_static, GTFS_DIR);
}

export async function cmdAlerts(opts: CliOptions): Promise<void> {
  const jsonOutput = opts?.json;
  const feed: PbFeedMessage = await parsePb(FEEDS.service_alerts_pb);
  const routes = ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')
    ? loadRoutes(GTFS_DIR)
    : {};

  if (!feed.entity || feed.entity.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ alerts: [] }));
      return;
    }
    console.log('No active service alerts.');
    return;
  }

  const alerts: {
    header: string;
    description: string;
    routes: string[];
    periods: string[];
  }[] = [];

  for (const entity of feed.entity) {
    const alert = entity.alert;
    if (!alert) continue;

    let header = '';
    if (alert.headerText?.translation?.length) {
      header = alert.headerText.translation[0].text;
    } else if (alert.header_text?.translation?.length) {
      header = alert.header_text.translation[0].text;
    }

    let desc = '';
    if (alert.descriptionText?.translation?.length) {
      desc = alert.descriptionText.translation[0].text;
    } else if (alert.description_text?.translation?.length) {
      desc = alert.description_text.translation[0].text;
    }

    const affected: string[] = [];
    const informedEntity = alert.informedEntity || alert.informed_entity;
    if (informedEntity) {
      for (const ie of informedEntity) {
        const rid = ie.routeId || ie.route_id;
        if (rid) {
          const rname = routes[rid]?.route_short_name || rid;
          affected.push(rname);
        }
      }
    }

    const periods: string[] = [];
    const activePeriod = alert.activePeriod || alert.active_period;
    if (activePeriod) {
      for (const ap of activePeriod) {
        const start = ap.start
          ? fmtDateTimeShort(toLocalDate(Number(ap.start), TZ))
          : '?';
        const end = ap.end
          ? fmtDateTimeShort(toLocalDate(Number(ap.end), TZ))
          : 'ongoing';
        periods.push(`${start} - ${end}`);
      }
    }

    alerts.push({ header, description: desc, routes: affected, periods });
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ count: alerts.length, alerts }));
    return;
  }

  console.log(`=== CapMetro Service Alerts (${alerts.length} active) ===\n`);
  for (const a of alerts) {
    console.log(`\u{1F4E2} ${a.header}`);
    if (a.routes.length) console.log(`   Routes: ${a.routes.join(', ')}`);
    if (a.periods.length) console.log(`   Period: ${a.periods.join('; ')}`);
    if (a.description) {
      let desc = a.description;
      if (desc.length > 300) desc = desc.slice(0, 300) + '...';
      console.log(`   ${desc}`);
    }
    console.log();
  }
}

export async function cmdVehicles(opts: CliOptions): Promise<void> {
  const routeFilter = opts.route;
  const jsonOutput = opts.json;
  if (!jsonOutput) console.log('Fetching vehicle positions...');
  const resp = await fetch(FEEDS.vehicle_positions_json, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();

  const routes = ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')
    ? loadRoutes(GTFS_DIR)
    : {};
  const entities = data.entity || data;

  const vehicles: VehicleEntry[] = [];
  for (const entity of entities) {
    const v = entity.vehicle || entity;
    const trip = v.trip || {};
    const pos = v.position || {};
    const vid = v.vehicle?.id || '?';
    const rid: string = trip.routeId || trip.route_id || '';
    const lat = pos.latitude;
    const lon = pos.longitude;
    const ts = v.timestamp;

    if (routeFilter && rid !== routeFilter) continue;
    if (!rid) continue;

    const rname = routes[rid]?.route_short_name || rid;
    const rlong = routes[rid]?.route_long_name || '';
    const rtype = routes[rid]?.route_type || '3';

    let timeStr = '';
    if (ts) {
      try {
        timeStr = fmtTime(toLocalDate(parseInt(ts), TZ));
      } catch {
        timeStr = String(ts);
      }
    }

    vehicles.push({
      vid,
      route: rname,
      route_id: rid,
      route_name: rlong,
      route_type: rtype,
      lat,
      lon,
      time: timeStr,
    });
  }

  if (!vehicles.length) {
    const filterMsg = routeFilter ? ` on route ${routeFilter}` : '';
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          vehicles: [],
          message: `No active vehicles found${filterMsg}.`,
        }),
      );
      return;
    }
    console.log(`No active vehicles found${filterMsg}.`);
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify({ count: vehicles.length, vehicles }));
    return;
  }

  console.log(`\n=== Active CapMetro Vehicles (${vehicles.length}) ===\n`);
  const byRoute: Record<string, VehicleEntry[]> = {};
  for (const v of vehicles) (byRoute[v.route] ||= []).push(v);

  for (const route of Object.keys(byRoute).sort((a, b) =>
    a.padStart(5, '0').localeCompare(b.padStart(5, '0')),
  )) {
    const vlist = byRoute[route];
    const emoji = getRouteEmoji(vlist[0].route_id, vlist[0].route_type);
    console.log(
      `Route ${route} \u2014 ${vlist[0].route_name} (${vlist.length} vehicles)`,
    );
    for (const v of vlist) {
      console.log(
        `  ${emoji} Vehicle ${v.vid}: (${Number(v.lat).toFixed(5)}, ${Number(v.lon).toFixed(5)}) @ ${v.time}`,
      );
    }
    console.log();
  }
}

export async function cmdArrivals(opts: CliOptions): Promise<void> {
  let stopId = opts.stop;
  const stopSearch = opts['stop-search'];
  const routeFilter = opts.route;
  const headsignFilter = opts.headsign?.toLowerCase();
  const jsonOutput = opts.json;

  if (!ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')) return;
  const stops = loadStops(GTFS_DIR);
  const routes = loadRoutes(GTFS_DIR);
  const trips = loadTrips(GTFS_DIR);

  if (stopSearch) {
    const query = stopSearch.toLowerCase();
    const matches = Object.values(stops).filter((s) =>
      (s.stop_name || '').toLowerCase().includes(query),
    );
    if (!matches.length) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ error: `No stops found matching '${stopSearch}'.` }),
        );
        return;
      }
      console.log(`No stops found matching '${stopSearch}'.`);
      return;
    }

    const rankStop = (s: Record<string, string>): number => {
      const name = (s.stop_name || '').toLowerCase();
      if (name === query) return 0;
      if (name === query + ' station') return 1;
      if (name.includes('station') && name.includes(query)) return 2;
      return 3;
    };
    matches.sort((a, b) => {
      const ra = rankStop(a);
      const rb = rankStop(b);
      if (ra !== rb) return ra - rb;
      return a.stop_name.localeCompare(b.stop_name);
    });

    if (!jsonOutput && matches.length > 1) {
      console.log(`Found ${matches.length} stops matching '${stopSearch}':`);
      for (const s of matches.slice(0, 10)) {
        console.log(`  ${s.stop_id.padStart(6)} \u2014 ${s.stop_name}`);
      }
      console.log(`\nUsing best match: ${matches[0].stop_name}\n`);
    }
    stopId = matches[0].stop_id;
  }

  if (!stopId || !stops[stopId]) {
    const msg = stopId
      ? `Stop ID '${stopId}' not found in GTFS data.`
      : 'Provide --stop or --stop-search';
    if (jsonOutput) {
      console.log(JSON.stringify({ error: msg }));
      return;
    }
    console.log(msg);
    console.log("Use 'stops --search <name>' to find stop IDs.");
    return;
  }

  const stop = stops[stopId];
  if (!jsonOutput)
    console.log(
      `\n=== Arrivals at: ${stop.stop_name} (ID: ${stopId}) ===\n`,
    );

  const feed: PbFeedMessage = await parsePb(FEEDS.trip_updates_pb);

  // Collect ALL RT arrivals for this stop (before headsign filter) to detect headsign mismatch
  const rtAllArrivals: RtArrivalEntry[] = [];
  const rtFilteredArrivals: RtArrivalEntry[] = [];

  for (const entity of feed.entity || []) {
    const tu = entity.tripUpdate || entity.trip_update;
    if (!tu) continue;
    const tripId = tu.trip?.tripId || tu.trip?.trip_id || '';
    const routeId = tu.trip?.routeId || tu.trip?.route_id || '';
    if (routeFilter && routeId !== routeFilter) continue;

    const stopTimeUpdates = tu.stopTimeUpdate || tu.stop_time_update || [];
    for (const stu of stopTimeUpdates) {
      const stuStopId = stu.stopId || stu.stop_id;
      if (stuStopId !== stopId) continue;

      let arrivalTime: Date | null = null;
      let delay = 0;
      if (stu.arrival?.time) {
        arrivalTime = toLocalDate(Number(stu.arrival.time), TZ);
        delay = stu.arrival.delay || 0;
      } else if (stu.departure?.time) {
        arrivalTime = toLocalDate(Number(stu.departure.time), TZ);
        delay = stu.departure.delay || 0;
      }

      if (arrivalTime) {
        const rname = routes[routeId]?.route_short_name || routeId;
        const rtype = routes[routeId]?.route_type || '3';
        const tripInfo = trips[tripId] || {};
        const headsign =
          tripInfo.trip_headsign ||
          routes[routeId]?.route_long_name ||
          '';

        const now = localNow(TZ);
        const minsAway =
          (arrivalTime.getTime() - now.getTime()) / 60000;
        if (minsAway < -5) continue;

        const entry: RtArrivalEntry = {
          route: rname,
          route_id: routeId,
          route_type: rtype,
          headsign,
          arrival: fmtTimeHM(arrivalTime),
          minsAway: Math.round(minsAway),
          delayMins: delay ? Math.round(delay / 60) : 0,
        };

        rtAllArrivals.push(entry);
        if (
          !headsignFilter ||
          headsign.toLowerCase().includes(headsignFilter)
        ) {
          rtFilteredArrivals.push(entry);
        }
      }
    }
  }

  if (rtFilteredArrivals.length) {
    rtFilteredArrivals.sort((a, b) => a.minsAway - b.minsAway);

    if (jsonOutput) {
      console.log(
        JSON.stringify({
          stop: { id: stopId, name: stop.stop_name },
          source: 'realtime',
          arrivals: rtFilteredArrivals.slice(0, 15),
        }),
      );
      return;
    }

    console.log('Real-time arrivals:');
    for (const a of rtFilteredArrivals.slice(0, 15)) {
      const delayStr =
        a.delayMins > 0 ? ` (+${a.delayMins}m late)` : '';
      const eta =
        a.minsAway <= 0
          ? 'NOW'
          : a.minsAway === 1
            ? '1 min'
            : `${a.minsAway} min`;
      const emoji = getRouteEmoji(a.route_id, a.route_type);
      console.log(
        `  ${emoji} Route ${a.route} \u2192 ${a.headsign}`,
      );
      console.log(`     ${a.arrival} (${eta})${delayStr}`);
      console.log();
    }
    return;
  }

  // RT data exists but headsign filter matched nothing — don't fall through to schedule
  if (headsignFilter && rtAllArrivals.length) {
    const availableHeadsigns = [
      ...new Set(rtAllArrivals.map((a) => a.headsign)),
    ].sort();
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          stop: { id: stopId, name: stop.stop_name },
          source: 'realtime',
          arrivals: [],
          headsignFilter: opts.headsign,
          availableHeadsigns,
          message: `No arrivals matching headsign '${opts.headsign}'.`,
        }),
      );
      return;
    }
    console.log(`No arrivals matching headsign '${opts.headsign}'.`);
    console.log(`Available headsigns:`);
    for (const h of availableHeadsigns) console.log(`  \u2022 ${h}`);
    return;
  }

  // No RT data at all — fall back to scheduled times
  const now = localNow(TZ);
  const yyyy = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const todayStr = `${yyyy}${mo}${dd}`;
  const activeServices = getActiveServiceIdsForDate(todayStr, GTFS_DIR);

  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const currentTime = `${hh}:${mm}:${ss}`;

  const stopTimes = loadStopTimesForStop(stopId, GTFS_DIR);

  function findUpcoming(
    serviceIds: Set<string>,
    minTime: string,
  ): ScheduledArrivalEntry[] {
    const results: ScheduledArrivalEntry[] = [];
    const seen = new Set<string>();
    for (const st of stopTimes) {
      const tripInfo = trips[st.trip_id] || {};
      const routeId = tripInfo.route_id || '';
      const serviceId = tripInfo.service_id || '';
      if (!serviceIds.has(serviceId)) continue;
      if (routeFilter && routeId !== routeFilter) continue;
      const arrTime = st.arrival_time || st.departure_time || '';
      if (arrTime <= minTime) continue;
      const rname = routes[routeId]?.route_short_name || routeId;
      const rtype = routes[routeId]?.route_type || '3';
      const headsign = tripInfo.trip_headsign || '';
      if (headsignFilter && !headsign.toLowerCase().includes(headsignFilter))
        continue;
      const dedup = `${rname}|${arrTime}|${headsign}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      results.push({
        route: rname,
        route_id: routeId,
        route_type: rtype,
        headsign,
        time: arrTime,
      });
    }
    results.sort((a, b) => a.time.localeCompare(b.time));
    return results;
  }

  let upcoming = findUpcoming(activeServices, currentTime);
  let dateLabel = 'today';

  if (!upcoming.length) {
    const tomorrow = new Date(now.getTime() + 86400000);
    const ty = String(tomorrow.getUTCFullYear());
    const tm = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
    const td = String(tomorrow.getUTCDate()).padStart(2, '0');
    const tomorrowServices = getActiveServiceIdsForDate(
      `${ty}${tm}${td}`,
      GTFS_DIR,
    );
    upcoming = findUpcoming(tomorrowServices, '00:00:00');
    dateLabel = 'tomorrow';
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        stop: { id: stopId, name: stop.stop_name },
        source: 'scheduled',
        dateLabel,
        arrivals: upcoming
          .slice(0, 15)
          .map((u) => ({ route: u.route, headsign: u.headsign, time: u.time })),
      }),
    );
    return;
  }

  console.log(
    `No real-time data available. Showing scheduled times for ${dateLabel}:`,
  );

  if (!upcoming.length) {
    console.log(`  No upcoming departures found for ${dateLabel}.`);
    return;
  }
  for (const u of upcoming.slice(0, 15)) {
    let timeStr = u.time;
    try {
      const [h, m] = u.time.split(':');
      let hr = parseInt(h);
      const ampm = hr >= 12 ? 'PM' : 'AM';
      if (hr > 12) hr -= 12;
      else if (hr === 0) hr = 12;
      timeStr = `${hr}:${m} ${ampm}`;
    } catch {
      // keep original timeStr
    }
    const emoji = getRouteEmoji(u.route_id, u.route_type);
    console.log(
      `  ${emoji} Route ${u.route} \u2192 ${u.headsign} at ${timeStr}`,
    );
  }
}

export function cmdStops(opts: CliOptions): void {
  if (!ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')) return;
  const stops = loadStops(GTFS_DIR);
  const jsonOutput = opts.json;

  if (opts.search) {
    const query = opts.search.toLowerCase();
    const matches = Object.values(stops).filter(
      (s) =>
        (s.stop_name || '').toLowerCase().includes(query) ||
        (s.stop_desc || '').toLowerCase().includes(query),
    );
    if (!matches.length) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ stops: [], query: opts.search }),
        );
        return;
      }
      console.log(`No stops found matching '${opts.search}'.`);
      return;
    }
    const sorted = matches
      .sort((a, b) => a.stop_name.localeCompare(b.stop_name))
      .slice(0, 25);
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          query: opts.search,
          count: matches.length,
          stops: sorted.map((s) => ({
            id: s.stop_id,
            name: s.stop_name,
            lat: s.stop_lat,
            lon: s.stop_lon,
            desc: s.stop_desc || undefined,
          })),
        }),
      );
      return;
    }
    console.log(
      `\n=== Stops matching '${opts.search}' (${matches.length} found) ===\n`,
    );
    for (const s of sorted) {
      console.log(`  \u{1F4CD} ${s.stop_name}`);
      console.log(
        `     ID: ${s.stop_id}  |  (${s.stop_lat}, ${s.stop_lon})`,
      );
      if (s.stop_desc) console.log(`     ${s.stop_desc}`);
      console.log();
    }
  } else if (opts.near) {
    const parts = opts.near.split(',');
    if (parts.length !== 2) {
      console.log('Invalid format. Use: --near LAT,LON');
      return;
    }
    const [lat, lon] = parts.map(Number);
    if (isNaN(lat) || isNaN(lon)) {
      console.log('Invalid format. Use: --near LAT,LON');
      return;
    }
    const radius = opts.radius ? parseFloat(opts.radius) : 0.5;

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
      if (jsonOutput) {
        console.log(JSON.stringify({ stops: [], lat, lon, radius }));
        return;
      }
      console.log(
        `No stops found within ${radius} miles of (${lat}, ${lon}).`,
      );
      return;
    }
    const limited = nearby.slice(0, 20);
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          lat,
          lon,
          radius,
          count: nearby.length,
          stops: limited.map(([dist, s]) => ({
            id: s.stop_id,
            name: s.stop_name,
            lat: s.stop_lat,
            lon: s.stop_lon,
            distance_mi: +dist.toFixed(3),
          })),
        }),
      );
      return;
    }
    console.log(
      `\n=== Nearby Stops (${nearby.length} within ${radius} mi) ===\n`,
    );
    for (const [dist, s] of limited) {
      console.log(
        `  \u{1F4CD} ${s.stop_name} \u2014 ${dist.toFixed(2)} mi`,
      );
      console.log(`     ID: ${s.stop_id}`);
      console.log();
    }
  } else {
    if (jsonOutput) {
      console.log(
        JSON.stringify({ error: 'Provide --search <name> or --near LAT,LON' }),
      );
      return;
    }
    console.log('Provide --search <name> or --near LAT,LON');
  }
}

export function cmdRoutes(opts: CliOptions): void {
  if (!ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')) return;
  const routes = loadRoutes(GTFS_DIR);
  const jsonOutput = opts?.json;
  const typeNames: Record<string, string> = {
    '0': 'Tram',
    '1': 'Subway',
    '2': 'Rail',
    '3': 'Bus',
    '4': 'Ferry',
  };

  const sorted = Object.keys(routes).sort((a, b) =>
    a.padStart(5, '0').localeCompare(b.padStart(5, '0')),
  );

  if (jsonOutput) {
    const list = sorted.map((rid) => {
      const r = routes[rid];
      return {
        id: rid,
        short_name: r.route_short_name || rid,
        long_name: r.route_long_name || '',
        type: typeNames[r.route_type || '3'] || 'Other',
        route_type: r.route_type || '3',
      };
    });
    console.log(JSON.stringify({ count: list.length, routes: list }));
    return;
  }

  console.log(`\n=== CapMetro Routes (${sorted.length}) ===\n`);
  for (const rid of sorted) {
    const r = routes[rid];
    const rtype = typeNames[r.route_type || '3'] || 'Other';
    const short = r.route_short_name || rid;
    const longName = r.route_long_name || '';
    console.log(`  ${short.padStart(6)} | ${rtype.padEnd(5)} | ${longName}`);
  }
}

export function cmdRouteInfo(opts: CliOptions): void {
  if (!ensureGtfs(GTFS_DIR, 'node scripts/capmetro.mjs refresh-gtfs')) return;
  let routeId = opts.route;
  const jsonOutput = opts.json;
  const routes = loadRoutes(GTFS_DIR);
  const trips = loadTrips(GTFS_DIR);
  const stops = loadStops(GTFS_DIR);

  if (!routeId) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Provide --route ID' }));
      return;
    }
    console.log('Provide --route ID');
    return;
  }

  if (!routes[routeId]) {
    const match = Object.entries(routes).find(
      ([, r]) => r.route_short_name === routeId,
    );
    if (match) {
      routeId = match[0];
    } else {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ error: `Route '${opts.route}' not found.` }),
        );
        return;
      }
      console.log(`Route '${opts.route}' not found.`);
      return;
    }
  }

  const r = routes[routeId];
  const routeTrips = Object.values(trips).filter(
    (t) => t.route_id === routeId,
  );

  let stopList: { sequence: number; stop_id: string; stop_name: string }[] = [];
  let direction = '';
  if (routeTrips.length) {
    const dir0 = routeTrips.filter((t) => t.direction_id === '0');
    const sampleTrip = (dir0.length ? dir0 : routeTrips)[0];
    direction = sampleTrip.trip_headsign || '';
    const stopTimes = loadStopTimesForTrip(sampleTrip.trip_id, GTFS_DIR);
    stopList = stopTimes.map((st) => ({
      sequence: parseInt(st.stop_sequence || '0'),
      stop_id: st.stop_id,
      stop_name: stops[st.stop_id]?.stop_name || st.stop_id,
    }));
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify({
        route: {
          id: routeId,
          short_name: r.route_short_name || routeId,
          long_name: r.route_long_name || '',
          type: r.route_type || '?',
          url: r.route_url || undefined,
        },
        direction,
        stops: stopList,
      }),
    );
    return;
  }

  console.log(
    `\n=== Route ${r.route_short_name || routeId} \u2014 ${r.route_long_name || ''} ===`,
  );
  console.log(`    Type: ${r.route_type || '?'}  |  ID: ${routeId}`);
  if (r.route_url) console.log(`    URL: ${r.route_url}`);
  console.log();

  if (!routeTrips.length) {
    console.log('No trips found for this route.');
    return;
  }

  if (stopList.length) {
    console.log(`Stops (direction: ${direction}):`);
    for (const st of stopList) {
      console.log(
        `  ${String(st.sequence).padStart(3)}. ${st.stop_name} (ID: ${st.stop_id})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`CapMetro Austin Transit \u2014 OpenClaw Skill

Commands:
  alerts         Show current service alerts
  vehicles       Show real-time vehicle positions [--route ID]
  arrivals       Next arrivals at a stop (--stop ID | --stop-search NAME) [--route ID] [--headsign TEXT]
  stops          Search for stops (--search NAME | --near LAT,LON [--radius MI])
  routes         List all routes
  route-info     Get route details and stops (--route ID)
  refresh-gtfs   Download/refresh GTFS static data

Options:
  --json         Output structured JSON instead of formatted text`);
    return;
  }

  const rest = args.slice(1);

  const optDefs: Record<
    string,
    { type: 'string' | 'boolean'; default?: boolean }
  > = {
    route: { type: 'string' },
    stop: { type: 'string' },
    'stop-search': { type: 'string' },
    headsign: { type: 'string' },
    search: { type: 'string' },
    near: { type: 'string' },
    radius: { type: 'string' },
    json: { type: 'boolean', default: false },
  };

  let opts: CliOptions = {};
  try {
    const parsed = parseArgs({
      args: rest,
      options: optDefs,
      allowPositionals: true,
      strict: false,
    });
    opts = parsed.values as unknown as CliOptions;
  } catch (err: any) {
    console.error(`Error parsing arguments: ${err.message}`);
    process.exit(1);
  }

  const handlers: Record<string, () => void | Promise<void>> = {
    'refresh-gtfs': () => cmdRefreshGtfs(),
    alerts: () => cmdAlerts(opts),
    vehicles: () => cmdVehicles(opts),
    arrivals: () => cmdArrivals(opts),
    stops: () => cmdStops(opts),
    routes: () => cmdRoutes(opts),
    'route-info': () => cmdRouteInfo(opts),
  };

  if (handlers[command]) {
    Promise.resolve(handlers[command]()).catch((err: any) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    process.exit(1);
  }
}

main();
