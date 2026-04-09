// Embedded GTFS-Realtime proto schema (avoids needing .proto file at runtime)
const GTFS_RT_PROTO = `
syntax = "proto2";
package transit_realtime;

message FeedMessage {
  required FeedHeader header = 1;
  repeated FeedEntity entity = 2;
}
message FeedHeader {
  required string gtfs_realtime_version = 1;
  optional Incrementality incrementality = 2 [default = FULL_DATASET];
  optional uint64 timestamp = 3;
  enum Incrementality { FULL_DATASET = 0; DIFFERENTIAL = 1; }
  extensions 1000 to 1999;
  extensions 9000 to 9999;
}
message FeedEntity {
  required string id = 1;
  optional bool is_deleted = 2 [default = false];
  optional TripUpdate trip_update = 3;
  optional VehiclePosition vehicle = 4;
  optional Alert alert = 5;
}
message TripUpdate {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 3;
  repeated StopTimeUpdate stop_time_update = 2;
  optional uint64 timestamp = 4;
  message StopTimeUpdate {
    optional uint32 stop_sequence = 1;
    optional string stop_id = 3;
    optional StopTimeEvent arrival = 2;
    optional StopTimeEvent departure = 4;
    optional ScheduleRelationship schedule_relationship = 5 [default = SCHEDULED];
    enum ScheduleRelationship { SCHEDULED = 0; SKIPPED = 1; NO_DATA = 2; }
    extensions 1000 to 1999;
    extensions 9000 to 9999;
  }
  message StopTimeEvent {
    optional int32 delay = 1;
    optional int64 time = 2;
    optional int32 uncertainty = 3;
  }
  extensions 1000 to 1999;
  extensions 9000 to 9999;
}
message VehiclePosition {
  optional TripDescriptor trip = 1;
  optional VehicleDescriptor vehicle = 8;
  optional Position position = 2;
  optional uint32 current_stop_sequence = 3;
  optional string stop_id = 7;
  optional VehicleStopStatus current_status = 4 [default = IN_TRANSIT_TO];
  optional uint64 timestamp = 5;
  optional CongestionLevel congestion_level = 6;
  optional OccupancyStatus occupancy_status = 9;
  enum VehicleStopStatus { INCOMING_AT = 0; STOPPED_AT = 1; IN_TRANSIT_TO = 2; }
  enum CongestionLevel { UNKNOWN_CONGESTION_LEVEL = 0; RUNNING_SMOOTHLY = 1; STOP_AND_GO = 2; CONGESTION = 3; SEVERE_CONGESTION = 4; }
  enum OccupancyStatus { EMPTY = 0; MANY_SEATS_AVAILABLE = 1; FEW_SEATS_AVAILABLE = 2; STANDING_ROOM_ONLY = 3; CRUSHED_STANDING_ROOM_ONLY = 4; FULL = 5; NOT_ACCEPTING_PASSENGERS = 6; }
}
message Alert {
  repeated TimeRange active_period = 1;
  repeated EntitySelector informed_entity = 5;
  optional Cause cause = 6 [default = UNKNOWN_CAUSE];
  optional Effect effect = 7 [default = UNKNOWN_EFFECT];
  optional TranslatedString url = 8;
  optional TranslatedString header_text = 10;
  optional TranslatedString description_text = 11;
  enum Cause { UNKNOWN_CAUSE = 1; OTHER_CAUSE = 2; TECHNICAL_PROBLEM = 3; STRIKE = 4; DEMONSTRATION = 5; ACCIDENT = 6; HOLIDAY = 7; WEATHER = 8; MAINTENANCE = 9; CONSTRUCTION = 10; POLICE_ACTIVITY = 11; MEDICAL_EMERGENCY = 12; }
  enum Effect { NO_SERVICE = 1; REDUCED_SERVICE = 2; SIGNIFICANT_DELAYS = 3; DETOUR = 4; ADDITIONAL_SERVICE = 5; MODIFIED_SERVICE = 6; OTHER_EFFECT = 7; UNKNOWN_EFFECT = 8; STOP_MOVED = 9; }
  optional SeverityLevel severity_level = 14 [default = UNKNOWN_SEVERITY];
  enum SeverityLevel { UNKNOWN_SEVERITY = 1; INFO = 2; WARNING = 3; SEVERE = 4; }
}
message TimeRange {
  optional uint64 start = 1;
  optional uint64 end = 2;
}
message Position {
  required float latitude = 1;
  required float longitude = 2;
  optional float bearing = 3;
  optional double odometer = 4;
  optional float speed = 5;
}
message TripDescriptor {
  optional string trip_id = 1;
  optional string route_id = 5;
  optional uint32 direction_id = 6;
  optional string start_time = 2;
  optional string start_date = 3;
  optional ScheduleRelationship schedule_relationship = 4;
  enum ScheduleRelationship { SCHEDULED = 0; ADDED = 1; UNSCHEDULED = 2; CANCELED = 3; }
  extensions 1000 to 1999;
  extensions 9000 to 9999;
}
message VehicleDescriptor {
  optional string id = 1;
  optional string label = 2;
  optional string license_plate = 3;
}
message EntitySelector {
  optional string agency_id = 1;
  optional string route_id = 2;
  optional int32 route_type = 3;
  optional TripDescriptor trip = 4;
  optional string stop_id = 5;
}
message TranslatedString {
  repeated Translation translation = 1;
  message Translation {
    required string text = 1;
    optional string language = 2;
  }
}
`;

