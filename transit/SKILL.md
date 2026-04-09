---
name: transit
description: Real-time public transit arrivals, alerts, route info, and journey planning for Austin (CapMetro), Chicago (CTA and Metra), New York City (MTA subway and buses), and London (TfL Underground, DLR, Overground, Elizabeth line, buses). Use when the user asks about train times, bus schedules, next arrivals, service alerts, transit directions, or mentions specific routes, stations, or stops in these cities.
---

# Transit

Multi-city public transit data. Covers **Austin** (CapMetro), **Chicago** (CTA + Metra), **New York City** (MTA), and **London** (TfL).

## Usage

### 1. Identify the agency

| City | Agency | Clues |
|------|--------|-------|
| Austin, TX | CapMetro | MetroRapid, 801, 803, Red Line 550, Lakeline |
| Chicago, IL | CTA | L train, Blue/Red/Brown Line, CTA bus |
| Chicago, IL | Metra | Commuter rail, BNSF, UP-N, Union Station |
| New York, NY | MTA | Subway, A/C/E, 1/2/3, MTA bus, OMNY |
| London, UK | TfL | Tube, Underground, DLR, Overground, Elizabeth line, Oyster |

### 2. Read the reference doc

Each agency has a reference doc with route details, API info, and gotchas:

- `references/capmetro.md`
- `references/cta.md`
- `references/mta.md`
- `references/tfl.md`
- `references/metra.md`

### 3. Run the script

For live data, run the compiled script:

```bash
node scripts/capmetro_arrivals.js arrivals --stop-search "lakeline"
node scripts/cta_arrivals.js arrivals --station "Clark/Lake"
node scripts/mta_arrivals.js arrivals --stop-search "times square"
node scripts/tfl_arrivals.js status
node scripts/metra_arrivals.js arrivals --station "Naperville" --line BNSF
```

All scripts support `--help` and `--json`.
