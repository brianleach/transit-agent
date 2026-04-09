# CTA — Chicago, IL

Chicago Transit Authority. Operates the L (elevated/subway rapid transit) and an extensive bus network.

## Quick Reference

| Mode | Lines/Routes | Notes |
|------|-------------|-------|
| L Train | 8 lines (Red, Blue, Brown, Green, Orange, Purple, Pink, Yellow) | Rapid transit, ~1 min data refresh |
| Bus | 100+ routes | ~30 sec data refresh |

## L Train Lines

| Code | Line | Terminals |
|------|------|-----------|
| Red | Red Line | Howard ↔ 95th/Dan Ryan |
| Blue | Blue Line | O'Hare ↔ Forest Park |
| Brn | Brown Line | Kimball ↔ Loop |
| G | Green Line | Harlem/Lake ↔ Ashland/63rd or Cottage Grove |
| Org | Orange Line | Midway ↔ Loop |
| P | Purple Line | Linden ↔ Howard (Express to Loop weekdays) |
| Pink | Pink Line | 54th/Cermak ↔ Loop |
| Y | Yellow Line | Dempster-Skokie ↔ Howard |

## Key Bus Routes

| Route | Name | Notes |
|-------|------|-------|
| 22 | Clark | Major north-south corridor |
| 36 | Broadway | North Side lakefront |
| 77 | Belmont | Major east-west crosstown |
| 151 | Sheridan | Lakefront express |
| 8 | Halsted | Long north-south route |
| 9 | Ashland | Major north-south corridor |
| 49 | Western | Longest route in system |

## API Details

CTA uses 3 REST APIs. Train and Bus Trackers require free API keys. Alerts are open access.

### API Keys Required

| API | Key Env Var | Get Key At |
|-----|-------------|------------|
| Train Tracker | `CTA_TRAIN_API_KEY` | https://www.transitchicago.com/developers/traintrackerapply/ |
| Bus Tracker | `CTA_BUS_API_KEY` | https://www.transitchicago.com/developers/bustracker/ |
| Customer Alerts | None needed | — |

### Endpoints

| Endpoint | Auth | Format |
|----------|------|--------|
| `lapi.transitchicago.com/api/1.0/ttarrivals.aspx` | Train key | JSON |
| `lapi.transitchicago.com/api/1.0/ttpositions.aspx` | Train key | JSON |
| `www.ctabustracker.com/bustime/api/v2/*` | Bus key | JSON |
| `www.transitchicago.com/api/1.0/alerts.aspx` | None | JSON |

### GTFS Static

| Feed | URL |
|------|-----|
| Static (ZIP) | `https://www.transitchicago.com/downloads/sch_data/google_transit.zip` |

## Script Usage

```bash
# L train arrivals
node scripts/cta_arrivals.js arrivals --station "Clark/Lake"
node scripts/cta_arrivals.js arrivals --mapid 40380
node scripts/cta_arrivals.js arrivals --stop-search "belmont" --route Red

# Bus predictions
node scripts/cta_arrivals.js bus-arrivals --stop 456 --route 22
node scripts/cta_arrivals.js bus-arrivals --stop-search "michigan"

# Vehicle tracking
node scripts/cta_arrivals.js vehicles --route Red
node scripts/cta_arrivals.js bus-vehicles --route 22

# Alerts (no API key needed)
node scripts/cta_arrivals.js alerts
node scripts/cta_arrivals.js alerts --route Red

# Routes and stops
node scripts/cta_arrivals.js routes
node scripts/cta_arrivals.js bus-routes
node scripts/cta_arrivals.js stops --search "belmont"
node scripts/cta_arrivals.js stops --near 41.8781,-87.6298

node scripts/cta_arrivals.js refresh-gtfs
```

## Timezone

US Central (CST/CDT). All times in 12-hour AM/PM format.

## Fares (2026)

| Fare Type | Price |
|-----------|-------|
| Regular (Ventra/contactless) | $2.50 |
| Bus transfer | $0.25 |
| Rail-to-rail transfer | Free within 2 hours |
| 1-Day Pass | $5.00 |
| 7-Day Pass | $20.00 |
| 30-Day Pass | $75.00 |

## Gotchas

- **Station IDs**: Parent stations in 4xxxx range (mapid), directional stops in 3xxxx range
- Use `--station` or `--stop-search` for name lookups, `--mapid` for exact station IDs
- Alerts always work without API keys — check alerts first if something seems wrong
- Train data refreshes ~1 minute; bus data ~30 seconds
- In the Loop, trains may show arriving from different directions depending on the line
- Route aliases: "brown" → Brn, "green" → G, "orange" → Org, "purple" → P
