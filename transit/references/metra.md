# Metra — Chicago, IL (Commuter Rail)

Metra commuter rail serves the six-county northeastern Illinois region with 11 lines radiating from downtown Chicago. Distinct from CTA (L trains and buses).

## Quick Reference

| Mode | Lines | Notes |
|------|-------|-------|
| Commuter Rail | 11 lines | GTFS-RT with Bearer auth, key required |

## Metra Lines

| Code | Line Name | Downtown Terminal | Outer Terminal |
|------|-----------|-------------------|----------------|
| BNSF | BNSF Railway | Union Station | Aurora |
| ME | Metra Electric | Millennium Station | University Park / South Chicago / Blue Island |
| HC | Heritage Corridor | Union Station | Joliet |
| MD-N | Milwaukee District North | Union Station | Fox Lake |
| MD-W | Milwaukee District West | Union Station | Elburn / Big Timber |
| NCS | North Central Service | Union Station | Antioch |
| RI | Rock Island | LaSalle Street Station | Joliet |
| SWS | SouthWest Service | Union Station | Manhattan |
| UP-N | Union Pacific North | Ogilvie | Kenosha |
| UP-NW | Union Pacific Northwest | Ogilvie | Harvard / McHenry |
| UP-W | Union Pacific West | Ogilvie | Elburn |

## Downtown Terminals

- **Chicago Union Station (CUS)** — BNSF, HC, MD-N, MD-W, NCS, SWS
- **Ogilvie Transportation Center (OTC)** — UP-N, UP-NW, UP-W
- **LaSalle Street Station** — RI
- **Millennium Station** — ME

## API Details

All GTFS-RT feeds require a Bearer token.

| Detail | Value |
|--------|-------|
| Env Var | `METRA_API_KEY` |
| Register | https://metra.com/developers |
| Base URL | `https://gtfspublic.metrarr.com` |
| Auth | `Authorization: Bearer {key}` header |

### GTFS-RT Feeds (updated every ~30 seconds)

| Feed | Endpoint |
|------|----------|
| Trip Updates | `/gtfs/public/tripupdates` |
| Vehicle Positions | `/gtfs/public/positions` |
| Alerts | `/gtfs/public/alerts` |

### GTFS Static

| Feed | URL |
|------|-----|
| Schedule (ZIP) | `https://schedules.metrarail.com/gtfs/schedule.zip` |
| Published timestamp | `https://schedules.metrarail.com/gtfs/published.txt` |

## Script Usage

```bash
# Arrivals
node scripts/metra_arrivals.js arrivals --station "Union Station"
node scripts/metra_arrivals.js arrivals --station "Naperville" --line BNSF

# Vehicle tracking
node scripts/metra_arrivals.js vehicles --line BNSF

# Alerts
node scripts/metra_arrivals.js alerts
node scripts/metra_arrivals.js alerts --line BNSF

# Routes and stops
node scripts/metra_arrivals.js routes
node scripts/metra_arrivals.js stops --search "downers grove"
node scripts/metra_arrivals.js stops --line BNSF

# Fares
node scripts/metra_arrivals.js fares --from "Union Station" --to "Naperville"

# Schedule
node scripts/metra_arrivals.js schedule --station "Naperville"

node scripts/metra_arrivals.js refresh-gtfs
```

## Timezone

US Central (CST/CDT). All times in 12-hour AM/PM format.

## Fares (4-Zone System, effective Feb 2024)

| Ticket Type | Zones 1-2 | Zones 1-2-3 | Zones 1-2-3-4 |
|-------------|-----------|-------------|---------------|
| One-Way | $3.75 | $5.50 | $6.75 |
| Day Pass | $7.50 | $11.00 | $13.50 |
| Monthly Pass | $75.00 | $110.00 | $135.00 |

Special: Saturday/Sunday/Holiday Day Pass $7.00 (systemwide), Weekend Pass $10.00 (Ventra app), Onboard Surcharge $5.00.

## Gotchas

- **Metra ≠ CTA** — Metra is commuter rail, CTA is rapid transit (L) and buses
- Metra uses **inbound** (toward downtown) and **outbound** (away from downtown) directions
- Train numbers matter — riders often know their train by number (e.g., "the 7:42 BNSF")
- Different lines use different downtown terminals — always specify which
- Peak trains during rush hours; off-peak and weekend service is less frequent
- If real-time data unavailable, fall back to static schedule
- Vehicle positions may drop when trains are underground or at terminals (GPS loss)
- All feeds require the API key — unlike CTA, there's no unauthenticated endpoint
