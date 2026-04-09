#!/usr/bin/env node
/**
 * CTA Chicago Transit — OpenClaw Skill
 * Real-time L train arrivals, bus predictions, service alerts, and route info.
 * Uses CTA's Train Tracker, Bus Tracker, and Customer Alerts APIs.
 *
 * SECURITY MANIFEST
 *   Environment variables: CTA_TRAIN_API_KEY, CTA_BUS_API_KEY
 *   External endpoints:    https://lapi.transitchicago.com (Train Tracker, key required)
 *                          https://www.ctabustracker.com (Bus Tracker, key required)
 *                          https://www.transitchicago.com (Alerts, no key; GTFS static, no key)
 *   Local files written:   ~/.cta/gtfs/ (GTFS static data cache)
 *   Local files read:      ~/.cta/gtfs/*.txt (GTFS CSV files)
 *   User input handling:   Used for local filtering only, never interpolated into
 *                          shell commands
 */

import { parseArgs } from 'node:util';

import { localNow, fmtTimeHM } from '../shared/time.js';
import { ensureGtfs } from '../shared/csv.js';
import { loadCsv } from '../shared/csv.js';
import { haversine } from '../shared/geo.js';
import { loadStops, loadRoutes, loadTrips, refreshGtfs } from '../shared/gtfs.js';

import {
  CTA_TRAIN_API_KEY,
  CTA_BUS_API_KEY,
  TRAIN_BASE,
  BUS_BASE,
  ALERTS_BASE,
  GTFS_STATIC_URL,
  GTFS_DIR,
  L_LINES,
  ROUTE_ALIASES,
  STATIONS,
  resolveTrainRoute,
  searchStation,
  parseCTATimestamp,
  requireTrainKey,
  requireBusKey,
  fetchJSON,
  handleCTAError,
  getRouteEmoji,
} from './client.js';

import type {
  CliOptions,
  LLineCode,
  TrainTrackerEta,
  TrainPosition,
  BusPrediction,
  BusVehicle,
  Alert,
  AlertService,
} from './types.js';

const TZ = 'US/Central' as const;

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// ---- Refresh GTFS ----

async function cmdRefreshGtfs(): Promise<void> {
  console.log(`Downloading GTFS static data to ${GTFS_DIR} ...`);
  await refreshGtfs(GTFS_STATIC_URL, GTFS_DIR, 120_000);
}

// ---- Train Arrivals ----

