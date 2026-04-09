# MTA — New York City, NY

Metropolitan Transportation Authority. Operates the NYC Subway, local/express buses, Metro-North Railroad, and Long Island Rail Road.

## Quick Reference

| Mode | Lines/Routes | Notes |
|------|-------------|-------|
| Subway | 27 lines (1-7, A-Z, shuttles, SIR) | GTFS-RT, ~30 sec refresh, no key needed |
| Bus | 300+ routes (M, B, Bx, Q, S, X) | SIRI JSON API, key required |

## Subway Lines

| Line | Color | Route | Terminals |
|------|-------|-------|-----------|
| 1 | Red | 7th Ave Local | Van Cortlandt Park-242 St ↔ South Ferry |
| 2 | Red | 7th Ave Express | Wakefield-241 St ↔ Flatbush Ave |
| 3 | Red | 7th Ave Express | Harlem-148 St ↔ New Lots Ave |
| 4 | Green | Lex Express | Woodlawn ↔ Crown Heights-Utica Ave |
| 5 | Green | Lex Express | Eastchester-Dyre Ave ↔ Flatbush Ave |
| 6 | Green | Lex Local | Pelham Bay Park ↔ Brooklyn Bridge |
| 7 | Purple | Flushing | Flushing-Main St ↔ 34 St-Hudson Yards |
| A | Blue | 8th Ave Express | Inwood-207 St ↔ Far Rockaway / Lefferts Blvd |
| C | Blue | 8th Ave Local | 168 St ↔ Euclid Ave |
| E | Blue | 8th Ave Local | Jamaica Center ↔ World Trade Center |
| B | Orange | 6th Ave Express | Bedford Park Blvd ↔ Brighton Beach |
| D | Orange | 6th Ave Express | Norwood-205 St ↔ Coney Island |
| F | Orange | 6th Ave Local | Jamaica-179 St ↔ Coney Island |
| M | Orange | 6th Ave Local | Middle Village ↔ Forest Hills-71 Ave |
| G | Light Green | Crosstown | Court Sq ↔ Church Ave |
| J/Z | Brown | Nassau St | Jamaica Center ↔ Broad St |
| L | Gray | 14th St-Canarsie | 8 Ave ↔ Canarsie-Rockaway Pkwy |
| N | Yellow | Broadway Express | Astoria ↔ Coney Island |
| Q | Yellow | Broadway Express | 96 St ↔ Coney Island |
| R | Yellow | Broadway Local | Forest Hills ↔ Bay Ridge-95 St |
| W | Yellow | Broadway Local | Astoria ↔ Whitehall St |
| S | Gray | Shuttles | 42 St, Franklin Ave, Rockaway Park |
| SIR | Blue | Staten Island | St George ↔ Tottenville |

## Subway Feed Mapping

| Feed | Lines | URL suffix |
|------|-------|------------|
| Default | 1,2,3,4,5,6,7,GS | `gtfs` |
| ACE | A,C,E,H,FS | `gtfs-ace` |
| BDFM | B,D,F,M | `gtfs-bdfm` |
| G | G | `gtfs-g` |
| JZ | J,Z | `gtfs-jz` |
| L | L | `gtfs-l` |
| NQRW | N,Q,R,W | `gtfs-nqrw` |
| SI | SIR | `gtfs-si` |

## API Details

### Subway (no key required)

Base: `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct/`

### Alerts (no key required)

| Feed | URL |
|------|-----|
| Subway | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys/subway-alerts` |
| Bus | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys/bus-alerts` |
| All | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys/all-alerts` |

### Bus (requires `MTA_BUS_API_KEY`)

Get key at: https://register.developer.obanyc.com/

| Endpoint | Description |
|----------|-------------|
| `bustime.mta.info/api/siri/stop-monitoring.json` | Arrivals at a stop |
| `bustime.mta.info/api/siri/vehicle-monitoring.json` | Vehicle positions |
| `bustime.mta.info/api/where/*` | OneBusAway discovery |

## Script Usage

```bash
# Subway
node scripts/mta_arrivals.js arrivals --stop-search "times square"
node scripts/mta_arrivals.js arrivals --stop-search "penn station" --line A
node scripts/mta_arrivals.js vehicles --line 1

# Bus
node scripts/mta_arrivals.js bus-arrivals --stop MTA_308209 --route M1
node scripts/mta_arrivals.js bus-vehicles --route B52

# Alerts
node scripts/mta_arrivals.js alerts
node scripts/mta_arrivals.js alerts --line A

# Routes and stops
node scripts/mta_arrivals.js routes
node scripts/mta_arrivals.js stops --search "grand central"
node scripts/mta_arrivals.js stops --near 40.7484,-73.9856

node scripts/mta_arrivals.js refresh-gtfs
```

## Timezone

US Eastern (EST/EDT). All times in 12-hour AM/PM format.

## Fares (2025)

| Fare Type | Price |
|-----------|-------|
| Subway/Bus (OMNY/MetroCard) | $2.90 |
| Express Bus | $7.00 |
| 7-Day Unlimited | $34.00 |
| 30-Day Unlimited | $132.00 |

Free transfers between subway and bus within 2 hours with OMNY.

## Gotchas

- **Stop IDs** end with N (northbound/uptown) or S (southbound/downtown). Example: 127N = Times Sq northbound
- **Subway needs zero config** — no API key for any subway command
- **Bus requires free API key** — get one at https://register.developer.obanyc.com/
- Multiple feeds exist; the skill auto-fetches the right one(s) for the line
- NYCT extensions provide train_id, direction, and actual vs scheduled track
- Use `--stop-search` for fuzzy matching, `--stop` for exact IDs
- "Penn Station" matches the subway stop, not Amtrak
- "Union Square", "Jamaica" — disambiguated by context (subway vs LIRR)
