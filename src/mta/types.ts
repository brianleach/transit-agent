// ---------------------------------------------------------------------------
// MTA New York City Transit — Type Definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Subway Line Metadata
// ---------------------------------------------------------------------------

export interface SubwayLineInfo {
  name: string;
  color: string;
  route: string;
  terminals: [string, string];
}

export type SubwayLineCode =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7'
  | 'A' | 'C' | 'E'
  | 'B' | 'D' | 'F' | 'M'
  | 'G'
  | 'J' | 'Z'
  | 'L'
  | 'N' | 'Q' | 'R' | 'W'
  | 'GS' | 'FS' | 'H' | 'SI';

// ---------------------------------------------------------------------------
// Station Data
// ---------------------------------------------------------------------------

export interface Station {
  id: string;
  name: string;
  lines: string[];
  aliases: string[];
}

export interface ScoredStation extends Station {
  rank: number;
  gtfs?: boolean;
}

// ---------------------------------------------------------------------------
// CLI Options
// ---------------------------------------------------------------------------

export interface CliOptions {
  stop?: string;
  'stop-search'?: string;
  station?: string;
  line?: string;
  route?: string;
  search?: string;
  near?: string;
  radius?: string;
  subway?: boolean;
  bus?: boolean;
  headsign?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Subway Arrival (internal)
// ---------------------------------------------------------------------------

export interface SubwayArrival {
  route: string;
  lineName: string;
  color: string;
  direction: string;
  arrival: string;
  minsAway: number;
  trainId: string;
  scheduledTrack: string;
  actualTrack: string;
  stopId: string;
}

// ---------------------------------------------------------------------------
// Subway Vehicle (internal)
// ---------------------------------------------------------------------------

export interface SubwayVehicle {
  trainId: string;
  direction: string;
  stopName: string;
  stopId: string;
  status: string;
  time: string;
}

// ---------------------------------------------------------------------------
// Bus Arrival (internal)
// ---------------------------------------------------------------------------

export interface BusArrival {
  route: string;
  destination: string;
  eta: string;
  minsAway: number | null;
  stopsAway: string | number;
  distMiles: string;
  vehicleRef: string;
}

// ---------------------------------------------------------------------------
// Bus Vehicle (internal)
// ---------------------------------------------------------------------------

export interface BusVehicle {
  vehicleRef: string;
  destination: string;
  status: string;
  nextStop: string;
  lat: number | undefined;
  lon: number | undefined;
  bearing: number | undefined;
}

// ---------------------------------------------------------------------------
// Alert (internal)
// ---------------------------------------------------------------------------

export interface AlertEntry {
  header: string;
  description: string;
  routes: string[];
  periods: string[];
  effect: number;
}

// ---------------------------------------------------------------------------
// SIRI Bus API Response Shapes
// ---------------------------------------------------------------------------

export interface SiriTranslatedValue {
  value: string;
}

export interface SiriDistances {
  StopsFromCall?: number | string;
  DistanceFromCall?: number;
}

export interface SiriExtensions {
  Distances?: SiriDistances;
}

export interface SiriMonitoredCall {
  StopPointName?: SiriTranslatedValue[];
  ExpectedArrivalTime?: string;
  ExpectedDepartureTime?: string;
  ArrivalProximityText?: string;
  Extensions?: SiriExtensions;
}

export interface SiriVehicleLocation {
  Latitude?: number;
  Longitude?: number;
}

export interface SiriMonitoredVehicleJourney {
  LineRef?: string;
  DestinationName?: SiriTranslatedValue[];
  VehicleRef?: string;
  VehicleLocation?: SiriVehicleLocation;
  Bearing?: number;
  ProgressStatus?: string[];
  MonitoredCall?: SiriMonitoredCall;
}

export interface SiriMonitoredStopVisit {
  MonitoredVehicleJourney?: SiriMonitoredVehicleJourney;
}

export interface SiriStopMonitoringDelivery {
  MonitoredStopVisit?: SiriMonitoredStopVisit[];
}

export interface SiriStopMonitoringResponse {
  Siri?: {
    ServiceDelivery?: {
      StopMonitoringDelivery?: SiriStopMonitoringDelivery[];
    };
  };
}

export interface SiriVehicleActivity {
  MonitoredVehicleJourney?: SiriMonitoredVehicleJourney;
}

export interface SiriVehicleMonitoringDelivery {
  VehicleActivity?: SiriVehicleActivity[];
}

export interface SiriVehicleMonitoringResponse {
  Siri?: {
    ServiceDelivery?: {
      VehicleMonitoringDelivery?: SiriVehicleMonitoringDelivery[];
    };
  };
}

// ---------------------------------------------------------------------------
// OneBusAway API Response Shapes
// ---------------------------------------------------------------------------

export interface ObaRoute {
  id: string;
  shortName?: string;
  longName?: string;
}

export interface ObaRoutesForAgencyResponse {
  data?: {
    list?: ObaRoute[];
  };
}

export interface ObaStop {
  id: string;
  code?: string;
  name: string;
  lat: number;
  lon: number;
  direction?: string;
  routeIds?: string[];
}

export interface ObaStopsForLocationResponse {
  data?: {
    list?: ObaStop[];
  };
}

export interface ObaStopsForRouteResponse {
  data?: {
    references?: {
      stops?: ObaStop[];
    };
    list?: ObaStop[];
  };
}