async function cmdArrivals(opts: CliOptions): Promise<void> {
  if (!requireTrainKey()) return;

  let mapid = opts.mapid;
  let stopId = opts.stop;
  const stationName = opts.station;
  const stopSearch = opts['stop-search'];
  const routeFilter = opts.route ? resolveTrainRoute(opts.route) : null;
  const headsignFilter = opts.headsign || null;
  const jsonOutput = opts.json;

  // Resolve station by name search
  if (stationName || stopSearch) {
    const query = (stationName || stopSearch)!;
    const matches = searchStation(query, routeFilter);
    if (!matches.length) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ error: `No stations found matching '${query}'` }),
        );
        return;
      }
      console.log(`No stations found matching '${query}'.`);
      console.log("Try 'stops --search <name>' to search all stops.");
      return;
    }
    if (matches.length > 1 && !jsonOutput) {
      console.log(`Found ${matches.length} stations matching '${query}':`);
      for (const s of matches.slice(0, 8)) {
        const lineStr = s.lines?.length ? ` (${s.lines.join(', ')})` : '';
        console.log(`  ${s.mapid} \u2014 ${s.name}${lineStr}`);
      }
      console.log(`\nUsing best match: ${matches[0].name}\n`);
    }
    mapid = matches[0].mapid;
  }

  if (!mapid && !stopId) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          error: 'Provide --station, --stop-search, --mapid, or --stop',
        }),
      );
      return;
    }
    console.log('Provide --station, --stop-search, --mapid, or --stop');
    return;
  }

  // Build URL
  let url: string;
  if (stopId) {
    url = `${TRAIN_BASE}/ttarrivals.aspx?key=${encodeURIComponent(CTA_TRAIN_API_KEY)}&stpid=${encodeURIComponent(stopId)}&max=15&outputType=JSON`;
  } else {
    url = `${TRAIN_BASE}/ttarrivals.aspx?key=${encodeURIComponent(CTA_TRAIN_API_KEY)}&mapid=${encodeURIComponent(mapid!)}&max=15&outputType=JSON`;
  }

  const data = await fetchJSON(url);
  if (handleCTAError(data, 'Train Tracker')) return;

  const arrivals = data?.ctatt?.eta;
  if (!arrivals || arrivals.length === 0) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({ station: mapid || stopId, arrivals: [] }),
      );
      return;
    }
    console.log('No upcoming train arrivals at this station.');
    return;
  }

  const arrList: TrainTrackerEta[] = Array.isArray(arrivals)
    ? arrivals
    : [arrivals];
  const stationLabel: string = arrList[0]?.staNm || mapid || stopId || '';

  // Filter by route if specified
  let filtered: TrainTrackerEta[] = routeFilter
    ? arrList.filter((a) => a.rt === routeFilter)
    : arrList;

  if (routeFilter && !filtered.length) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({
          station: stationLabel,
          error: `No arrivals for ${L_LINES[routeFilter as LLineCode]?.name || routeFilter}`,
        }),
      );
      return;
    }
    console.log(
      `No arrivals found for ${L_LINES[routeFilter as LLineCode]?.name || routeFilter} at this station.`,
    );
    return;
  }

  // Filter by headsign if specified
  if (headsignFilter) {
    const hLower = headsignFilter.toLowerCase();
    const headsignFiltered = filtered.filter((a) =>
      (a.destNm || '').toLowerCase().includes(hLower),
    );
    if (!headsignFiltered.length) {
      const availableHeadsigns = [
        ...new Set(filtered.map((a) => a.destNm).filter(Boolean)),
      ];
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            station: stationLabel,
            error: `No arrivals matching headsign '${headsignFilter}'`,
            availableHeadsigns,
          }),
        );
        return;
      }
      console.log(
        `No arrivals matching headsign '${headsignFilter}' at ${stationLabel}.`,
      );
      console.log(`Available headsigns: ${availableHeadsigns.join(', ')}`);
      return;
    }
    filtered = headsignFiltered;
  }

  if (jsonOutput) {
    const jsonArrivals = filtered.map((a) => {
      const arrTime = parseCTATimestamp(a.arrT);
      const isApproaching = a.isApp === '1';
      let minsAway: number | null = null;
      if (isApproaching) {
        minsAway = 0;
      } else if (arrTime) {
        const now = localNow(TZ);
        minsAway = Math.round((arrTime.getTime() - now.getTime()) / 60000);
      }
      return {
        line: L_LINES[a.rt as LLineCode]?.name || a.rt,
        routeCode: a.rt,
        destination: a.destNm || 'Unknown',
        arrivalTime: arrTime ? fmtTimeHM(arrTime) : null,
        minutesAway: minsAway,
        isApproaching,
        isDelayed: a.isDly === '1',
        runNumber: a.rn || null,
      };
    });
    console.log(JSON.stringify({ station: stationLabel, arrivals: jsonArrivals }));
    return;
  }

  console.log(`\n=== Train Arrivals at: ${stationLabel} ===\n`);

  for (const a of filtered) {
    const line = L_LINES[a.rt as LLineCode];
    const lineName = line ? line.name : a.rt;
    const dest = a.destNm || 'Unknown';
    const isApproaching = a.isApp === '1';
    const isDelayed = a.isDly === '1';

    const arrTime = parseCTATimestamp(a.arrT);

    let etaStr = '';
    if (isApproaching) {
      etaStr = 'Due';
    } else if (arrTime) {
      const now = localNow(TZ);
      const minsAway = Math.round(
        (arrTime.getTime() - now.getTime()) / 60000,
      );
      if (minsAway <= 1) etaStr = 'Due';
      else etaStr = `${minsAway} min`;
    }

    const timeStr = arrTime ? fmtTimeHM(arrTime) : '??';
    const delayStr = isDelayed ? ' (delayed)' : '';

    console.log(`  \u{1F687} ${lineName} toward ${dest}`);
    console.log(`     ${timeStr} (${etaStr})${delayStr}`);
    if (a.rn) console.log(`     Run #${a.rn}`);
    console.log();
  }
}

// ---- Bus Arrivals ----

