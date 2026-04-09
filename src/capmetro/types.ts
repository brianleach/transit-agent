/**
 * CapMetro Austin Transit — TypeScript type definitions
 */

// ---------------------------------------------------------------------------
// Feed URLs
// ---------------------------------------------------------------------------

export interface FeedsConfig {
  vehicle_positions_json: string;
  vehicle_positions_pb: string;
  trip_updates_pb: string;
  service_alerts_pb: string;
  gtfs_static: string;
}

// ---------------------------------------------------------------------------
// GTFS-RT Vehicle Positions (JSON feed shape)
// ---------------------------------------------------------------------------

export interface VehiclePositionJsonTrip {
  routeId?: string;
  route_id?: string;
  tripId?: string;
  trip_id?: string;
}

export interface VehiclePositionJsonPosition {
  latitude?: number;
  longitude?: number;
  bearing?: number;
  speed?: number;
}

export interface VehiclePositionJsonVehicle {
  id?: string;
  label?: string;
}

export interface VehiclePositionJsonEntity {
  vehicle?: {
    trip?: VehiclePositionJsonTrip;
    position?: VehiclePositionJsonPosition;
    vehicle?: VehiclePositionJsonVehicle;
    timestamp?: string | number;
  };
  // Top-level fallback fields (some feeds flatten)
  trip?: VehiclePositionJsonTrip;
  position?: VehiclePositionJsonPosition;
  timestamp?: string | number;
}

export interface VehiclePositionsJsonFeed {
  entity?: VehiclePositionJsonEntity[];
  // Some feeds return entities at top level
  [index: number]: VehiclePositionJsonEntity;
}

// ---------------------------------------------------------------------------
// GTFS-RT Protobuf decoded shapes
// ---------------------------------------------------------------------------

export interface PbTranslation {
  text: string;
  language?: string;
}

export interface PbTranslatedString {
  translation?: PbTranslation[];
}

export interface PbTimeRange {
  start?: number | Long;
  end?: number | Long;
}

export interface PbEntitySelector {
  agencyId?: string;
  agency_id?: string;
  routeId?: string;
  route_id?: string;
  routeType?: number;
  route_type?: number;
  trip?: PbTripDescriptor;
  stopId?: string;
  stop_id?: string;
}

export interface PbAlert {
  activePeriod?: PbTimeRange[];
  active_period?: PbTimeRange[];
  informedEntity?: PbEntitySelector[];
  informed_entity?: PbEntitySelector[];
  cause?: number;
  effect?: number;
  headerText?: PbTranslatedString;
  header_text?: PbTranslatedString;
  descriptionText?: PbTranslatedString;
  description_text?: PbTranslatedString;
  url?: PbTranslatedString;
}

export interface PbStopTimeEvent {
  delay?: number;
  time?: number | Long;
  uncertainty?: number;
}

export interface PbStopTimeUpdate {
  stopSequence?: number;
  stop_sequence?: number;
  stopId?: string;
  stop_id?: string;
  arrival?: PbStopTimeEvent;
  departure?: PbStopTimeEvent;
  scheduleRelationship?: number;
  schedule_relationship?: number;
}

export interface PbTripDescriptor {
  tripId?: string;
  trip_id?: string;
  routeId?: string;
  route_id?: string;
  directionId?: number;
  direction_id?: number;
  startTime?: string;
  start_time?: string;
  startDate?: string;
  start_date?: string;
}

export interface PbVehicleDescriptor {
  id?: string;
  label?: string;
  licensePlate?: string;
  license_plate?: string;
}

export interface PbTripUpdate {
  trip?: PbTripDescriptor;
  vehicle?: PbVehicleDescriptor;
  stopTimeUpdate?: PbStopTimeUpdate[];
  stop_time_update?: PbStopTimeUpdate[];
  timestamp?: number | Long;
}

export interface PbFeedEntity {
  id: string;
  isDeleted?: boolean;
  is_deleted?: boolean;
  tripUpdate?: PbTripUpdate;
  trip_update?: PbTripUpdate;
  vehicle?: {
    trip?: PbTripDescriptor;
    vehicle?: PbVehicleDescriptor;
    position?: {
      latitude?: number;
      longitude?: number;
      bearing?: number;
      speed?: number;
    };
    timestamp?: number | Long;
  };
  alert?: PbAlert;
}

export interface PbFeedMessage {
  header?: {
    gtfsRealtimeVersion?: string;
    gtfs_realtime_version?: string;
    timestamp?: number | Long;
  };
  entity?: PbFeedEntity[];
}

/** protobufjs Long type */
export interface Long {
  low: number;
  high: number;
  unsigned: boolean;
  toNumber(): number;
}

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

export interface CliOptions {
  route?: string;
  stop?: string;
  'stop-search'?: string;
  headsign?: string;
  search?: string;
  near?: string;
  radius?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// Internal data shapes
// ---------------------------------------------------------------------------

export interface VehicleEntry {
  vid: string;
  route: string;
  route_id: string;
  route_name: string;
  route_type: string;
  lat: number | undefined;
  lon: number | undefined;
  time: string;
}

export interface RtArrivalEntry {
  route: string;
  route_id: string;
  route_type: string;
  headsign: string;
  arrival: string;
  minsAway: number;
  delayMins: number;
}

export interface ScheduledArrivalEntry {
  route: string;
  route_id: string;
  route_type: string;
  headsign: string;
  time: string;
}

export interface StopInfo {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  stop_desc?: string;
}

export interface RouteInfo {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
  route_url?: string;
}