// NYCT subway extension proto (for MTA)
const NYCT_PROTO = `
syntax = "proto2";
import "gtfs-realtime.proto";
package transit_realtime;

message TripReplacementPeriod {
  optional string route_id = 1;
  optional TimeRange replacement_period = 2;
}

message NyctFeedHeader {
  required string nyct_subway_version = 1;
  repeated TripReplacementPeriod trip_replacement_period = 2;
}

message NyctTripDescriptor {
  optional string train_id = 1;
  optional bool is_assigned = 2;
  optional Direction direction = 3;
  enum Direction { NORTH = 1; EAST = 2; SOUTH = 3; WEST = 4; }
}

message NyctStopTimeUpdate {
  optional string scheduled_track = 1;
  optional string actual_track = 2;
}

extend FeedHeader { optional NyctFeedHeader nyct_feed_header = 1001; }
extend TripDescriptor { optional NyctTripDescriptor nyct_trip_descriptor = 1001; }
extend TripUpdate.StopTimeUpdate { optional NyctStopTimeUpdate nyct_stop_time_update = 1001; }
`;

let _protobufRoot: any = null;
let _nyctRoot: any = null;

export async function getProtobufRoot(): Promise<any> {
  if (_protobufRoot) return _protobufRoot;
  const protobuf = (await import('protobufjs')).default;
  _protobufRoot = protobuf.parse(GTFS_RT_PROTO, { keepCase: true }).root;
  return _protobufRoot;
}

export async function getNyctProtobufRoot(): Promise<any> {
  if (_nyctRoot) return _nyctRoot;
  const protobuf = (await import('protobufjs')).default;
  // Parse base first, then add NYCT extensions
  const root = protobuf.parse(GTFS_RT_PROTO, { keepCase: true }).root;
  protobuf.parse(NYCT_PROTO, root, { keepCase: true });
  _nyctRoot = root;
  return _nyctRoot;
}

export async function parsePb(url: string, root?: any): Promise<any> {
  const pbRoot = root ?? (await getProtobufRoot());
  const FeedMessage = pbRoot.lookupType('transit_realtime.FeedMessage');
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > 0 && buf[0] === 0x3c) {
    throw new Error(
      'Feed returned HTML instead of protobuf — endpoint may be temporarily unavailable',
    );
  }
  return FeedMessage.decode(buf);
}

export async function parsePbWithAuth(
  url: string,
  authHeader: string,
  root?: any,
): Promise<any> {
  const pbRoot = root ?? (await getProtobufRoot());
  const FeedMessage = pbRoot.lookupType('transit_realtime.FeedMessage');
  const resp = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { Authorization: authHeader },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > 0 && buf[0] === 0x3c) {
    throw new Error(
      'Feed returned HTML instead of protobuf — endpoint may be temporarily unavailable',
    );
  }
  return FeedMessage.decode(buf);
}