async function cmdBusArrivals(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;

  let stopId = opts.stop;
  const stopSearch = opts['stop-search'];
  const routeFilter = opts.route;
  const headsignFilter = opts.headsign || null;
  const jsonOutput = opts.json;

  if (stopSearch) {
    if (!ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) return;
    const stops = loadStops(GTFS_DIR);
    const query = stopSearch.toLowerCase();
    const matches = Object.values(stops).filter((s) =>
      (s.stop_name || '').toLowerCase().includes(query),
    );
    if (!matches.length) {
      if (jsonOutput) {
        console.log(
          JSON.stringify({ error: `No stops found matching '${stopSearch}'` }),
        );
        return;
      }
      console.log(`No stops found matching '${stopSearch}'.`);
      return;
    }
    matches.sort((a, b) => {
      const an = (a.stop_name || '').toLowerCase();
      const bn = (b.stop_name || '').toLowerCase();
      if (an === query && bn !== query) return -1;
      if (bn === query && an !== query) return 1;
      return an.length - bn.length || an.localeCompare(bn);
    });
    if (matches.length > 1 && !jsonOutput) {
      console.log(`Found ${matches.length} stops matching '${stopSearch}':`);
      for (const s of matches.slice(0, 10)) {
        console.log(`  ${s.stop_id.padStart(6)} \u2014 ${s.stop_name}`);
      }
      console.log(`\nUsing best match: ${matches[0].stop_name}\n`);
    }
    stopId = matches[0].stop_id;
  }

  if (!stopId) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Provide --stop or --stop-search' }));
      return;
    }
    console.log('Provide --stop or --stop-search');
    return;
  }

  let url = `${BUS_BASE}/getpredictions?key=${encodeURIComponent(CTA_BUS_API_KEY)}&stpid=${encodeURIComponent(stopId)}&format=json`;
  if (routeFilter) {
    url += `&rt=${encodeURIComponent(routeFilter)}`;
  }

  const data = await fetchJSON(url);
  if (handleCTAError(data, 'Bus Tracker')) return;

  const preds = data?.['bustime-response']?.prd;
  if (!preds || preds.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ stop: stopId, predictions: [] }));
      return;
    }
    console.log('No upcoming bus predictions at this stop.');
    return;
  }

  let predList: BusPrediction[] = Array.isArray(preds) ? preds : [preds];
  const stopLabel: string = predList[0]?.stpnm || stopId;

  // Filter by headsign if specified
  if (headsignFilter) {
    const hLower = headsignFilter.toLowerCase();
    const headsignFiltered = predList.filter((p) =>
      (p.des || '').toLowerCase().includes(hLower),
    );
    if (!headsignFiltered.length) {
      const availableHeadsigns = [
        ...new Set(predList.map((p) => p.des).filter(Boolean)),
      ];
      if (jsonOutput) {
        console.log(
          JSON.stringify({
            stop: stopLabel,
            stopId,
            error: `No arrivals matching headsign '${headsignFilter}'`,
            availableHeadsigns,
          }),
        );
        return;
      }
      console.log(
        `No arrivals matching headsign '${headsignFilter}' at ${stopLabel}.`,
      );
      console.log(`Available headsigns: ${availableHeadsigns.join(', ')}`);
      return;
    }
    predList = headsignFiltered;
  }

  if (jsonOutput) {
    const jsonPreds = predList.map((p) => {
      const predTime = parseCTATimestamp(p.prdtm);
      const genTime = parseCTATimestamp(p.tmstmp);
      let minsAway = parseInt(p.prdctdn);
      if (isNaN(minsAway) && predTime && genTime) {
        minsAway = Math.round(
          (predTime.getTime() - genTime.getTime()) / 60000,
        );
      }
      return {
        route: p.rt || '?',
        direction: p.rtdir || '',
        destination: p.des || '',
        arrivalTime: predTime ? fmtTimeHM(predTime) : null,
        minutesAway: p.prdctdn === 'DUE' || minsAway <= 0 ? 0 : minsAway,
        isDelayed: p.dly === 'true',
        vehicleId: p.vid || null,
        type: (p.typ === 'A' ? 'arriving' : 'departing') as
          | 'arriving'
          | 'departing',
      };
    });
    console.log(
      JSON.stringify({ stop: stopLabel, stopId, predictions: jsonPreds }),
    );
    return;
  }

  console.log(
    `\n=== Bus Predictions at: ${stopLabel} (Stop ${stopId}) ===\n`,
  );

  for (const p of predList) {
    const route = p.rt || '?';
    const dir = p.rtdir || '';
    const dest = p.des || '';

    const predTime = parseCTATimestamp(p.prdtm);
    const genTime = parseCTATimestamp(p.tmstmp);
    let minsAway = parseInt(p.prdctdn);
    if (isNaN(minsAway) && predTime && genTime) {
      minsAway = Math.round(
        (predTime.getTime() - genTime.getTime()) / 60000,
      );
    }

    const etaStr =
      p.prdctdn === 'DUE' || minsAway <= 0
        ? 'Due'
        : minsAway === 1
          ? '1 min'
          : `${minsAway} min`;
    const timeStr = predTime ? fmtTimeHM(predTime) : '??';
    const delayed = p.dly === 'true' ? ' (delayed)' : '';

    console.log(`  \u{1F68C} Route ${route} ${dir} \u2192 ${dest}`);
    console.log(`     ${timeStr} (${etaStr})${delayed}`);
    if (p.vid) console.log(`     Vehicle #${p.vid}`);
    console.log();
  }
}

