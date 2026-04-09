/**
 * TfL London Transit — Type Definitions
 * Types for TfL Unified API responses, station data, line metadata, and CLI options.
 */

// ---------------------------------------------------------------------------
// TfL API Response Shapes
// ---------------------------------------------------------------------------

/** A single arrival prediction from the /StopPoint/{id}/Arrivals endpoint */
export interface TflArrival {
  id?: string;
  stationName?: string;
  lineId?: string;
  lineName?: string;
  platformName?: string;
  direction?: string;
  destinationName?: string;
  towards?: string;
  expectedArrival?: string;
  timeToStation?: number;
  currentLocation?: string;
  modeName?: string;
  naptanId?: string;
}

/** A single line status entry within a line status response */
export interface TflLineStatusDetail {
  statusSeverity?: number;
  statusSeverityDescription?: string;
  reason?: string;
}

/** A line with its status from /Line/{id}/Status or /Line/Mode/{modes}/Status */
export interface TflLineStatus {
  id?: string;
  name?: string;
  lineStatuses?: TflLineStatusDetail[];
}

/** A disruption entry from /Line/{ids}/Disruption */
export interface TflDisruption {
  category?: string;
  categoryDescription?: string;
  description?: string;
  closureText?: string;
  affectedRoutes?: TflAffectedRoute[];
}

export interface TflAffectedRoute {
  name?: string;
}

/** A stop point from /Line/{id}/StopPoints or /StopPoint searches */
export interface TflStopPoint {
  id?: string;
  naptanId?: string;
  commonName?: string;
  name?: string;
  lat?: number;
  lon?: number;
  distance?: number;
  modes?: string[];
}

/** Search result from /StopPoint/Search/{query} */
export interface TflSearchMatch {
  id?: string;
  name?: string;
  modes?: string[];
}

export interface TflSearchResponse {
  matches?: TflSearchMatch[];
}

/** Nearby stops response from /StopPoint?lat=&lon=&... */
export interface TflNearbyResponse {
  stopPoints?: TflStopPoint[];
}

/** Route sequence from /Line/{id}/Route/Sequence/{direction} */
export interface TflRouteSequenceResponse {
  lineName?: string;
  stopPointSequences?: TflStopSequence[];
  orderedLineRoutes?: TflOrderedRoute[];
}

export interface TflStopSequence {
  name?: string;
  direction?: string;
  stopPoint?: TflRouteStopPoint[];
}

export interface TflRouteStopPoint {
  id?: string;
  name?: string;
  commonName?: string;
}

export interface TflOrderedRoute {
  name?: string;
}

/** Journey planner response from /Journey/JourneyResults/{from}/to/{to} */
export interface TflJourneyResponse {
  journeys?: TflJourney[];
}

export interface TflJourney {
  duration?: number;
  startDateTime?: string;
  arrivalDateTime?: string;
  fare?: TflFare;
  legs?: TflJourneyLeg[];
}

export interface TflFare {
  totalCost?: number;
}

export interface TflJourneyLeg {
  mode?: TflMode;
  routeOptions?: TflRouteOption[];
  departurePoint?: TflJourneyPoint;
  arrivalPoint?: TflJourneyPoint;
  duration?: number;
  path?: TflLegPath;
}

export interface TflMode {
  id?: string;
  name?: string;
}

export interface TflRouteOption {
  name?: string;
  directions?: string[];
}

export interface TflJourneyPoint {
  commonName?: string;
}

export interface TflLegPath {
  stopPoints?: unknown[];
}

/** Bus route line from /Line/Mode/bus */
export interface TflBusRoute {
  id?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Tube Line Metadata
// ---------------------------------------------------------------------------

export interface TubeLineInfo {
  name: string;
  emoji: string;
  terminals: string[];
}

export interface OtherLineInfo {
  name: string;
  emoji: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Station Data
// ---------------------------------------------------------------------------

export interface StationEntry {
  naptanId: string;
  name: string;
  aliases: string[];
}

export interface ScoredStation extends StationEntry {
  score: number;
}

// ---------------------------------------------------------------------------
// CLI Option Types
// ---------------------------------------------------------------------------

export interface CliOptions {
  line?: string;
  route?: string;
  stop?: string;
  'stop-search'?: string;
  station?: string;
  search?: string;
  near?: string;
  radius?: string;
  from?: string;
  to?: string;
  all?: boolean;
  json?: boolean;
}
