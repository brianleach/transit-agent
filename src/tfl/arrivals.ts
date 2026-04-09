#!/usr/bin/env node
/**
 * TfL London Transit — CLI Entry Point
 * Real-time Tube arrivals, bus predictions, line status, disruptions,
 * journey planning, and route info for the London Underground, DLR,
 * Overground, Elizabeth line, buses, and trams.
 *
 * SECURITY MANIFEST
 *   Environment variables: TFL_API_KEY (optional -- API works without it, rate-limited)
 *   External endpoints:    api.tfl.gov.uk (TfL Unified API, read-only GET, JSON)
 *   Local files written:   None
 *   Local files read:      .env (if present, for API key)
 *   User input handling:   Used for local filtering and URL query parameters only,
 *                          never interpolated into shell commands
 */

import { parseArgs } from 'node:util';
import { fmtTime24, toLocalDate } from '../shared/time.js';

import type {
  CliOptions,
  TflArrival,
  TflLineStatus,
  TflDisruption,
  TflStopPoint,
  TflSearchResponse,
  TflNearbyResponse,
  TflRouteSequenceResponse,
  TflJourneyResponse,
  TflBusRoute,
} from './types.js';

import {
  noteApiKey,
  apiUrl,
  fetchTfl,
  TUBE_LINES,
  OTHER_LINES,
  lineEmoji,
  lineName,
  resolveLineId,
  searchStation,
} from './client.js';

// ---------------------------------------------------------------------------
// JSON output mode
// ---------------------------------------------------------------------------
let JSON_MODE = false;