// ---- Train Vehicles (Positions) ----

async function cmdVehicles(opts: CliOptions): Promise<void> {
  if (!requireTrainKey()) return;
  const jsonOutput = opts.json;

  const routeCode = opts.route ? resolveTrainRoute(opts.route) : null;
  if (!routeCode) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Provide --route' }));
      return;
    }
    console.log(
      'Provide --route with an L line code (e.g., Red, Blue, Brn, G, Org, P, Pink, Y)',
    );
    return;
  }

  const line = L_LINES[routeCode as LLineCode];
  if (!line) {
    if (jsonOutput) {
      console.log(
        JSON.stringify({ error: `Unknown L line: ${opts.route}` }),
      );
      return;
    }
    console.log(`Unknown L line: ${opts.route}`);
    console.log(
      'Valid lines: Red, Blue, Brn (Brown), G (Green), Org (Orange), P (Purple), Pink, Y (Yellow)',
    );
    return;
  }

  const url = `${TRAIN_BASE}/ttpositions.aspx?key=${encodeURIComponent(CTA_TRAIN_API_KEY)}&rt=${encodeURIComponent(routeCode)}&outputType=JSON`;
  const data = await fetchJSON(url);
  if (handleCTAError(data, 'Train Tracker')) return;

  const routes = data?.ctatt?.route;
  if (!routes) {
    if (jsonOutput) {
      console.log(JSON.stringify({ line: line.name, trains: [] }));
      return;
    }
    console.log(`No position data available for ${line.name}.`);
    return;
  }

  const routeArr = Array.isArray(routes) ? routes : [routes];
  let allTrains: TrainPosition[] = [];
  for (const r of routeArr) {
    const trains = r.train;
    if (!trains) continue;
    const trainArr: TrainPosition[] = Array.isArray(trains)
      ? trains
      : [trains];
    allTrains = allTrains.concat(trainArr);
  }

  if (!allTrains.length) {
    if (jsonOutput) {
      console.log(JSON.stringify({ line: line.name, trains: [] }));
      return;
    }
    console.log(`No active trains on ${line.name}.`);
    return;
  }

  if (jsonOutput) {
    const jsonTrains = allTrains.map((t) => ({
      runNumber: t.rn || null,
      destination: t.destNm || 'Unknown',
      nextStation: t.nextStaNm || 'Unknown',
      isApproaching: t.isApp === '1',
      isDelayed: t.isDly === '1',
      lat: t.lat || null,
      lon: t.lon || null,
      heading: t.heading || null,
    }));
    console.log(
      JSON.stringify({
        line: line.name,
        count: allTrains.length,
        trains: jsonTrains,
      }),
    );
    return;
  }

  console.log(
    `\n=== ${line.name} Train Positions (${allTrains.length} active) ===\n`,
  );

  for (const t of allTrains) {
    const dest = t.destNm || 'Unknown';
    const nextSta = t.nextStaNm || 'Unknown';
    const isApp = t.isApp === '1';
    const isDly = t.isDly === '1';
    const lat = t.lat;
    const lon = t.lon;
    const heading = t.heading;

    let statusStr = '';
    if (isApp) statusStr = `Approaching ${nextSta}`;
    else statusStr = `En route to ${nextSta}`;
    if (isDly) statusStr += ' (delayed)';

    console.log(`  \u{1F687} Run #${t.rn} \u2192 ${dest}`);
    console.log(`     ${statusStr}`);
    if (lat && lon)
      console.log(
        `     Position: (${lat}, ${lon}) heading ${heading || '?'}\u00B0`,
      );
    console.log();
  }
}

// ---- Bus Vehicles ----

