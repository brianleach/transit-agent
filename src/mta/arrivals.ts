#!/usr/bin/env node
// ---------------------------------------------------------------------------
// MTA New York City Transit — CLI Entry Point
// Real-time subway arrivals (GTFS-RT protobuf), bus predictions (SIRI JSON),
// service alerts, and route info for New York City.
//
// SECURITY MANIFEST
//   Environment variables: MTA_BUS_API_KEY (optional — only for bus commands)
//   External endpoints:    api-endpoint.mta.info (subway GTFS-RT, open access, no auth)
//                          bustime.mta.info (SIRI bus API, key required)
//                          web.mta.info (GTFS static, no auth)
//   Local files written:   ~/.mta/gtfs/ (GTFS static data cache)
//   Local files read:      ~/.mta/gtfs/*.txt (GTFS CSV files)
//   User input handling:   Used for local filtering only, never interpolated into
//                          shell commands
// ---------------------------------------------------------------------------

import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

import { parseCsvLine, ensureGtfs } from '../shared/csv.js';
import {
  toLocalDate,
  localNow,
  fmtTime,
  fmtTimeHM,
  fmtDateTimeShort,
} from '../shared/time.js';
import { haversine } from '../shared/geo.js';
import { getNyctProtobufRoot, parsePb } from '../shared/proto.js';
import { loadStops, loadRoutes, loadTrips, refreshGtfs } from '../shared/gtfs.js';

import {
  MTA_BUS_API_KEY,
  subwayFeedUrl,
  alertsFeedUrl,
  BUS_SIRI_BASE,
  BUS_OBA_BASE,
  GTFS_STATIC_URL,
  GTFS_DIR,
  TIMEZONE,
  REFRESH_CMD,
  FEED_MAP,
  ALL_FEEDS,
  SUBWAY_LINES,
  LINE_ORDER,
  STATIONS,
  requireBusKey,
  fetchJSON,
  searchStation,
  getStopIdsForStation,
  getFeedsForStation,
  getDirectionLabel,
} from './client.js';

import type {
  CliOptions,
  SubwayArrival,
  SubwayVehicle,
  BusArrival,
  BusVehicle,
  AlertEntry,
  SiriStopMonitoringResponse,
  SiriVehicleMonitoringResponse,
  ObaRoutesForAgencyResponse,
  ObaStopsForLocationResponse,
  ObaStopsForRouteResponse,
} from './types.js';

// ---------------------------------------------------------------------------
// Local GTFS helper: load stop_times for a single trip (not in shared)
// ---------------------------------------------------------------------------