function outputJSON(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ---------------------------------------------------------------------------
// Time helpers (London timezone)
// ---------------------------------------------------------------------------
function toLondonDate(d: Date): Date {
  return toLocalDate(d, 'Europe/London');
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

// ---- Line Status ----

async function cmdStatus(opts: CliOptions): Promise<void> {
  noteApiKey();
  const lineId = opts.line ? resolveLineId(opts.line) : null;
  const showAll = opts.all;

  let url: string;
  if (lineId) {
    url = apiUrl(`/Line/${encodeURIComponent(lineId)}/Status`);
  } else if (showAll) {
    url = apiUrl('/Line/Mode/tube,dlr,overground,elizabeth-line,tram/Status');
  } else {
    url = apiUrl('/Line/Mode/tube/Status');
  }

  const data = await fetchTfl<TflLineStatus[]>(url);
  if (!data || data.length === 0) {
    if (JSON_MODE) return outputJSON({ lines: [], error: 'No line status data available' });
    console.log('No line status data available.');
    return;
  }

  const lines: TflLineStatus[] = Array.isArray(data) ? data : [data];

  if (JSON_MODE) {
    const result = lines.map((line) => ({
      id: line.id,
      name: line.name || line.id,
      statuses: (line.lineStatuses || []).map((s) => ({
        severity: s.statusSeverityDescription || 'Unknown',
        severityLevel: s.statusSeverity,
        reason: s.reason || null,
      })),
    }));
    return outputJSON({ lines: result });
  }

  const headerEmoji = lineId ? lineEmoji(lineId) : '\u{1F687}';
  const label = lineId
    ? `${lineName(lineId)} Status`
    : showAll
      ? 'All TfL Lines Status'
      : 'Tube Status';
  console.log(`\n${headerEmoji} === ${label} ===\n`);

  for (const line of lines) {
    const id = line.id || '';
    const name = line.name || id;
    const emoji = lineEmoji(id);
    const statuses = line.lineStatuses || [];

    for (const status of statuses) {
      const severity = status.statusSeverityDescription || 'Unknown';
      const reason = status.reason || '';

      let icon = '';
      if (severity === 'Good Service') icon = '\u2705';
      else if (severity === 'Minor Delays') icon = '\u{1F7E1}';
      else if (severity.includes('Severe') || severity.includes('Suspended'))
        icon = '\u{1F534}';
      else if (severity.includes('Part')) icon = '\u{1F7E0}';
      else if (severity === 'Service Closed') icon = '\u26AB';
      else icon = '\u{1F7E1}';

      console.log(`${emoji} ${name}: ${icon} ${severity}`);
      if (reason) {
        const shortReason = reason.length > 300 ? reason.slice(0, 300) + '...' : reason;
        console.log(`   ${shortReason}`);
      }
    }
  }
}

// ---- Arrivals ----

async function cmdArrivals(opts: CliOptions): Promise<void> {
  noteApiKey();
  let naptanId = opts.stop;
  const stopSearch = opts['stop-search'];
  const stationName = opts.station;
  const lineFilter = opts.line ? resolveLineId(opts.line) : null;

  // Resolve station by name search
  if (stationName || stopSearch) {
    const query = (stationName || stopSearch)!;
    const localMatches = searchStation(query);

    if (localMatches.length) {
      if (localMatches.length > 1) {
        console.log(`Found ${localMatches.length} stations matching '${query}':`);
        for (const s of localMatches.slice(0, 8)) {
          console.log(`  ${s.naptanId} \u2014 ${s.name}`);
        }
        console.log(`\nUsing best match: ${localMatches[0].name}\n`);
      }
      naptanId = localMatches[0].naptanId;
    } else {
      // Fall back to TfL search API
      console.log(`Searching TfL for '${query}'...`);
      const searchUrl = apiUrl(
        `/StopPoint/Search/${encodeURIComponent(query)}?modes=tube,dlr,overground,elizabeth-line,tram`,
      );
      const searchData = await fetchTfl<TflSearchResponse>(searchUrl);
      const matches = searchData?.matches || [];
      if (!matches.length) {
        console.log(`No stations found matching '${query}'.`);
        console.log("Try 'stops --search <name>' to search all stops.");
        return;
      }
      if (matches.length > 1) {
        console.log(`Found ${matches.length} stations matching '${query}':`);
        for (const s of matches.slice(0, 8)) {
          console.log(`  ${s.id} \u2014 ${s.name}`);
        }
        console.log(`\nUsing best match: ${matches[0].name}\n`);
      }
      naptanId = matches[0].id;
    }
  }

  if (!naptanId) {
    console.log('Provide --station, --stop-search, or --stop');
    return;
  }

  const url = apiUrl(`/StopPoint/${encodeURIComponent(naptanId)}/Arrivals`);
  const data = await fetchTfl<TflArrival[]>(url);

  if (!data || data.length === 0) {
    console.log(
      `No arrivals at ${naptanId}. Station may be closed or have no active service.`,
    );
    return;
  }

  let arrivals: TflArrival[] = Array.isArray(data) ? data : [data];

  // Filter by line if specified
  if (lineFilter) {
    arrivals = arrivals.filter((a) => a.lineId === lineFilter);
    if (!arrivals.length) {
      console.log(`No arrivals for ${lineName(lineFilter)} at this station.`);
      return;
    }
  }

  // Sort by timeToStation
  arrivals.sort((a, b) => (a.timeToStation || 0) - (b.timeToStation || 0));

  const stationLabel = arrivals[0]?.stationName || naptanId;

  if (JSON_MODE) {
    const result = arrivals.slice(0, 20).map((a) => ({
      line: a.lineName || a.lineId || null,
      lineId: a.lineId || null,
      destination: a.destinationName || a.towards || null,
      minutesAway: Math.round((a.timeToStation || 0) / 60),
      expectedArrival: a.expectedArrival || null,
      platform: a.platformName || null,
      currentLocation: a.currentLocation || null,
    }));
    return outputJSON({ station: stationLabel, naptanId, arrivals: result });
  }

  console.log(`\n\u{1F687} === Arrivals at: ${stationLabel} ===\n`);

  for (const a of arrivals.slice(0, 20)) {
    const emoji = lineEmoji(a.lineId || '');
    const name = a.lineName || a.lineId || '?';
    const dest = a.destinationName || a.towards || 'Unknown';
    const secs = a.timeToStation || 0;
    const mins = Math.round(secs / 60);
    const platform = a.platformName || '';

    let etaStr: string;
    if (mins <= 0) etaStr = 'Due';
    else if (mins === 1) etaStr = '1 min';
    else etaStr = `${mins} min`;

    const expectedTime = a.expectedArrival
      ? fmtTime24(toLondonDate(new Date(a.expectedArrival)))
      : '';

    console.log(`  ${emoji} ${name} \u2192 ${dest}`);
    console.log(
      `     ${expectedTime ? expectedTime + ' ' : ''}(${etaStr})${platform ? ' \u2014 ' + platform : ''}`,
    );
    if (a.currentLocation) console.log(`     ${a.currentLocation}`);
    console.log();
  }
}

// ---- Bus Arrivals ----

async function cmdBusArrivals(opts: CliOptions): Promise<void> {
  noteApiKey();
  let stopId = opts.stop;
  const stopSearch = opts['stop-search'];
  const routeFilter = opts.route;

  if (stopSearch) {
    console.log(`Searching TfL for bus stops matching '${stopSearch}'...`);
    const searchUrl = apiUrl(
      `/StopPoint/Search/${encodeURIComponent(stopSearch)}?modes=bus`,
    );
    const searchData = await fetchTfl<TflSearchResponse>(searchUrl);
    const matches = searchData?.matches || [];
    if (!matches.length) {
      console.log(`No bus stops found matching '${stopSearch}'.`);
      return;
    }
    if (matches.length > 1) {
      console.log(`Found ${matches.length} stops matching '${stopSearch}':`);
      for (const s of matches.slice(0, 10)) {
        console.log(`  ${s.id} \u2014 ${s.name}`);
      }
      console.log(`\nUsing best match: ${matches[0].name}\n`);
    }
    stopId = matches[0].id;
  }

  if (!stopId) {
    console.log('Provide --stop or --stop-search');
    return;
  }

  const url = apiUrl(`/StopPoint/${encodeURIComponent(stopId)}/Arrivals`);
  const data = await fetchTfl<TflArrival[]>(url);

  if (!data || data.length === 0) {
    console.log(`No bus arrivals at stop ${stopId}.`);
    return;
  }

  let arrivals: TflArrival[] = Array.isArray(data) ? data : [data];

  // Filter to bus mode
  arrivals = arrivals.filter((a) => a.modeName === 'bus');

  // Filter by route if specified
  if (routeFilter) {
    arrivals = arrivals.filter(
      (a) => a.lineName === routeFilter || a.lineId === routeFilter,
    );
    if (!arrivals.length) {
      console.log(`No arrivals for route ${routeFilter} at this stop.`);
      return;
    }
  }

  arrivals.sort((a, b) => (a.timeToStation || 0) - (b.timeToStation || 0));

  const stopLabel = arrivals[0]?.stationName || stopId;

  if (JSON_MODE) {
    const result = arrivals.slice(0, 20).map((a) => ({
      route: a.lineName || a.lineId || null,
      destination: a.destinationName || a.towards || null,
      minutesAway: Math.round((a.timeToStation || 0) / 60),
      expectedArrival: a.expectedArrival || null,
    }));
    return outputJSON({ stop: stopLabel, stopId, arrivals: result });
  }

  console.log(`\n\u{1F68C} === Bus Arrivals at: ${stopLabel} (${stopId}) ===\n`);

  for (const a of arrivals.slice(0, 20)) {
    const route = a.lineName || a.lineId || '?';
    const dest = a.destinationName || a.towards || 'Unknown';
    const secs = a.timeToStation || 0;
    const mins = Math.round(secs / 60);

    let etaStr: string;
    if (mins <= 0) etaStr = 'Due';
    else if (mins === 1) etaStr = '1 min';
    else etaStr = `${mins} min`;

    const expectedTime = a.expectedArrival
      ? fmtTime24(toLondonDate(new Date(a.expectedArrival)))
      : '';

    console.log(`  \u{1F68C} Route ${route} \u2192 ${dest}`);
    console.log(`     ${expectedTime ? expectedTime + ' ' : ''}(${etaStr})`);
    console.log();
  }
}

// ---- Disruptions ----

async function cmdDisruptions(opts: CliOptions): Promise<void> {
  noteApiKey();
  const lineId = opts.line ? resolveLineId(opts.line) : null;

  let url: string;
  if (lineId) {
    url = apiUrl(`/Line/${encodeURIComponent(lineId)}/Disruption`);
  } else {
    // Get disruptions for all Tube + rail lines
    // TfL expects comma-separated line IDs unencoded in the path
    const allLineIds = [
      ...Object.keys(TUBE_LINES),
      ...Object.keys(OTHER_LINES),
    ].join(',');
    url = apiUrl(`/Line/${allLineIds}/Disruption`);
  }

  const data = await fetchTfl<TflDisruption[]>(url);

  if (!data || data.length === 0) {
    const filterMsg = lineId ? ` on ${lineName(lineId)}` : '';
    console.log(`No active disruptions${filterMsg}.`);
    return;
  }

  const disruptions: TflDisruption[] = Array.isArray(data) ? data : [data];

  if (JSON_MODE) {
    const result = disruptions.map((d) => ({
      category: d.category || null,
      categoryDescription: d.categoryDescription || d.category || null,
      description: d.description || null,
      closureText: d.closureText || null,
      affectedLines: (d.affectedRoutes || []).map((r) => r.name).filter(Boolean),
    }));
    return outputJSON({ disruptions: result, count: result.length });
  }

  const label = lineId ? `${lineName(lineId)} Disruptions` : 'TfL Disruptions';
  console.log(`\n\u26A0\uFE0F === ${label} (${disruptions.length} active) ===\n`);

  for (const d of disruptions) {
    const category = d.category || '';
    const desc = d.description || '';
    const affectedLines = (d.affectedRoutes || [])
      .map((r) => r.name)
      .filter(Boolean);
    const closureText = d.closureText || '';

    const categoryDesc = d.categoryDescription || category || 'Disruption';

    let icon = '\u{1F7E1}';
    if (category === 'RealTime' || categoryDesc.includes('Severe')) icon = '\u{1F534}';
    else if (category === 'PlannedWork') icon = '\u{1F7E0}';
    else if (category === 'Information') icon = '\u{1F535}';

    console.log(`${icon} ${categoryDesc}`);
    if (affectedLines.length) console.log(`   Lines: ${affectedLines.join(', ')}`);
    if (closureText && closureText !== categoryDesc) console.log(`   ${closureText}`);
    if (desc) {
      const shortDesc = desc.length > 400 ? desc.slice(0, 400) + '...' : desc;
      console.log(`   ${shortDesc}`);
    }
    console.log();
  }
}

// ---- Routes ----

async function cmdRoutes(opts: CliOptions): Promise<void> {
  const showAll = opts.all;

  if (JSON_MODE) {
    const result: Record<string, unknown> = {
      tube: Object.entries(TUBE_LINES).map(([id, line]) => ({
        id,
        name: line.name,
        terminals: line.terminals,
      })),
    };
    if (showAll) {
      result.other = Object.entries(OTHER_LINES).map(([id, line]) => ({
        id,
        name: line.name,
        type: line.type,
      }));
    }
    return outputJSON(result);
  }

  console.log('\n\u{1F687} === Tube Lines ===\n');
  for (const [_id, line] of Object.entries(TUBE_LINES)) {
    console.log(`  ${line.emoji} ${line.name.padEnd(20)} ${line.terminals.join(' \u2194 ')}`);
  }

  if (showAll) {
    console.log('\n\u{1F686} === Other TfL Rail ===\n');
    for (const [_id, line] of Object.entries(OTHER_LINES)) {
      console.log(`  ${line.emoji} ${line.name.padEnd(20)} ${line.type}`);
    }
  }
}

// ---- Bus Routes ----

async function cmdBusRoutes(_opts: CliOptions): Promise<void> {
  noteApiKey();
  console.log('Fetching bus routes from TfL...');
  const url = apiUrl('/Line/Mode/bus');
  const data = await fetchTfl<TflBusRoute[]>(url);

  if (!data || data.length === 0) {
    console.log('No bus routes found.');
    return;
  }

  const routes: TflBusRoute[] = Array.isArray(data) ? data : [data];
  routes.sort((a, b) => {
    const an = parseInt(a.name || '') || 9999;
    const bn = parseInt(b.name || '') || 9999;
    return an - bn || (a.name || '').localeCompare(b.name || '');
  });

  if (JSON_MODE) {
    const result = routes.map((r) => ({ name: r.name || r.id, id: r.id }));
    return outputJSON({ routes: result, count: result.length });
  }

  console.log(`\n\u{1F68C} === TfL Bus Routes (${routes.length}) ===\n`);

  for (const r of routes) {
    console.log(`  ${(r.name || r.id || '?').padStart(5)} | ${r.id}`);
  }
}

// ---- Stops ----

async function cmdStops(opts: CliOptions): Promise<void> {
  noteApiKey();
  const searchQuery = opts.search;
  const near = opts.near;
  const lineId = opts.line ? resolveLineId(opts.line) : null;
  const radius = opts.radius ? parseInt(opts.radius) : 500;

  if (lineId) {
    // List stops on a line
    const url = apiUrl(`/Line/${encodeURIComponent(lineId)}/StopPoints`);
    const data = await fetchTfl<TflStopPoint[]>(url);

    if (!data || data.length === 0) {
      if (JSON_MODE) return outputJSON({ stops: [], line: lineId });
      console.log(`No stops found for ${lineName(lineId)}.`);
      return;
    }

    const stops: TflStopPoint[] = Array.isArray(data) ? data : [data];

    if (JSON_MODE) {
      const result = stops.map((s) => ({
        name: s.commonName || s.id,
        naptanId: s.naptanId || s.id,
        lat: s.lat,
        lon: s.lon,
      }));
      return outputJSON({ line: lineName(lineId), stops: result });
    }

    console.log(
      `\n\u{1F4CD} === Stops on ${lineName(lineId)} (${stops.length}) ===\n`,
    );
    for (const s of stops) {
      console.log(`  \u{1F4CD} ${s.commonName || s.id}`);
      console.log(`     ID: ${s.naptanId || s.id}  |  (${s.lat}, ${s.lon})`);
      console.log();
    }
    return;
  }

  if (searchQuery) {
    // First try embedded stations
    const localMatches = searchStation(searchQuery);

    // Also search TfL API for more results
    const searchUrl = apiUrl(
      `/StopPoint/Search/${encodeURIComponent(searchQuery)}?modes=tube,bus,dlr,overground,elizabeth-line,tram`,
    );
    const searchData = await fetchTfl<TflSearchResponse>(searchUrl);
    const matches = searchData?.matches || [];
    const localIds = new Set(localMatches.map((s) => s.naptanId));
    const apiOnly = matches.filter((m) => !localIds.has(m.id || ''));

    if (JSON_MODE) {
      const result = [
        ...localMatches
          .slice(0, 20)
          .map((s) => ({ name: s.name, naptanId: s.naptanId, source: 'local' as const })),
        ...apiOnly.slice(0, 15).map((s) => ({
          name: s.name,
          naptanId: s.id,
          modes: s.modes || [],
          source: 'api' as const,
        })),
      ];
      return outputJSON({ query: searchQuery, stops: result });
    }

    if (localMatches.length) {
      console.log(
        `\n\u{1F50D} === Stations matching '${searchQuery}' (${localMatches.length} local matches) ===\n`,
      );
      for (const s of localMatches.slice(0, 20)) {
        console.log(`  \u{1F4CD} ${s.name}`);
        console.log(`     ID: ${s.naptanId}`);
        console.log();
      }
    }

    if (apiOnly.length) {
      console.log(`\u{1F50D} === Additional TfL results (${apiOnly.length}) ===\n`);
      for (const s of apiOnly.slice(0, 15)) {
        console.log(`  \u{1F4CD} ${s.name}`);
        console.log(`     ID: ${s.id}`);
        if (s.modes?.length) console.log(`     Modes: ${s.modes.join(', ')}`);
        console.log();
      }
    }

    if (!localMatches.length && !matches.length) {
      console.log(`No stops found matching '${searchQuery}'.`);
    }
    return;
  }

  if (near) {
    const parts = near.split(',');
    if (parts.length !== 2) {
      console.log('Invalid format. Use: --near LAT,LON');
      return;
    }
    const [lat, lon] = parts.map(Number);
    if (isNaN(lat) || isNaN(lon)) {
      console.log('Invalid format. Use: --near LAT,LON');
      return;
    }

    const url = apiUrl(
      `/StopPoint?lat=${lat}&lon=${lon}&stopTypes=NaptanMetroStation,NaptanRailStation,NaptanBusCoachStation,NaptanPublicBusCoachTram&radius=${radius}`,
    );
    const data = await fetchTfl<TflNearbyResponse>(url);

    const stops = data?.stopPoints || [];
    if (!stops.length) {
      console.log(`No stops found within ${radius}m of (${lat}, ${lon}).`);
      return;
    }

    // Sort by distance
    stops.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    if (JSON_MODE) {
      const result = stops.slice(0, 20).map((s) => ({
        name: s.commonName || s.id,
        naptanId: s.naptanId || s.id,
        distance: s.distance != null ? Math.round(s.distance) : null,
        modes: s.modes || [],
        lat: s.lat,
        lon: s.lon,
      }));
      return outputJSON({ nearby: result, radius, center: { lat, lon } });
    }

    console.log(
      `\n\u{1F4CD} === Nearby Stops (${stops.length} within ${radius}m) ===\n`,
    );
    for (const s of stops.slice(0, 20)) {
      const dist = s.distance != null ? ` \u2014 ${Math.round(s.distance)}m` : '';
      const modes = s.modes?.length ? ` [${s.modes.join(', ')}]` : '';
      console.log(`  \u{1F4CD} ${s.commonName || s.id}${dist}${modes}`);
      console.log(`     ID: ${s.naptanId || s.id}`);
      console.log();
    }
    return;
  }

  console.log('Provide --search <name>, --near LAT,LON, or --line <lineId>');
}

// ---- Route Info ----

async function cmdRouteInfo(opts: CliOptions): Promise<void> {
  noteApiKey();
  const lineId = opts.line ? resolveLineId(opts.line) : null;
  const routeId = opts.route;
  const targetLine = lineId || routeId;

  if (!targetLine) {
    console.log('Provide --line <lineId> or --route <routeNumber>');
    return;
  }

  // Get route sequence
  const url = apiUrl(
    `/Line/${encodeURIComponent(targetLine)}/Route/Sequence/outbound`,
  );
  let data: TflRouteSequenceResponse;
  try {
    data = await fetchTfl<TflRouteSequenceResponse>(url);
  } catch {
    // Try as inbound if outbound fails
    try {
      data = await fetchTfl<TflRouteSequenceResponse>(
        apiUrl(`/Line/${encodeURIComponent(targetLine)}/Route/Sequence/inbound`),
      );
    } catch {
      console.log(`Route '${targetLine}' not found or no route data available.`);
      return;
    }
  }

  const name = data?.lineName || targetLine;

  const sequences = data?.stopPointSequences || [];

  if (JSON_MODE) {
    const result = sequences.map((seq) => ({
      branch: seq.name || seq.direction || null,
      stops: (seq.stopPoint || []).map((s) => ({
        name: s.name || s.commonName || s.id,
        naptanId: s.id || null,
      })),
    }));
    return outputJSON({ line: name, sequences: result });
  }

  const emoji = lineEmoji(targetLine);
  console.log(`\n${emoji} === ${name} Route ===\n`);

  if (!sequences.length) {
    const branches = data?.orderedLineRoutes || [];
    if (branches.length) {
      for (const b of branches) {
        console.log(`  ${b.name || 'Route'}`);
      }
    } else {
      console.log('No route sequence data available.');
    }
    return;
  }

  for (const seq of sequences) {
    const branch = seq.name || seq.direction || '';
    if (branch) console.log(`Branch: ${branch}\n`);

    const stopPoints = seq.stopPoint || [];
    for (let i = 0; i < stopPoints.length; i++) {
      const s = stopPoints[i];
      const sname = s.name || s.commonName || s.id;
      console.log(`  ${String(i + 1).padStart(3)}. ${sname}`);
    }
    console.log();
  }
}

// ---- Journey Planning ----

async function resolveJourneyPoint(input: string): Promise<string | null> {
  // Check if it looks like coordinates
  if (/^-?\d+\.?\d*,-?\d+\.?\d*$/.test(input.trim())) {
    return input.trim();
  }

  // Try embedded stations first
  const localMatches = searchStation(input);
  if (localMatches.length) {
    return localMatches[0].naptanId;
  }

  // Fall back to TfL search
  const searchUrl = apiUrl(
    `/StopPoint/Search/${encodeURIComponent(input)}?modes=tube,bus,dlr,overground,elizabeth-line,tram`,
  );
  const searchData = await fetchTfl<TflSearchResponse>(searchUrl);
  const matches = searchData?.matches || [];
  if (matches.length) {
    return matches[0].id || null;
  }

  console.log(`Could not resolve '${input}' to a station or location.`);
  return null;
}

async function cmdJourney(opts: CliOptions): Promise<void> {
  noteApiKey();
  let from = opts.from;
  let to = opts.to;

  if (!from || !to) {
    console.log('Provide --from and --to (station name or LAT,LON)');
    return;
  }

  // Resolve station names to NaPTAN IDs or coordinates
  const resolvedFrom = await resolveJourneyPoint(from);
  const resolvedTo = await resolveJourneyPoint(to);

  if (!resolvedFrom || !resolvedTo) return;

  const url = apiUrl(
    `/Journey/JourneyResults/${encodeURIComponent(resolvedFrom)}/to/${encodeURIComponent(resolvedTo)}`,
  );
  const data = await fetchTfl<TflJourneyResponse>(url);

  const journeys = data?.journeys || [];
  if (!journeys.length) {
    if (JSON_MODE) return outputJSON({ journeys: [], from: opts.from, to: opts.to });
    console.log('No journey results found.');
    return;
  }

  if (JSON_MODE) {
    const result = journeys.slice(0, 3).map((j) => ({
      duration: j.duration,
      startTime: j.startDateTime || null,
      arrivalTime: j.arrivalDateTime || null,
      fare: j.fare?.totalCost ? (j.fare.totalCost / 100).toFixed(2) : null,
      legs: (j.legs || []).map((leg) => ({
        mode: leg.mode?.name || leg.mode?.id || null,
        line: leg.routeOptions?.[0]?.name || null,
        direction: leg.routeOptions?.[0]?.directions?.[0] || null,
        from: leg.departurePoint?.commonName || null,
        to: leg.arrivalPoint?.commonName || null,
        duration: leg.duration || null,
        stops: (leg.path?.stopPoints || []).length,
      })),
    }));
    return outputJSON({ from: opts.from, to: opts.to, journeys: result });
  }

  console.log(`\n\u{1F5FA}\uFE0F === Journey: ${opts.from} \u2192 ${opts.to} ===\n`);

  for (let j = 0; j < Math.min(journeys.length, 3); j++) {
    const journey = journeys[j];
    const duration = journey.duration || '?';
    const startTime = journey.startDateTime
      ? fmtTime24(toLondonDate(new Date(journey.startDateTime)))
      : '';
    const arrTime = journey.arrivalDateTime
      ? fmtTime24(toLondonDate(new Date(journey.arrivalDateTime)))
      : '';

    console.log(
      `--- Option ${j + 1}: ${duration} min (${startTime} \u2192 ${arrTime}) ---\n`,
    );

    const legs = journey.legs || [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const mode = leg.mode?.name || leg.mode?.id || '?';
      const legLineName = leg.routeOptions?.[0]?.name || '';
      const lineDir = leg.routeOptions?.[0]?.directions?.[0] || '';
      const legFrom = leg.departurePoint?.commonName || '';
      const legTo = leg.arrivalPoint?.commonName || '';
      const legDuration = leg.duration || '';

      let legModeEmoji = '\u{1F6B6}';
      if (mode === 'tube') legModeEmoji = '\u{1F687}';
      else if (mode === 'bus') legModeEmoji = '\u{1F68C}';
      else if (mode === 'dlr') legModeEmoji = '\u{1F688}';
      else if (mode === 'overground') legModeEmoji = '\u{1F69D}';
      else if (mode === 'elizabeth-line') legModeEmoji = '\u{1F49C}';
      else if (mode === 'walking') legModeEmoji = '\u{1F6B6}';
      else if (mode === 'tram') legModeEmoji = '\u{1F68B}';

      console.log(
        `  ${legModeEmoji} ${mode}${legLineName ? ' (' + legLineName + ')' : ''}`,
      );
      console.log(`     ${legFrom} \u2192 ${legTo} (${legDuration} min)`);
      if (lineDir) console.log(`     Direction: ${lineDir}`);

      // Show intermediate stops count
      const pathStops = leg.path?.stopPoints || [];
      if (pathStops.length > 0) {
        console.log(
          `     ${pathStops.length} stop${pathStops.length === 1 ? '' : 's'}`,
        );
      }
      console.log();
    }

    // Fare info
    const fare = journey.fare;
    if (fare?.totalCost) {
      const cost = (fare.totalCost / 100).toFixed(2);
      console.log(`  \u{1F4B7} Fare: \u00A3${cost}`);
      console.log();
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
    console.log(`\u{1F687} TfL London Transit \u2014 OpenClaw Skill

Commands:
  status          Tube line status [--line LINE] [--all]
  arrivals        Arrivals at station (--station NAME | --stop-search NAME | --stop ID) [--line LINE]
  bus-arrivals    Bus arrivals (--stop ID | --stop-search NAME) [--route NUM]
  disruptions     Current disruptions [--line LINE]
  routes          List Tube lines [--all for all modes]
  bus-routes      List all bus routes
  stops           Search stops (--search NAME | --near LAT,LON [--radius M] | --line LINE)
  route-info      Route stops (--line LINE | --route NUM)
  journey         Plan a journey (--from PLACE --to PLACE)

Global Options:
  --json          Output structured JSON instead of formatted text

Tube Lines: bakerloo, central, circle, district, hammersmith-city, jubilee,
            metropolitan, northern, piccadilly, victoria, waterloo-city
Other: dlr, london-overground, elizabeth, tram

Environment: TFL_API_KEY (optional, free, from api-portal.tfl.gov.uk)`);
    return;
  }

  const rest = args.slice(1);

  const optDefs: Record<string, { type: 'string' | 'boolean' }> = {
    line: { type: 'string' },
    route: { type: 'string' },
    stop: { type: 'string' },
    'stop-search': { type: 'string' },
    station: { type: 'string' },
    search: { type: 'string' },
    near: { type: 'string' },
    radius: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    all: { type: 'boolean' },
    json: { type: 'boolean' },
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
  } catch (err) {
    console.error(`Error parsing arguments: ${(err as Error).message}`);
    process.exit(1);
  }

  // Set global JSON mode
  if (opts.json) JSON_MODE = true;

  const handlers: Record<string, () => Promise<void>> = {
    status: () => cmdStatus(opts),
    arrivals: () => cmdArrivals(opts),
    'bus-arrivals': () => cmdBusArrivals(opts),
    disruptions: () => cmdDisruptions(opts),
    routes: () => cmdRoutes(opts),
    'bus-routes': () => cmdBusRoutes(opts),
    stops: () => cmdStops(opts),
    'route-info': () => cmdRouteInfo(opts),
    journey: () => cmdJourney(opts),
  };

  if (handlers[command]) {
    Promise.resolve(handlers[command]()).catch((err: Error & { code?: string }) => {
      if (err.name === 'TimeoutError' || err.message?.includes('timeout')) {
        console.error(
          'Request timed out. TfL API may be slow or unreachable. Try again in a moment.',
        );
      } else if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED') {
        console.error(
          'Network error: Could not reach TfL API. Check your internet connection.',
        );
      } else if (err.message?.includes('Rate limited')) {
        console.error(err.message);
      } else {
        console.error(`Error: ${err.message}`);
      }
      process.exit(1);
    });
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Run with --help for available commands.");
    process.exit(1);
  }
}

main();