async function cmdBusVehicles(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;
  const jsonOutput = opts.json;

  const route = opts.route;
  if (!route) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Provide --route' }));
      return;
    }
    console.log(
      'Provide --route with a bus route number (e.g., 22, 36, 77)',
    );
    return;
  }

  const url = `${BUS_BASE}/getvehicles?key=${encodeURIComponent(CTA_BUS_API_KEY)}&rt=${encodeURIComponent(route)}&format=json`;
  const data = await fetchJSON(url);
  if (handleCTAError(data, 'Bus Tracker')) return;

  const vehicles = data?.['bustime-response']?.vehicle;
  if (!vehicles || vehicles.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ route, vehicles: [] }));
      return;
    }
    console.log(`No active buses on route ${route}.`);
    return;
  }

  const vList: BusVehicle[] = Array.isArray(vehicles)
    ? vehicles
    : [vehicles];

  if (jsonOutput) {
    const jsonVehicles = vList.map((v) => ({
      vehicleId: v.vid || null,
      direction: v.rtdir || '',
      destination: v.des || '',
      lat: v.lat || null,
      lon: v.lon || null,
      heading: v.hdg || null,
      speed: v.spd || null,
      isDelayed: v.dly === 'true',
      lastUpdate: v.tmstmp
        ? (() => {
            const t = parseCTATimestamp(v.tmstmp);
            return t ? fmtTimeHM(t) : v.tmstmp;
          })()
        : null,
    }));
    console.log(
      JSON.stringify({ route, count: vList.length, vehicles: jsonVehicles }),
    );
    return;
  }

  console.log(
    `\n=== Route ${route} Bus Positions (${vList.length} active) ===\n`,
  );

  for (const v of vList) {
    const vid = v.vid || '?';
    const dir = v.rtdir || '';
    const dest = v.des || '';
    const lat = v.lat;
    const lon = v.lon;
    const heading = v.hdg;
    const speed = v.spd;
    const delayed = v.dly === 'true' ? ' (delayed)' : '';

    const tsStr = v.tmstmp
      ? (() => {
          const t = parseCTATimestamp(v.tmstmp);
          return t ? fmtTimeHM(t) : v.tmstmp;
        })()
      : '';

    console.log(`  \u{1F68C} Vehicle #${vid} \u2014 ${dir}${delayed}`);
    if (dest) console.log(`     Destination: ${dest}`);
    if (lat && lon)
      console.log(
        `     Position: (${lat}, ${lon}) heading ${heading || '?'}\u00B0 @ ${speed || '?'} mph`,
      );
    if (tsStr) console.log(`     Last update: ${tsStr}`);
    console.log();
  }
}

// ---- Alerts ----

async function cmdAlerts(opts: CliOptions): Promise<void> {
  const routeFilter = opts.route;
  const jsonOutput = opts.json;

  let url = `${ALERTS_BASE}/alerts.aspx?outputType=JSON`;
  if (routeFilter) {
    const resolved = resolveTrainRoute(routeFilter);
    url += `&routeid=${encodeURIComponent(resolved || routeFilter)}`;
  }

  const data = await fetchJSON(url);

  const alerts = data?.CTAAlerts?.Alert;
  if (!alerts || alerts.length === 0) {
    const filterMsg = routeFilter ? ` for ${routeFilter}` : '';
    if (jsonOutput) {
      console.log(
        JSON.stringify({ alerts: [], filter: routeFilter || null }),
      );
      return;
    }
    console.log(`No active service alerts${filterMsg}.`);
    return;
  }

  const alertList: Alert[] = Array.isArray(alerts) ? alerts : [alerts];

  if (jsonOutput) {
    const jsonAlerts = alertList.map((a) => {
      const services = a.ImpactedService?.Service;
      const serviceList: AlertService[] = services
        ? Array.isArray(services)
          ? services
          : [services]
        : [];
      return {
        headline: a.Headline || '',
        shortDescription: a.ShortDescription || '',
        impact: a.Impact || '',
        severity: parseInt(a.SeverityScore) || 0,
        affectedRoutes: serviceList
          .map((s) => s.ServiceName || s.ServiceId || '')
          .filter(Boolean),
        eventStart: a.EventStart || null,
        eventEnd: a.EventEnd || null,
      };
    });
    console.log(
      JSON.stringify({ count: alertList.length, alerts: jsonAlerts }),
    );
    return;
  }

  console.log(
    `\n=== CTA Service Alerts (${alertList.length} active) ===\n`,
  );

  for (const a of alertList) {
    const headline = a.Headline || 'No headline';
    const shortDesc = a.ShortDescription || '';
    const impact = a.Impact || '';
    const severity = a.SeverityScore || '';

    const services = a.ImpactedService?.Service;
    const serviceList: AlertService[] = services
      ? Array.isArray(services)
        ? services
        : [services]
      : [];
    const affected = serviceList
      .map((s) => s.ServiceName || s.ServiceId || '')
      .filter(Boolean);

    const eventStart = a.EventStart || '';
    const eventEnd = a.EventEnd || '';

    let severityIcon = '';
    const severityNum = parseInt(severity) || 0;
    if (severityNum >= 70) severityIcon = '\u{1F534}';
    else if (severityNum >= 40) severityIcon = '\u{1F7E1}';
    else severityIcon = '\u{1F7E2}';

    console.log(`${severityIcon} ${headline}`);
    if (affected.length)
      console.log(`   Routes: ${affected.join(', ')}`);
    if (impact) console.log(`   Impact: ${impact}`);
    if (eventStart || eventEnd)
      console.log(
        `   Period: ${eventStart} \u2014 ${eventEnd || 'ongoing'}`,
      );
    if (shortDesc) {
      let desc = shortDesc;
      if (desc.length > 300) desc = desc.slice(0, 300) + '...';
      console.log(`   ${desc}`);
    }
    console.log();
  }
}

