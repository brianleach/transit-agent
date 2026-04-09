# TfL — London, UK

Transport for London. Operates the Underground (Tube), DLR, Overground, Elizabeth line, buses, trams, river bus, and cable car.

## Quick Reference

| Mode | Lines/Routes | Notes |
|------|-------------|-------|
| Underground (Tube) | 11 lines | Single unified API, JSON |
| DLR | 1 line | Docklands Light Railway |
| Overground | 6 named lines | Liberty, Lioness, Mildmay, Suffragette, Weaver, Windrush |
| Elizabeth line | 1 line | Crossrail |
| Bus | 600+ routes | |
| Trams | Croydon Tramlink | |

## Tube Lines

| Line ID | Name | Terminals |
|---------|------|-----------|
| bakerloo | Bakerloo | Harrow & Wealdstone ↔ Elephant & Castle |
| central | Central | Epping / Ealing Broadway ↔ West Ruislip |
| circle | Circle | Hammersmith (loop via Liverpool Street) |
| district | District | Richmond / Ealing Broadway ↔ Upminster |
| hammersmith-city | Hammersmith & City | Hammersmith ↔ Barking |
| jubilee | Jubilee | Stanmore ↔ Stratford |
| metropolitan | Metropolitan | Chesham / Amersham / Uxbridge ↔ Aldgate |
| northern | Northern | Edgware / High Barnet ↔ Morden / Battersea |
| piccadilly | Piccadilly | Heathrow T5 / Uxbridge ↔ Cockfosters |
| victoria | Victoria | Walthamstow Central ↔ Brixton |
| waterloo-city | Waterloo & City | Waterloo ↔ Bank |

## Other Rail Modes

| Line ID | Name | Type |
|---------|------|------|
| dlr | DLR | Docklands Light Railway |
| liberty | Liberty | Overground (Romford — Upminster) |
| lioness | Lioness | Overground (Watford — Euston) |
| mildmay | Mildmay | Overground (Stratford — Richmond/Clapham) |
| suffragette | Suffragette | Overground (Gospel Oak — Barking) |
| weaver | Weaver | Overground (Liverpool St — Enfield/Cheshunt/Chingford) |
| windrush | Windrush | Overground (Highbury — Crystal Palace/Clapham/W Croydon) |
| elizabeth | Elizabeth line | Crossrail |
| tram | London Trams | Croydon Tramlink |

## API Details

TfL has a **single unified REST API** (`api.tfl.gov.uk`) returning JSON for ALL modes.

### API Key (Optional, Recommended)

| Detail | Value |
|--------|-------|
| Env Var | `TFL_API_KEY` |
| Register | https://api-portal.tfl.gov.uk/ |
| Without key | Rate-limited basic usage |
| With key | 500 requests/minute |

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `/Line/Mode/tube/Status` | All Tube line statuses |
| `/Line/{id}/Status` | Specific line status |
| `/StopPoint/{naptanId}/Arrivals` | Arrivals at a stop |
| `/StopPoint/Search/{query}` | Search stops by name |
| `/StopPoint?lat=&lon=&radius=` | Nearby stops |
| `/Line/{id}/StopPoints` | Stops on a line |
| `/Line/{id}/Disruption` | Disruptions |
| `/Journey/JourneyResults/{from}/to/{to}` | Journey planning |

## Script Usage

```bash
# Line status
node scripts/tfl_arrivals.js status
node scripts/tfl_arrivals.js status --line victoria

# Arrivals
node scripts/tfl_arrivals.js arrivals --station "Oxford Circus"
node scripts/tfl_arrivals.js arrivals --stop-search "kings cross" --line piccadilly

# Bus
node scripts/tfl_arrivals.js bus-arrivals --stop-search "oxford circus" --route 24

# Disruptions
node scripts/tfl_arrivals.js disruptions --line northern

# Journey planning
node scripts/tfl_arrivals.js journey --from "waterloo" --to "kings cross"

# Routes and stops
node scripts/tfl_arrivals.js routes
node scripts/tfl_arrivals.js stops --search "waterloo"
node scripts/tfl_arrivals.js stops --near 51.5074,-0.1278 --radius 500

node scripts/tfl_arrivals.js route-info --line bakerloo
```

## Timezone

Europe/London (GMT/BST). Times in **24-hour format** (London convention).

## Fares (from March 2025)

| Fare Type | Price |
|-----------|-------|
| Tube Zone 1 (peak) | £2.80 |
| Tube Zone 1 (off-peak) | £2.70 |
| Bus & Tram | £1.75 |
| Hopper fare (1 hr unlimited bus/tram) | £1.75 total |
| Daily cap Zones 1-2 | £8.90 |
| Weekly cap Zones 1-2 | £44.70 |

Peak: Mon-Fri 6:30-9:30am and 4:00-7:00pm (except public holidays).

## Gotchas

- **NaPTAN IDs** are station identifiers. Tube: `940GZZLU{code}`, Bus: `490{code}`
- Use `--station` or `--stop-search` for name lookups, `--stop` for exact NaPTAN IDs
- No GTFS needed — TfL is all live API, no local cache
- Arrivals use `timeToStation` (seconds) from the API for ETA
- Journey planning returns fare estimates when available
- Line aliases: "northern" = northern, "ham city" = hammersmith-city, "met" = metropolitan
- 429 rate limit → sign up for free API key
