// ---------------------------------------------------------------------------
// Chicago Metra Commuter Rail -- Type Definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Metra Line Metadata
// ---------------------------------------------------------------------------

export interface MetraLineInfo {
  name: string;
  color: string;
  terminal: string;
  outer: string;
}

export type MetraLineCode =
  | 'BNSF'
  | 'ME'
  | 'HC'
  | 'MD-N'
  | 'MD-W'
  | 'NCS'
  | 'RI'
  | 'SWS'
  | 'UP-N'
  | 'UP-NW'
  | 'UP-W';

// ---------------------------------------------------------------------------
// Station Data
// ---------------------------------------------------------------------------

export interface MetraStation {
  name: string;
  lines: string[];
  aliases: string[];
}

export interface StationSearchResult extends MetraStation {
  score: number;
  source: 'embedded' | 'gtfs';
  stop_id?: string;
  zone_id?: string;
}

// ---------------------------------------------------------------------------
// Fare Data
// ---------------------------------------------------------------------------

export interface FareEntry {
  oneWay: number;
  dayPass: number;
  dayPass5: number;
  monthly: number;
}

export type FareKey = '1-2' | '1-3' | '1-4' | '2-4';

export type ZoneLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J';

// ---------------------------------------------------------------------------
// CLI Options
// ---------------------------------------------------------------------------

export interface CliOptions {
  station?: string;
  line?: string;
  search?: string;
  near?: string;
  radius?: string;
  from?: string;
  to?: string;
  headsign?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Arrival / Vehicle / Alert display shapes
// ---------------------------------------------------------------------------

export interface ArrivalEntry {
  line: string;
  lineName: string;
  trainNum: string;
  headsign: string;
  direction: string;
  arrival: string;
  minsAway: number;
  delayMins: number;
  terminal: string;
}

export interface ScheduledDeparture {
  line: string;
  lineName: string;
  trainNum: string;
  headsign: string;
  direction: string;
  time: string;
}

export interface VehicleEntry {
  trainNum: string;
  headsign: string;
  direction: string;
  stopName: string;
  status: string;
  lat: number | undefined;
  lon: number | undefined;
  bearing: number | undefined;
  speed: number | undefined;
  time: string;
}

export interface AlertEntry {
  header: string;
  description: string;
  affectedLines: string[];
  periods: string[];
  effect: number;
}

export interface ScheduleEntry {
  line: string;
  lineName: string;
  trainNum: string;
  headsign: string;
  time: string;
}