// ---- Routes ----

async function cmdRoutes(opts: CliOptions): Promise<void> {
  const jsonOutput = opts.json;

  if (jsonOutput) {
    const lLines = Object.entries(L_LINES).map(([code, line]) => ({
      code,
      name: line.name,
      emoji: '\u{1F687}',
      terminals: line.terminals,
    }));
    let busRouteList: { id: string; name: string; emoji: string }[] = [];
    if (ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) {
      const routes = loadRoutes(GTFS_DIR);
      busRouteList = Object.values(routes)
        .filter((r) => r.route_type === '3')
        .sort(
          (a, b) =>
            (parseInt(a.route_short_name) || 9999) -
            (parseInt(b.route_short_name) || 9999),
        )
        .map((r) => ({
          id: r.route_short_name || r.route_id,
          name: r.route_long_name || '',
          emoji: '\u{1F68C}',
        }));
    }
    console.log(JSON.stringify({ lLines, busRoutes: busRouteList }));
    return;
  }

  // Show L lines (always available)
  console.log('\n=== CTA L Train Lines ===\n');
  for (const [code, line] of Object.entries(L_LINES)) {
    console.log(
      `  \u{1F687} ${code.padEnd(5)} | ${line.name.padEnd(13)} | ${line.terminals.join(' \u2194 ')}`,
    );
  }

  // Show bus routes from GTFS if available
  if (ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) {
    const routes = loadRoutes(GTFS_DIR);
    const busRoutes = Object.values(routes).filter(
      (r) => r.route_type === '3',
    );

    console.log(`\n=== CTA Bus Routes (${busRoutes.length}) ===\n`);
    busRoutes.sort((a, b) => {
      const an = parseInt(a.route_short_name) || 9999;
      const bn = parseInt(b.route_short_name) || 9999;
      return (
        an - bn || a.route_short_name.localeCompare(b.route_short_name)
      );
    });
    for (const r of busRoutes) {
      const short = (r.route_short_name || r.route_id).padStart(5);
      const longName = r.route_long_name || '';
      console.log(`  \u{1F68C} ${short} | ${longName}`);
    }
  }
}

async function cmdBusRoutes(opts: CliOptions): Promise<void> {
  if (!requireBusKey()) return;
  const jsonOutput = opts.json;

  const url = `${BUS_BASE}/getroutes?key=${encodeURIComponent(CTA_BUS_API_KEY)}&format=json`;
  const data = await fetchJSON(url);
  if (handleCTAError(data, 'Bus Tracker')) return;

  const routes = data?.['bustime-response']?.routes;
  if (!routes || routes.length === 0) {
    if (jsonOutput) {
      console.log(JSON.stringify({ routes: [] }));
      return;
    }
    console.log('No bus routes found.');
    return;
  }

  const routeList = Array.isArray(routes) ? routes : [routes];

  if (jsonOutput) {
    const jsonRoutes = routeList.map(
      (r: { rt?: string; rtnm?: string; rtclr?: string }) => ({
        id: r.rt || '?',
        name: r.rtnm || '',
        color: r.rtclr || null,
      }),
    );
    console.log(
      JSON.stringify({ count: routeList.length, routes: jsonRoutes }),
    );
    return;
  }

  console.log(`\n=== CTA Bus Routes (${routeList.length}) ===\n`);

  for (const r of routeList) {
    const num = (r.rt || '?').padStart(5);
    const name = r.rtnm || '';
    const color = r.rtclr ? ` [${r.rtclr}]` : '';
    console.log(`  \u{1F68C} ${num} | ${name}${color}`);
  }
}

// ---- Stops ----

