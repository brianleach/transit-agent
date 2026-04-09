# CapMetro — Austin, TX

Austin's Capital Metropolitan Transportation Authority. Operates MetroBus, MetroRapid (BRT), and MetroRail (Red Line commuter rail).

## Quick Reference

| Mode | Routes | Notes |
|------|--------|-------|
| MetroRail (Red Line) | 550 | Leander ↔ Downtown, limited frequency |
| MetroRapid | 801, 803 | BRT, every 10-12 min peak |
| MetroBus | 1-325+ | Local and crosstown routes |
| Night Owl | 985 | Late-night service |

## Key Routes

| Route | Name | Type |
|-------|------|------|
| 550 | MetroRail Red Line | Rail (Leander ↔ Downtown) |
| 801 | MetroRapid North/South | Rapid Bus (Tech Ridge ↔ Southpark Meadows) |
| 803 | MetroRapid Burnet/South Lamar | Rapid Bus (Domain ↔ Westgate) |
| 1 | N Lamar/S Congress | Local Bus |
| 7 | Duval/Dove Springs | Local Bus |
| 10 | S 1st/Red River | Local Bus |
| 20 | Manor Rd/Riverside | Local Bus |
| 300 | Oltorf/Riverside Crosstown | Crosstown Bus |
| 325 | Ohlen/Loyola | Crosstown Bus |
| 985 | Night Owl | Late Night Service |

## API Details

All data from Texas Open Data Portal — **no API key required**.

### GTFS-RT Feeds (updated every ~15 seconds)

| Feed | URL |
|------|-----|
| Vehicle Positions (JSON) | `https://data.texas.gov/download/cuc7-ywmd/text%2Fplain` |
| Vehicle Positions (Protobuf) | `https://data.texas.gov/download/eiei-9rpf/application%2Foctet-stream` |
| Trip Updates (Protobuf) | `https://data.texas.gov/download/rmk2-acnw/application%2Foctet-stream` |
| Service Alerts (Protobuf) | `https://data.texas.gov/download/nusn-7fcn/application%2Foctet-stream` |

### GTFS Static

| Feed | URL |
|------|-----|
| Static (ZIP) | `https://data.texas.gov/download/r4v4-vz24/application%2Fx-zip-compressed` |

## Script Usage

```bash
node scripts/capmetro_arrivals.js alerts
node scripts/capmetro_arrivals.js vehicles [--route 801]
node scripts/capmetro_arrivals.js arrivals --stop <stop_id>
node scripts/capmetro_arrivals.js arrivals --stop-search "lakeline" --route 550
node scripts/capmetro_arrivals.js arrivals --stop-search "downtown" --route 550 --headsign "lakeline"
node scripts/capmetro_arrivals.js stops --search "domain"
node scripts/capmetro_arrivals.js stops --near 30.4,-97.7
node scripts/capmetro_arrivals.js routes
node scripts/capmetro_arrivals.js route-info --route 801
node scripts/capmetro_arrivals.js refresh-gtfs
```

## Timezone

US Central (CST/CDT). All times displayed in 12-hour AM/PM format.

## Fares (2025)

| Fare Type | Price |
|-----------|-------|
| Local / MetroRapid | $1.25 |
| MetroRail | $3.50 |
| Day Pass | $2.50 |
| 7-Day Pass | $11.25 |
| 31-Day Pass | $41.25 |

Payment via Umo app, tap-to-pay, or fare card. Free transfers within 2 hours.

## Gotchas

- **Stop IDs** are on CapMetro stop signs and in the Transit app
- MetroRapid 801/803 have the highest frequency
- MetroRail Red Line (550) has limited frequency — check schedule
- Vehicle position data updates every ~15 seconds
- GTFS static data must be downloaded on first use (`refresh-gtfs`)
- If a protobuf feed returns HTML, the endpoint may be temporarily unavailable