function loadStopTimesForTrip(
  tripId: string,
  gtfsDir: string,
): Record<string, string>[] {
  const filePath = path.join(gtfsDir, 'stop_times.txt');
  if (!fs.existsSync(filePath)) return [];
  let content = fs.readFileSync(filePath, 'utf-8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const tripIdIdx = headers.indexOf('trip_id');
  if (tripIdIdx === -1) return [];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    if (vals[tripIdIdx] !== tripId) continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = vals[j] || '';
    }
    rows.push(obj);
  }
  rows.sort(
    (a, b) =>
      parseInt(a.stop_sequence || '0') - parseInt(b.stop_sequence || '0'),
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Subway feed parser (using NYCT extension root)
// ---------------------------------------------------------------------------

async function parseSubwayFeed(feedName: string): Promise<any> {
  const root = await getNyctProtobufRoot();
  return parsePb(subwayFeedUrl(feedName), root);
}

async function parseAlertsFeed(feedUrl: string): Promise<any> {
  const root = await getNyctProtobufRoot();
  return parsePb(feedUrl, root);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdRefreshGtfs(): Promise<void> {
  await refreshGtfs(GTFS_STATIC_URL, GTFS_DIR);
  const files = fs
    .readdirSync(GTFS_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  console.log(`Extracted ${files.length} files:`);
  for (const f of files) console.log(`  ${f}`);
}

// ---- Subway Arrivals ----

async function cmdArrivals(opts: CliOptions): Promise<void> {
  let stationId = opts.stop;
  const stationName = opts.station;
  const stopSearch = opts['stop-search'];
  const lineFilter = opts.line;
  const jsonOutput = opts.json;

  // Resolve station by name search
  if (stationName || stopSearch) {
    const query = (stationName || stopSearch)!;
    const matches = searchStation(query, lineFilter);
    if (!matches.length) {
      console.log(`No stations found matching '${query}'.`);
      console.log("Try 'stops --search <name>' to find stations.");
      return;
    }
    if (matches.length > 1) {
      console.log(`Found ${matches.length} stations matching '${query}':`);
      for (const s of matches.slice(0, 8)) {
        const lineStr = s.lines?.length ? ` (${s.lines.join(', ')})` : '';
        console.log(`  ${s.id} — ${s.name}${lineStr}`);
      }
      console.log(`\nUsing best match: ${matches[0].name}\n`);
    }
    stationId = matches[0].id;
  }

  if (!stationId) {
    console.log('Provide --station, --stop-search, or --stop');
    return;
  }

  // Determine if this is a directional stop ID (ends with N or S)
  const isDirectional = /^[A-Z0-9]+[NS]$/.test(stationId);
  const parentId = isDirectional ? stationId.slice(0, -1) : stationId;

  // Get stop IDs to match against
  const targetStopIds = isDirectional
    ? [stationId]
    : getStopIdsForStation(parentId);
  const targetSet = new Set(targetStopIds);

  // Determine station info for display
  let stationLabel = stationId;
  const matchedStation = STATIONS.find((s) => s.id === parentId);
  if (matchedStation) {
    stationLabel = matchedStation.name;
  } else if (ensureGtfs(GTFS_DIR, REFRESH_CMD)) {
    const stops = loadStops(GTFS_DIR);
    const stopInfo = stops[parentId] || stops[stationId];
    if (stopInfo) stationLabel = stopInfo.stop_name;
  }

  // Determine which feeds to fetch
  let feedsToFetch: string[];
  if (lineFilter && FEED_MAP[lineFilter]) {
    feedsToFetch = [FEED_MAP[lineFilter]];
  } else if (matchedStation) {
    feedsToFetch = getFeedsForStation(matchedStation);
  } else {
    feedsToFetch = ALL_FEEDS;
  }

  if (!jsonOutput)
    console.log(
      `\n=== \u{1F687} Subway Arrivals at: ${stationLabel} (${stationId}) ===\n`,
    );

  // Fetch all relevant feeds in parallel
  const feedResults = await Promise.allSettled(
    feedsToFetch.map((f) => parseSubwayFeed(f)),
  );

  const now = localNow(TIMEZONE);
  const arrivals: SubwayArrival[] = [];
  const allRtHeadsigns = new Set<string>();

  for (const result of feedResults) {
    if (result.status !== 'fulfilled') continue;
    const feed = result.value;

    for (const entity of feed.entity || []) {
      const tu = entity.tripUpdate || entity.trip_update;
      if (!tu) continue;

      const routeId: string = tu.trip?.routeId || tu.trip?.route_id || '';
      if (lineFilter && routeId !== lineFilter) continue;

      // Get NYCT extension data
      const nyctTrip =
        tu.trip?.['.transit_realtime.nyctTripDescriptor'] ||
        tu.trip?.nyctTripDescriptor ||
        tu.trip?.['.nyctTripDescriptor'] ||
        {};
      const trainId: string = nyctTrip.trainId || nyctTrip.train_id || '';
      const direction: number | null =
        nyctTrip.direction ?? null;

      const stopTimeUpdates =
        tu.stopTimeUpdate || tu.stop_time_update || [];
      for (const stu of stopTimeUpdates) {
        const stopId: string = stu.stopId || stu.stop_id || '';
        if (!targetSet.has(stopId)) continue;

        let arrivalTime: Date | null = null;
        if (stu.arrival?.time) {
          arrivalTime = toLocalDate(Number(stu.arrival.time), TIMEZONE);
        } else if (stu.departure?.time) {
          arrivalTime = toLocalDate(Number(stu.departure.time), TIMEZONE);
        }

        if (!arrivalTime) continue;

        const minsAway =
          (arrivalTime.getTime() - now.getTime()) / 60000;
        if (minsAway < -2) continue;

        // Track info from NYCT extension
        const nyctStop =
          stu['.transit_realtime.nyctStopTimeUpdate'] ||
          stu?.nyctStopTimeUpdate ||
          stu?.['.nyctStopTimeUpdate'] ||
          {};
        const scheduledTrack: string =
          nyctStop.scheduledTrack || nyctStop.scheduled_track || '';
        const actualTrack: string =
          nyctStop.actualTrack || nyctStop.actual_track || '';

        const dirLabel = getDirectionLabel(stopId, direction);
        const line = SUBWAY_LINES[routeId];
        const lineName = line ? line.name : routeId;

        // Collect headsign for RT data (direction label acts as headsign)
        if (dirLabel) allRtHeadsigns.add(dirLabel);

        arrivals.push({
          route: routeId,
          lineName,
          color: line?.color || '',
          direction: dirLabel,
          arrival: fmtTimeHM(arrivalTime),
          minsAway: Math.round(minsAway),
          trainId,
          scheduledTrack,
          actualTrack,
          stopId,
        });
      }
    }
  }

  // Headsign filter
  const headsignFilter = opts.headsign;
  if (headsignFilter && arrivals.length > 0) {
    const filtered = arrivals.filter((a) =>
      a.direction.toLowerCase().includes(headsignFilter.toLowerCase()),
    );
    if (filtered.length === 0) {
      const available =
        [...allRtHeadsigns].join(', ') || 'none detected';
      if (jsonOutput) {
        console.log(
          JSON.stringify(
            {
              error: 'no_matching_headsign',
              headsign: headsignFilter,
              availableHeadsigns: [...allRtHeadsigns],
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `No arrivals matching headsign '${headsignFilter}'.`,
        );
        console.log(`Available headsigns: ${available}`);
      }
      return;
    }
    arrivals.length = 0;
    arrivals.push(...filtered);
  }

  if (!arrivals.length) {
    if (jsonOutput) {
      console.log(
        JSON.stringify(
          { station: stationLabel, stationId, arrivals: [] },
          null,
          2,
        ),
      );
    } else {
      console.log('No upcoming subway arrivals found.');
      console.log(
        'This may be due to reduced service (late night/weekend) or a temporary feed issue.',
      );
    }
    return;
  }

  arrivals.sort((a, b) => a.minsAway - b.minsAway);

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          station: stationLabel,
          stationId,
          arrivals: arrivals.slice(0, 20).map((a) => ({
            route: a.route,
            lineName: a.lineName,
            direction: a.direction,
            arrival: a.arrival,
            minsAway: a.minsAway,
            trainId: a.trainId || null,
            scheduledTrack: a.scheduledTrack || null,
            actualTrack: a.actualTrack || null,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  for (const a of arrivals.slice(0, 20)) {
    const eta =
      a.minsAway <= 0
        ? 'Approaching'
        : a.minsAway === 1
          ? '1 min'
          : `${a.minsAway} min`;
    let trackStr = '';
    if (a.actualTrack && a.actualTrack !== a.scheduledTrack) {
      trackStr = ` [Track ${a.actualTrack}, scheduled ${a.scheduledTrack}]`;
    } else if (a.actualTrack) {
      trackStr = ` [Track ${a.actualTrack}]`;
    }
    const dirStr = a.direction ? ` \u2014 ${a.direction}` : '';

    console.log(`  \u{1F687} ${a.lineName}${dirStr}`);
    console.log(`     ${a.arrival} (${eta})${trackStr}`);
    if (a.trainId) console.log(`     Train ${a.trainId}`);
    console.log();
  }
}

// ---- Subway Vehicles ----

async function cmdVehicles(opts: CliOptions): Promise<void> {
  const lineFilter = opts.line;
  const jsonOutput = opts.json;
  if (!lineFilter) {
    console.log('Provide --line with a subway line (e.g., 1, A, L)');
    return;
  }

  const feedName = FEED_MAP[lineFilter];
  if (!feedName) {
    console.log(`Unknown subway line: ${lineFilter}`);
    console.log(
      'Valid lines: 1-7, A, C, E, B, D, F, M, G, J, Z, L, N, Q, R, W, GS, FS, H, SI',
    );
    return;
  }

  const line = SUBWAY_LINES[lineFilter];
  if (!jsonOutput)
    console.log(
      `\nFetching ${line?.name || lineFilter} positions...`,
    );

  const feed = await parseSubwayFeed(feedName);
  const vehicles: SubwayVehicle[] = [];
  const stops = ensureGtfs(GTFS_DIR, REFRESH_CMD)
    ? loadStops(GTFS_DIR)
    : {};

  for (const entity of feed.entity || []) {
    const v = entity.vehicle;
    if (!v) continue;

    const routeId: string = v.trip?.routeId || v.trip?.route_id || '';
    if (routeId !== lineFilter) continue;

    const nyctTrip =
      v.trip?.['.transit_realtime.nyctTripDescriptor'] ||
      v.trip?.nyctTripDescriptor ||
      v.trip?.['.nyctTripDescriptor'] ||
      {};
    const trainId: string = nyctTrip.trainId || nyctTrip.train_id || '';
    const direction: number | null = nyctTrip.direction ?? null;
    const stopId: string = v.stopId || v.stop_id || '';
    const status: number = v.currentStatus || v.current_status || 0;
    const ts = v.timestamp;

    const dirLabel = getDirectionLabel(stopId, direction);
    const stopName = stops[stopId]?.stop_name || stopId;
    const statusLabels: Record<number, string> = {
      0: 'Approaching',
      1: 'Stopped at',
      2: 'In transit to',
    };
    const statusStr = statusLabels[status] || 'En route to';

    let timeStr = '';
    if (ts) {
      try {
        timeStr = fmtTime(toLocalDate(Number(ts), TIMEZONE));
      } catch {
        timeStr = String(ts);
      }
    }

    vehicles.push({
      trainId,
      direction: dirLabel,
      stopName,
      stopId,
      status: statusStr,
      time: timeStr,
    });
  }

  if (!vehicles.length) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({ line: lineFilter, vehicles: [] }, null, 2),
      );
    } else {
      console.log(
        `No active trains found on ${line?.name || lineFilter}.`,
      );
    }
    return;
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          line: lineFilter,
          lineName: line?.name || lineFilter,
          count: vehicles.length,
          vehicles,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `\n=== \u{1F687} ${line?.name || lineFilter} Positions (${vehicles.length} active) ===\n`,
  );

  for (const v of vehicles) {
    const dirStr = v.direction ? ` \u2014 ${v.direction}` : '';
    console.log(
      `  \u{1F687} Train ${v.trainId || '?'}${dirStr}`,
    );
    console.log(`     ${v.status} ${v.stopName}`);
    if (v.time) console.log(`     Last update: ${v.time}`);
    console.log();
  }
}

// ---- Bus Arrivals (SIRI StopMonitoring) ----

async function cmdBusArrivals(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;

  let stopId = opts.stop;
  const stopSearch = opts['stop-search'];
  const routeFilter = opts.route;
  const jsonOutput = opts.json;

  if (stopSearch) {
    console.log(`Searching bus stops for '${stopSearch}'...`);
    console.log(
      'Bus stop search requires a stop ID (e.g., MTA_308209).',
    );
    console.log('Find stop IDs using: bus-stops --near LAT,LON');
    console.log(
      'Or check the MTA BusTime website: https://bustime.mta.info/',
    );
    return;
  }

  if (!stopId) {
    console.log(
      'Provide --stop with a bus stop ID (e.g., MTA_308209)',
    );
    console.log('Find stop IDs using: bus-stops --near LAT,LON');
    return;
  }

  let url = `${BUS_SIRI_BASE}/stop-monitoring.json?key=${encodeURIComponent(MTA_BUS_API_KEY)}&MonitoringRef=${encodeURIComponent(stopId)}`;
  if (routeFilter) {
    url += `&LineRef=MTA%20NYCT_${encodeURIComponent(routeFilter)}`;
  }

  const data = await fetchJSON<SiriStopMonitoringResponse>(url);
  const delivery =
    data?.Siri?.ServiceDelivery?.StopMonitoringDelivery;
  if (!delivery || !delivery.length) {
    console.log('No bus monitoring data available for this stop.');
    return;
  }

  const visits = delivery[0]?.MonitoredStopVisit;
  if (!visits || !visits.length) {
    const filterMsg = routeFilter
      ? ` for route ${routeFilter}`
      : '';
    console.log(
      `No upcoming bus arrivals${filterMsg} at stop ${stopId}.`,
    );
    return;
  }

  // Get stop name from first result
  const firstVj = visits[0]?.MonitoredVehicleJourney;
  const stopLabel =
    firstVj?.MonitoredCall?.StopPointName?.[0]?.value || stopId;

  const busArrivals: BusArrival[] = [];
  for (const visit of visits.slice(0, 15)) {
    const vj = visit?.MonitoredVehicleJourney;
    if (!vj) continue;

    const routeRef = vj.LineRef || '';
    const route = routeRef.replace(/^MTA NYCT_|^MTABC_/, '');
    const dest = vj.DestinationName?.[0]?.value || '';

    const mc = vj.MonitoredCall || {};
    const distances = mc.Extensions?.Distances || {};
    const stopsAway: string | number = distances.StopsFromCall ?? '';
    const distMiles: string = distances.DistanceFromCall
      ? (distances.DistanceFromCall / 1609.34).toFixed(1)
      : '';

    let etaStr = '';
    let minsAway: number | null = null;
    const expectedArrival =
      mc.ExpectedArrivalTime || mc.ExpectedDepartureTime;
    if (expectedArrival) {
      const arrTime = new Date(expectedArrival);
      minsAway = Math.round(
        (arrTime.getTime() - Date.now()) / 60000,
      );
      if (minsAway <= 0) etaStr = 'Approaching';
      else if (minsAway === 1) etaStr = '1 min';
      else etaStr = `${minsAway} min`;
    }

    const presentable = mc.ArrivalProximityText || '';
    if (!etaStr && presentable) etaStr = presentable;

    const vehicleRef = vj.VehicleRef || '';

    busArrivals.push({
      route,
      destination: dest,
      eta: etaStr,
      minsAway,
      stopsAway,
      distMiles,
      vehicleRef,
    });
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        { stop: stopLabel, stopId, arrivals: busArrivals },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `\n=== \u{1F68C} Bus Arrivals at: ${stopLabel} (${stopId}) ===\n`,
  );

  for (const a of busArrivals) {
    console.log(
      `  \u{1F68C} Route ${a.route} -> ${a.destination}`,
    );
    let detailLine = '     ';
    if (a.eta) detailLine += `${a.eta}`;
    if (a.stopsAway !== '')
      detailLine += ` (${a.stopsAway} stops away)`;
    if (a.distMiles) detailLine += ` \u2014 ${a.distMiles} mi`;
    console.log(detailLine);
    if (a.vehicleRef)
      console.log(`     Vehicle ${a.vehicleRef}`);
    console.log();
  }
}

// ---- Bus Vehicles (SIRI VehicleMonitoring) ----

async function cmdBusVehicles(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;

  const route = opts.route;
  const jsonOutput = opts.json;
  if (!route) {
    console.log(
      'Provide --route with a bus route (e.g., M1, B52, Bx12)',
    );
    return;
  }

  const url = `${BUS_SIRI_BASE}/vehicle-monitoring.json?key=${encodeURIComponent(MTA_BUS_API_KEY)}&LineRef=MTA%20NYCT_${encodeURIComponent(route)}&VehicleMonitoringDetailLevel=calls`;
  const data = await fetchJSON<SiriVehicleMonitoringResponse>(url);

  const delivery =
    data?.Siri?.ServiceDelivery?.VehicleMonitoringDelivery;
  if (!delivery || !delivery.length) {
    if (jsonOutput)
      console.log(
        JSON.stringify({ route, vehicles: [] }, null, 2),
      );
    else
      console.log(`No vehicle data available for route ${route}.`);
    return;
  }

  const activities = delivery[0]?.VehicleActivity;
  if (!activities || !activities.length) {
    if (jsonOutput)
      console.log(
        JSON.stringify({ route, vehicles: [] }, null, 2),
      );
    else console.log(`No active buses on route ${route}.`);
    return;
  }

  const busVehicles: BusVehicle[] = [];
  for (const activity of activities) {
    const vj = activity?.MonitoredVehicleJourney;
    if (!vj) continue;

    const dest = vj.DestinationName?.[0]?.value || '';
    const vehicleRef = vj.VehicleRef || '';
    const lat = vj.VehicleLocation?.Latitude;
    const lon = vj.VehicleLocation?.Longitude;
    const bearing = vj.Bearing;
    const progressStatus = vj.ProgressStatus?.[0] || '';

    const mc = vj.MonitoredCall || {};
    const nextStop = mc.StopPointName?.[0]?.value || '';

    let statusStr = '';
    if (progressStatus === 'layover') statusStr = 'layover';
    else if (progressStatus === 'prevTrip') statusStr = 'prev trip';

    busVehicles.push({
      vehicleRef,
      destination: dest,
      status: statusStr,
      nextStop,
      lat,
      lon,
      bearing,
    });
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          route,
          count: busVehicles.length,
          vehicles: busVehicles,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `\n=== \u{1F68C} Route ${route} Bus Positions (${busVehicles.length} active) ===\n`,
  );

  for (const v of busVehicles) {
    const statusTag = v.status ? ` (${v.status})` : '';
    console.log(
      `  \u{1F68C} Vehicle ${v.vehicleRef} -> ${v.destination}${statusTag}`,
    );
    if (v.nextStop) console.log(`     Next stop: ${v.nextStop}`);
    if (v.lat && v.lon)
      console.log(
        `     Position: (${v.lat}, ${v.lon}) bearing ${v.bearing || '?'}`,
      );
    console.log();
  }
}

// ---- Alerts ----

async function cmdAlerts(opts: CliOptions): Promise<void> {
  const lineFilter = opts.line;
  const subwayOnly = opts.subway;
  const busOnly = opts.bus;
  const jsonOutput = opts.json;

  let feedUrl: string;
  if (subwayOnly) {
    feedUrl = alertsFeedUrl('subway-alerts');
  } else if (busOnly) {
    feedUrl = alertsFeedUrl('bus-alerts');
  } else {
    feedUrl = alertsFeedUrl('all-alerts');
  }

  const feed = await parseAlertsFeed(feedUrl);

  if (!feed.entity || feed.entity.length === 0) {
    const scope = subwayOnly ? 'subway' : busOnly ? 'bus' : '';
    console.log(`No active ${scope} service alerts.`);
    return;
  }

  // Filter by line if specified
  let entities = feed.entity;
  if (lineFilter) {
    entities = entities.filter((e: any) => {
      const alert = e.alert;
      if (!alert?.informedEntity && !alert?.informed_entity) return false;
      const informed = alert.informedEntity || alert.informed_entity || [];
      return informed.some(
        (ie: any) =>
          (ie.routeId || ie.route_id) === lineFilter ||
          (ie.routeId || ie.route_id) === `MTASBWY_${lineFilter}`,
      );
    });
  }

  if (!entities.length) {
    console.log(
      `No active alerts for ${lineFilter || 'this filter'}.`,
    );
    return;
  }

  const scope = subwayOnly ? 'Subway' : busOnly ? 'Bus' : 'MTA';

  const alertsList: AlertEntry[] = [];
  for (const entity of entities) {
    const alert = entity.alert;
    if (!alert) continue;

    let header = '';
    const headerText = alert.headerText || alert.header_text;
    if (headerText?.translation?.length)
      header = headerText.translation[0].text;
    let desc = '';
    const descriptionText =
      alert.descriptionText || alert.description_text;
    if (descriptionText?.translation?.length)
      desc = descriptionText.translation[0].text;

    const affected: string[] = [];
    const informedEntity =
      alert.informedEntity || alert.informed_entity;
    if (informedEntity) {
      for (const ie of informedEntity) {
        const rid = ie.routeId || ie.route_id;
        if (rid) {
          const clean = rid.replace(
            /^MTASBWY_|^MTA NYCT_|^MTABC_/,
            '',
          );
          if (!affected.includes(clean)) affected.push(clean);
        }
      }
    }

    const periods: string[] = [];
    const activePeriod = alert.activePeriod || alert.active_period;
    if (activePeriod) {
      for (const ap of activePeriod) {
        const start = ap.start
          ? fmtDateTimeShort(toLocalDate(Number(ap.start), TIMEZONE))
          : '?';
        const end = ap.end
          ? fmtDateTimeShort(toLocalDate(Number(ap.end), TIMEZONE))
          : 'ongoing';
        periods.push(`${start} - ${end}`);
      }
    }

    const effect: number = alert.effect || 0;
    alertsList.push({
      header,
      description: desc,
      routes: affected,
      periods,
      effect,
    });
  }

  if (jsonOutput) {
    console.log(
      JSON.stringify(
        {
          scope,
          count: alertsList.length,
          alerts: alertsList,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `\n=== ${scope} Service Alerts (${alertsList.length} active) ===\n`,
  );

  for (const a of alertsList) {
    let icon = '';
    if (a.effect === 1) icon = '  '; // NO_SERVICE
    else if (a.effect === 2 || a.effect === 3)
      icon = '  '; // REDUCED_SERVICE / SIGNIFICANT_DELAYS
    else icon = '  ';

    console.log(`${icon} ${a.header}`);
    if (a.routes.length)
      console.log(`   Routes: ${a.routes.join(', ')}`);
    if (a.periods.length)
      console.log(
        `   Period: ${a.periods[0]}${a.periods.length > 1 ? ` (+${a.periods.length - 1} more)` : ''}`,
      );
    let descText = a.description;
    if (descText) {
      if (descText.length > 300)
        descText = descText.slice(0, 300) + '...';
      console.log(`   ${descText}`);
    }
    console.log();
  }
}

// ---- Routes ----

function cmdRoutes(opts: CliOptions): void {
  const jsonOutput = opts?.json;

  if (jsonOutput) {
    const routes = LINE_ORDER.filter((c) => SUBWAY_LINES[c]).map(
      (code) => {
        const line = SUBWAY_LINES[code];
        return {
          code,
          name: line.name,
          color: line.color,
          route: line.route,
          terminals: line.terminals,
        };
      },
    );
    console.log(JSON.stringify({ routes }, null, 2));
    return;
  }

  console.log('\n=== \u{1F687} NYC Subway Lines ===\n');
  for (const code of LINE_ORDER) {
    const line = SUBWAY_LINES[code];
    if (!line) continue;
    console.log(
      `  \u{1F687} ${code.padEnd(4)} | ${line.color.padEnd(12)} | ${line.route}`,
    );
    console.log(
      `  ${''.padEnd(5)} | ${''.padEnd(12)} | ${line.terminals.join(' <-> ')}`,
    );
  }
}

// ---- Bus Routes ----

async function cmdBusRoutes(): Promise<void> {
  if (!requireBusKey()) return;

  const url = `${BUS_OBA_BASE}/routes-for-agency/MTA%20NYCT.json?key=${encodeURIComponent(MTA_BUS_API_KEY)}`;
  const data = await fetchJSON<ObaRoutesForAgencyResponse>(url);

  const routes = data?.data?.list;
  if (!routes || !routes.length) {
    console.log('No bus routes found.');
    return;
  }

  console.log(
    `\n=== MTA Bus Routes (${routes.length}) ===\n`,
  );

  // Sort by route short name
  routes.sort((a, b) => {
    const an = a.shortName || a.id || '';
    const bn = b.shortName || b.id || '';
    return an.localeCompare(bn, undefined, { numeric: true });
  });

  for (const r of routes) {
    const short = (r.shortName || r.id || '?').padEnd(8);
    const longName = r.longName || '';
    console.log(`  ${short} | ${longName}`);
  }
}

// ---- Stops ----

function cmdStops(opts: CliOptions): void {
  const jsonOutput = opts.json;
  if (opts.search) {
    const query = opts.search.toLowerCase();

    const results = searchStation(query, undefined);
    if (!results.length) {
      if (jsonOutput)
        console.log(
          JSON.stringify(
            { query: opts.search, stops: [] },
            null,
            2,
          ),
        );
      else
        console.log(
          `No subway stations found matching '${opts.search}'.`,
        );
      return;
    }

    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            query: opts.search,
            stops: results.slice(0, 25).map((s) => ({
              id: s.id,
              name: s.name,
              lines: s.lines || [],
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `\n=== \u{1F687} Subway Stations matching '${opts.search}' (${results.length} found) ===\n`,
    );
    for (const s of results.slice(0, 25)) {
      const lineStr = s.lines?.length
        ? ` (${s.lines.join(', ')})`
        : '';
      console.log(`  \u{1F687} ${s.name}${lineStr}`);
      console.log(`     ID: ${s.id}`);
      console.log();
    }
  } else if (opts.near) {
    if (!ensureGtfs(GTFS_DIR, REFRESH_CMD)) return;
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

    const stops = loadStops(GTFS_DIR);
    const nearby: [number, Record<string, string>][] = [];
    for (const s of Object.values(stops)) {
      // Only parent stations
      if (s.location_type !== '1') continue;
      const slat = parseFloat(s.stop_lat);
      const slon = parseFloat(s.stop_lon);
      if (isNaN(slat) || isNaN(slon)) continue;
      const dist = haversine(lat, lon, slat, slon);
      if (dist <= radius) nearby.push([dist, s]);
    }
    nearby.sort((a, b) => a[0] - b[0]);

    if (!nearby.length) {
      if (jsonOutput)
        console.log(
          JSON.stringify(
            { lat, lon, radius, stops: [] },
            null,
            2,
          ),
        );
      else
        console.log(
          `No subway stations within ${radius} miles of (${lat}, ${lon}).`,
        );
      return;
    }

    if (jsonOutput) {
      console.log(
        JSON.stringify(
          {
            lat,
            lon,
            radius,
            stops: nearby.slice(0, 20).map(([dist, s]) => ({
              id: s.stop_id,
              name: s.stop_name,
              distance: parseFloat(dist.toFixed(2)),
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      `\n=== \u{1F687} Nearby Subway Stations (${nearby.length} within ${radius} mi) ===\n`,
    );
    for (const [dist, s] of nearby.slice(0, 20)) {
      console.log(
        `  \u{1F687} ${s.stop_name} \u2014 ${dist.toFixed(2)} mi`,
      );
      console.log(`     ID: ${s.stop_id}`);
      console.log();
    }
  } else {
    console.log('Provide --search <name> or --near LAT,LON');
  }
}

// ---- Bus Stops ----

async function cmdBusStops(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;

  if (opts.near) {
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

    const url = `${BUS_OBA_BASE}/stops-for-location.json?lat=${lat}&lon=${lon}&latSpan=0.005&lonSpan=0.005&key=${encodeURIComponent(MTA_BUS_API_KEY)}`;
    const data = await fetchJSON<ObaStopsForLocationResponse>(url);

    const stopsList = data?.data?.list;
    if (!stopsList || !stopsList.length) {
      console.log(`No bus stops found near (${lat}, ${lon}).`);
      return;
    }

    console.log(
      `\n=== Nearby Bus Stops (${stopsList.length} found) ===\n`,
    );
    for (const s of stopsList.slice(0, 20)) {
      const dist = haversine(lat, lon, s.lat, s.lon);
      const routes =
        s.routeIds
          ?.map((r) => r.replace(/^MTA NYCT_|^MTABC_/, ''))
          .join(', ') || '';
      console.log(`  ${s.name} \u2014 ${dist.toFixed(2)} mi`);
      console.log(
        `     ID: ${s.id}  |  Code: ${s.code || '?'}`,
      );
      if (routes) console.log(`     Routes: ${routes}`);
      console.log();
    }
  } else if (opts.route) {
    const route = opts.route;
    const url = `${BUS_OBA_BASE}/stops-for-route/MTA%20NYCT_${encodeURIComponent(route)}.json?key=${encodeURIComponent(MTA_BUS_API_KEY)}&includePolylines=false&version=2`;

    let data: ObaStopsForRouteResponse;
    try {
      data = await fetchJSON<ObaStopsForRouteResponse>(url);
    } catch {
      // Try MTABC agency prefix
      const url2 = `${BUS_OBA_BASE}/stops-for-route/MTABC_${encodeURIComponent(route)}.json?key=${encodeURIComponent(MTA_BUS_API_KEY)}&includePolylines=false&version=2`;
      data = await fetchJSON<ObaStopsForRouteResponse>(url2);
    }

    const stops =
      data?.data?.references?.stops || data?.data?.list;
    if (!stops || !stops.length) {
      console.log(`No stops found for route ${route}.`);
      return;
    }

    console.log(
      `\n=== Stops on Route ${route} (${stops.length} stops) ===\n`,
    );
    for (const s of stops) {
      console.log(`  ${s.name}`);
      console.log(
        `     ID: ${s.id}  |  Direction: ${s.direction || '?'}`,
      );
    }
  } else {
    console.log('Provide --near LAT,LON or --route ROUTE_ID');
  }
}

// ---- Route Info (subway line stops) ----

async function cmdRouteInfo(opts: CliOptions): Promise<void> {
  const lineFilter = opts.line;
  const jsonOutput = opts.json;
  if (!lineFilter) {
    console.log(
      'Provide --line with a subway line (e.g., A, 1, L)',
    );
    return;
  }

  const line = SUBWAY_LINES[lineFilter];
  if (!line) {
    console.log(`Unknown subway line: ${lineFilter}`);
    return;
  }

  if (!jsonOutput) {
    console.log(
      `\n=== \u{1F687} ${line.name} \u2014 ${line.route} ===`,
    );
    console.log(
      `    Color: ${line.color}  |  Terminals: ${line.terminals.join(' <-> ')}`,
    );
    console.log();
  }

  if (!ensureGtfs(GTFS_DIR, REFRESH_CMD)) return;

  const routes = loadRoutes(GTFS_DIR);
  const trips = loadTrips(GTFS_DIR);
  const stops = loadStops(GTFS_DIR);

  // Find route ID in GTFS
  const routeId = Object.keys(routes).find(
    (k) =>
      routes[k].route_short_name === lineFilter ||
      routes[k].route_id === lineFilter ||
      k === lineFilter,
  );

  if (!routeId) {
    // Fall back: list embedded station data for this line
    const lineStations = STATIONS.filter((s) =>
      s.lines.includes(lineFilter),
    );
    if (lineStations.length) {
      console.log('Stations (from embedded data):');
      for (const s of lineStations) {
        console.log(`  ${s.name} (ID: ${s.id})`);
      }
    } else {
      console.log(
        'No GTFS route data found. Try running refresh-gtfs.',
      );
    }
    return;
  }

  const routeTrips = Object.values(trips).filter(
    (t) => t.route_id === routeId,
  );
  if (!routeTrips.length) {
    console.log('No trips found for this line in GTFS data.');
    return;
  }

  const dir0 = routeTrips.filter(
    (t) => t.direction_id === '0',
  );
  const sampleTrip = (dir0.length ? dir0 : routeTrips)[0];
  const stopTimes = loadStopTimesForTrip(
    sampleTrip.trip_id,
    GTFS_DIR,
  );

  if (stopTimes.length) {
    if (jsonOutput) {
      const stopsList = stopTimes.map((st) => ({
        stopId: st.stop_id,
        name: stops[st.stop_id]?.stop_name || st.stop_id,
        sequence: parseInt(st.stop_sequence || '0'),
      }));
      console.log(
        JSON.stringify(
          {
            line: lineFilter,
            name: line.name,
            route: line.route,
            color: line.color,
            terminals: line.terminals,
            headsign: sampleTrip.trip_headsign || null,
            stops: stopsList,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(
        `Stops (${sampleTrip.trip_headsign || 'direction 0'}):`,
      );
      for (const st of stopTimes) {
        const sname =
          stops[st.stop_id]?.stop_name || st.stop_id;
        console.log(
          `  ${(st.stop_sequence || '').padStart(3)}. ${sname} (ID: ${st.stop_id})`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`NYC MTA Transit — OpenClaw Skill

Commands:
  arrivals        Subway arrivals (--station NAME | --stop-search NAME | --stop ID) [--line LINE]
  bus-arrivals    Bus predictions (--stop ID) [--route ROUTE]
  vehicles        Subway train positions (--line LINE)
  bus-vehicles    Bus positions (--route ROUTE)
  alerts          Service alerts [--subway] [--bus] [--line LINE]
  routes          List all subway lines
  bus-routes      List bus routes (requires API key)
  stops           Search subway stops (--search NAME | --near LAT,LON)
  bus-stops       Search bus stops (--near LAT,LON | --route ROUTE)
  route-info      Subway line details (--line LINE)
  refresh-gtfs    Download/refresh GTFS static data

Subway Lines: 1-7, A, C, E, B, D, F, M, G, J, Z, L, N, Q, R, W, S (shuttles), SIR

Options:
  --json          Output structured JSON instead of formatted text

Environment: MTA_BUS_API_KEY (free, for bus commands only — subway works without any key)`);
    return;
  }

  const rest = args.slice(1);

  const optDefs: Record<
    string,
    { type: 'string' | 'boolean' }
  > = {
    stop: { type: 'string' },
    'stop-search': { type: 'string' },
    station: { type: 'string' },
    line: { type: 'string' },
    route: { type: 'string' },
    search: { type: 'string' },
    near: { type: 'string' },
    radius: { type: 'string' },
    subway: { type: 'boolean' },
    bus: { type: 'boolean' },
    json: { type: 'boolean' },
    headsign: { type: 'string' },
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
    arrivals: () => cmdArrivals(opts),
    'bus-arrivals': () => cmdBusArrivals(opts),
    vehicles: () => cmdVehicles(opts),
    'bus-vehicles': () => cmdBusVehicles(opts),
    alerts: () => cmdAlerts(opts),
    routes: () => cmdRoutes(opts),
    'bus-routes': () => cmdBusRoutes(),
    stops: () => cmdStops(opts),
    'bus-stops': () => cmdBusStops(opts),
    'route-info': () => cmdRouteInfo(opts),
  };

  if (handlers[command]) {
    Promise.resolve(handlers[command]()).catch((err: any) => {
      if (
        err.name === 'TimeoutError' ||
        err.message?.includes('timeout')
      ) {
        console.error(
          'Request timed out. MTA feed may be slow or unreachable. Try again in a moment.',
        );
      } else if (
        err.code === 'ENOTFOUND' ||
        err.code === 'ECONNREFUSED'
      ) {
        console.error(
          'Network error: Could not reach MTA API. Check your internet connection.',
        );
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Run 'node scripts/mta.mjs --help' for available commands.",
    );
    process.exit(1);
  }
}

main();