function cmdStops(opts: CliOptions): void {
  if (!ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) return;
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
          JSON.stringify({ query: opts.search, stops: [] }),
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
            desc: s.stop_desc || null,
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
    if (isNaN(radius) || radius <= 0) {
      console.log('Invalid --radius value. Must be a positive number (miles).');
      return;
    }

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
        console.log(JSON.stringify({ lat, lon, radius, stops: [] }));
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
            distance: parseFloat(dist.toFixed(3)),
            lat: s.stop_lat,
            lon: s.stop_lon,
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
    console.log('Provide --search <name> or --near LAT,LON');
  }
}

// ---- Route Info ----

async function cmdRouteInfo(opts: CliOptions): Promise<void> {
  const routeInput = opts.route;
  const jsonOutput = opts.json;
  if (!routeInput) {
    if (jsonOutput) {
      console.log(JSON.stringify({ error: 'Provide --route' }));
      return;
    }
    console.log(
      'Provide --route with a line code (Red, Blue, etc.) or bus route number.',
    );
    return;
  }

  // Check if it's an L line
  const resolved = resolveTrainRoute(routeInput);
  if (resolved && L_LINES[resolved as LLineCode]) {
    // Use GTFS for stop list
    if (!ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) return;
    const routes = loadRoutes(GTFS_DIR);
    const trips = loadTrips(GTFS_DIR);
    const stops = loadStops(GTFS_DIR);
    const line = L_LINES[resolved as LLineCode];

    console.log(`\n=== ${line.name} ===`);
    console.log(
      `    Code: ${resolved}  |  Terminals: ${line.terminals.join(' \u2194 ')}`,
    );
    console.log();

    // Find a trip for this route to get stop sequence
    const routeTrips = Object.values(trips).filter((t) => {
      const rShort = routes[t.route_id]?.route_short_name || '';
      return (
        rShort === resolved ||
        t.route_id === resolved ||
        rShort === line.name
      );
    });

    if (routeTrips.length) {
      const dir0 = routeTrips.filter((t) => t.direction_id === '0');
      const sampleTrip = (dir0.length ? dir0 : routeTrips)[0];
      const stopTimes = loadStopTimesForTrip(sampleTrip.trip_id);

      if (stopTimes.length) {
        console.log(
          `Stops (${sampleTrip.trip_headsign || 'direction 0'}):`,
        );
        for (const st of stopTimes) {
          const sname = stops[st.stop_id]?.stop_name || st.stop_id;
          console.log(
            `  ${(st.stop_sequence || '').padStart(3)}. ${sname} (ID: ${st.stop_id})`,
          );
        }
      }
    } else {
      console.log('No trip data found in GTFS. Try running refresh-gtfs.');
    }
    return;
  }

  // Must be a bus route — try Bus Tracker API for directions and stops
  if (!requireBusKey()) {
    // Fall back to GTFS
    if (!ensureGtfs(GTFS_DIR, 'node scripts/cta.mjs refresh-gtfs')) return;
    const routes = loadRoutes(GTFS_DIR);
    const trips = loadTrips(GTFS_DIR);
    const stops = loadStops(GTFS_DIR);

    const routeId = Object.keys(routes).find(
      (k) =>
        routes[k].route_short_name === routeInput || k === routeInput,
    );
    if (!routeId) {
      console.log(`Route '${routeInput}' not found.`);
      return;
    }
    const r = routes[routeId];
    console.log(
      `\n=== Route ${r.route_short_name || routeId} \u2014 ${r.route_long_name || ''} ===\n`,
    );

    const routeTrips = Object.values(trips).filter(
      (t) => t.route_id === routeId,
    );
    if (routeTrips.length) {
      const dir0 = routeTrips.filter((t) => t.direction_id === '0');
      const sampleTrip = (dir0.length ? dir0 : routeTrips)[0];
      const stopTimes = loadStopTimesForTrip(sampleTrip.trip_id);
      if (stopTimes.length) {
        console.log(`Stops (${sampleTrip.trip_headsign || ''}):`);
        for (const st of stopTimes) {
          const sname = stops[st.stop_id]?.stop_name || st.stop_id;
          console.log(
            `  ${(st.stop_sequence || '').padStart(3)}. ${sname} (ID: ${st.stop_id})`,
          );
        }
      }
    }
    return;
  }

  // Use Bus Tracker API
  const dirUrl = `${BUS_BASE}/getdirections?key=${encodeURIComponent(CTA_BUS_API_KEY)}&rt=${encodeURIComponent(routeInput)}&format=json`;
  const dirData = await fetchJSON(dirUrl);
  if (handleCTAError(dirData, 'Bus Tracker')) return;

  const directions = dirData?.['bustime-response']?.directions;
  if (!directions) {
    console.log(
      `Route '${routeInput}' not found or no direction data available.`,
    );
    return;
  }

  const dirList = Array.isArray(directions) ? directions : [directions];
  console.log(`\n=== Route ${routeInput} ===\n`);

  for (const dir of dirList) {
    const dirName = dir.dir || dir;
    console.log(`Direction: ${dirName}`);

    const stopsUrl = `${BUS_BASE}/getstops?key=${encodeURIComponent(CTA_BUS_API_KEY)}&rt=${encodeURIComponent(routeInput)}&dir=${encodeURIComponent(dirName)}&format=json`;
    const stopsData = await fetchJSON(stopsUrl);
    if (handleCTAError(stopsData, 'Bus Tracker')) continue;

    const stopsList = stopsData?.['bustime-response']?.stops;
    if (!stopsList) continue;

    const stopsArr = Array.isArray(stopsList) ? stopsList : [stopsList];
    for (const s of stopsArr) {
      const sid: string = s.stpid || '?';
      const sname: string = s.stpnm || '?';
      console.log(`  ${sid.padStart(6)} \u2014 ${sname}`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Helper — load stop_times for a specific trip (used by route-info)
// ---------------------------------------------------------------------------
function loadStopTimesForTrip(
  tripId: string,
): Record<string, string>[] {
  const rows = loadCsv('stop_times.txt', GTFS_DIR);
  return rows
    .filter((r) => r.trip_id === tripId)
    .sort(
      (a, b) =>
        parseInt(a.stop_sequence || '0') -
        parseInt(b.stop_sequence || '0'),
    );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(`CTA Chicago Transit \u2014 OpenClaw Skill

Commands:
  arrivals        Train arrivals (--station NAME | --stop-search NAME | --mapid ID | --stop ID) [--route LINE] [--headsign DIR]
  bus-arrivals    Bus predictions (--stop ID | --stop-search NAME) [--route NUM] [--headsign DIR]
  vehicles        Live train positions (--route LINE)
  bus-vehicles    Live bus positions (--route NUM)
  alerts          Service alerts [--route ID]
  routes          List all CTA routes (L lines + bus)
  bus-routes      List all bus routes (from Bus Tracker API)
  stops           Search stops (--search NAME | --near LAT,LON [--radius MI])
  route-info      Route details and stops (--route LINE_OR_NUM)
  refresh-gtfs    Download/refresh GTFS static data

Global Options:
  --json          Output structured JSON instead of formatted text
  --headsign DIR  Filter arrivals by headsign/destination (arrivals, bus-arrivals)

L Lines: Red, Blue, Brn (Brown), G (Green), Org (Orange), P (Purple), Pink, Y (Yellow)

Environment: CTA_TRAIN_API_KEY, CTA_BUS_API_KEY (free, from transitchicago.com)`);
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
    station: { type: 'string' },
    mapid: { type: 'string' },
    search: { type: 'string' },
    near: { type: 'string' },
    radius: { type: 'string' },
    headsign: { type: 'string' },
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
    arrivals: () => cmdArrivals(opts),
    'bus-arrivals': () => cmdBusArrivals(opts),
    vehicles: () => cmdVehicles(opts),
    'bus-vehicles': () => cmdBusVehicles(opts),
    alerts: () => cmdAlerts(opts),
    routes: () => cmdRoutes(opts),
    'bus-routes': () => cmdBusRoutes(opts),
    stops: () => cmdStops(opts),
    'route-info': () => cmdRouteInfo(opts),
  };

  if (handlers[command]) {
    Promise.resolve(handlers[command]()).catch((err: any) => {
      if (
        err.name === 'TimeoutError' ||
        err.message?.includes('timeout')
      ) {
        console.error(
          'Request timed out. CTA API may be slow or unreachable. Try again in a moment.',
        );
      } else if (
        err.code === 'ENOTFOUND' ||
        err.code === 'ECONNREFUSED'
      ) {
        console.error(
          'Network error: Could not reach CTA API. Check your internet connection.',
        );
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error(
      "Run 'node scripts/cta.mjs --help' for available commands.",
    );
    process.exit(1);
  }
}

// Run CLI when executed directly
const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();

// Exports for testing
export {
  parseCTATimestamp,
  resolveTrainRoute,
  searchStation,
  STATIONS,
  getRouteEmoji,
  main,
  cmdArrivals,
  cmdBusArrivals,
  cmdVehicles,
  cmdBusVehicles,
  cmdAlerts,
  cmdRoutes,
  cmdBusRoutes,
  cmdStops,
  cmdRouteInfo,
  cmdRefreshGtfs,
};
