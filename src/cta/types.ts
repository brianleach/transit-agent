// ---------------------------------------------------------------------------
// CTA Chicago Transit — Type Definitions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// L Train Lines
// ---------------------------------------------------------------------------

export interface LLineInfo {
  name: string;
  color: string;
  terminals: string[];
}

export type LLineCode = 'Red' | 'Blue' | 'Brn' | 'G' | 'Org' | 'P' | 'Pink' | 'Y';

// ---------------------------------------------------------------------------
// Station Data
// ---------------------------------------------------------------------------

export interface Station {
  mapid: string;
  name: string;
  lines: string[];
  aliases: string[];
}

export interface ScoredStation extends Station {
  score: number;
}

// ---------------------------------------------------------------------------
// CLI Options
// ---------------------------------------------------------------------------

export interface CliOptions {
  route?: string;
  stop?: string;
  'stop-search'?: string;
  station?: string;
  mapid?: string;
  search?: string;
  near?: string;
  radius?: string;
  headsign?: string;
  json?: boolean;
}

// ---------------------------------------------------------------------------
// CTA Train Tracker API Response Shapes
// ---------------------------------------------------------------------------

export interface TrainTrackerEta {
  staId: string;
  stpId: string;
  staNm: string;
  stpDe: string;
  rn: string;
  rt: string;
  destSt: string;
  destNm: string;
  trDr: string;
  prdt: string;
  arrT: string;
  isApp: string;
  isSch: string;
  isDly: string;
  isFlt: string;
  flags: string | null;
  lat: string;
  lon: string;
  heading: string;
}

export interface TrainTrackerArrivalsResponse {
  ctatt: {
    tmst: string;
    errCd: string;
    errNm: string | null;
    eta?: TrainTrackerEta | TrainTrackerEta[];
  };
}

export interface TrainPosition {
  rn: string;
  destSt: string;
  destNm: string;
  trDr: string;
  nextStaId: string;
  nextStpId: string;
  nextStaNm: string;
  prdt: string;
  arrT: string;
  isApp: string;
  isDly: string;
  flags: string | null;
  lat: string;
  lon: string;
  heading: string;
}

export interface TrainTrackerRoute {
  '@name': string;
  train?: TrainPosition | TrainPosition[];
}

export interface TrainTrackerPositionsResponse {
  ctatt: {
    tmst: string;
    errCd: string;
    errNm: string | null;
    route?: TrainTrackerRoute | TrainTrackerRoute[];
  };
}

// ---------------------------------------------------------------------------
// CTA Bus Tracker API Response Shapes
// ---------------------------------------------------------------------------

export interface BusPrediction {
  tmstmp: string;
  typ: string;
  stpnm: string;
  stpid: string;
  vid: string;
  dstp: number;
  rt: string;
  rtdd: string;
  rtdir: string;
  des: string;
  prdtm: string;
  tablockid: string;
  tatripid: string;
  dly: string;
  prdctdn: string;
  zone: string;
}

export interface BusTrackerPredictionsResponse {
  'bustime-response': {
    prd?: BusPrediction | BusPrediction[];
    error?: BusTrackerError | BusTrackerError[];
  };
}

export interface BusVehicle {
  vid: string;
  tmstmp: string;
  lat: string;
  lon: string;
  hdg: string;
  pid: number;
  rt: string;
  des: string;
  pdist: number;
  dly: string;
  tatripid: string;
  tablockid: string;
  zone: string;
  spd: string;
  rtdir: string;
}

export interface BusTrackerVehiclesResponse {
  'bustime-response': {
    vehicle?: BusVehicle | BusVehicle[];
    error?: BusTrackerError | BusTrackerError[];
  };
}

export interface BusRoute {
  rt: string;
  rtnm: string;
  rtclr: string;
  rtdd: string;
}

export interface BusTrackerRoutesResponse {
  'bustime-response': {
    routes?: BusRoute | BusRoute[];
    error?: BusTrackerError | BusTrackerError[];
  };
}

export interface BusDirection {
  dir: string;
}

export interface BusTrackerDirectionsResponse {
  'bustime-response': {
    directions?: BusDirection | BusDirection[];
    error?: BusTrackerError | BusTrackerError[];
  };
}

export interface BusStop {
  stpid: string;
  stpnm: string;
  lat: number;
  lon: number;
}

export interface BusTrackerStopsResponse {
  'bustime-response': {
    stops?: BusStop | BusStop[];
    error?: BusTrackerError | BusTrackerError[];
  };
}

export interface BusTrackerError {
  msg?: string;
  stpnm?: string;
  rt?: string;
}

// ---------------------------------------------------------------------------
// CTA Customer Alerts API Response Shapes
// ---------------------------------------------------------------------------

export interface AlertService {
  ServiceType: string;
  ServiceTypeDescription: string;
  ServiceName: string;
  ServiceId: string;
  ServiceBackColor: string;
  ServiceTextColor: string;
  ServiceURL: string;
}

export interface Alert {
  AlertId: string;
  Headline: string;
  ShortDescription: string;
  FullDescription: string;
  SeverityScore: string;
  SeverityColor: string;
  SeverityCSS: string;
  Impact: string;
  EventStart: string;
  EventEnd: string;
  TBD: string;
  MajorAlert: string;
  AlertURL: string;
  ImpactedService: {
    Service?: AlertService | AlertService[];
  };
  ttim: string;
  GUID: string;
}

export interface CTAAlertsResponse {
  CTAAlerts: {
    TimeStamp: string;
    ErrorCode: string;
    ErrorMessage: string | null;
    Alert?: Alert | Alert[];
  };
}

// ---------------------------------------------------------------------------
// JSON output shapes (returned by --json flag)
// ---------------------------------------------------------------------------

export interface TrainArrivalJson {
  line: string;
  routeCode: string;
  destination: string;
  arrivalTime: string | null;
  minutesAway: number | null;
  isApproaching: boolean;
  isDelayed: boolean;
  runNumber: string | null;
}

export interface BusPredictionJson {
  route: string;
  direction: string;
  destination: string;
  arrivalTime: string | null;
  minutesAway: number;
  isDelayed: boolean;
  vehicleId: string | null;
  type: 'arriving' | 'departing';
}

export interface TrainVehicleJson {
  runNumber: string | null;
  destination: string;
  nextStation: string;
  isApproaching: boolean;
  isDelayed: boolean;
  lat: string | null;
  lon: string | null;
  heading: string | null;
}

export interface BusVehicleJson {
  vehicleId: string | null;
  direction: string;
  destination: string;
  lat: string | null;
  lon: string | null;
  heading: string | null;
  speed: string | null;
  isDelayed: boolean;
  lastUpdate: string | null;
}

export interface AlertJson {
  headline: string;
  shortDescription: string;
  impact: string;
  severity: number;
  affectedRoutes: string[];
  eventStart: string | null;
  eventEnd: string | null;
}
