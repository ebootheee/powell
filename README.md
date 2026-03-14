# Lake Powell Water Level Analyzer

A single-page web app for analyzing Lake Powell's water level against Glen Canyon Dam's operating thresholds, with interactive forecasting.

## How It Works

The app fetches live water level data from USGS, displays 3 years of history on an animated chart, and projects the reservoir trajectory forward based on user-adjustable inflow and release assumptions. Critical dam operating thresholds are shown as reference lines so users can see when and whether the lake will cross them.

## Data Sources

- **USGS Water Services** — Lake elevation (site 09379900), downstream discharge (09380000)
- **Bureau of Reclamation** — Inflow, storage, release breakdown (site 919)
- **NRCS SNOTEL** — Snowpack data (future enhancement)

## Tech Stack

- Vanilla HTML/CSS/JS (no build step)
- Chart.js for visualization (CDN)
- chartjs-plugin-annotation for threshold lines
- All data fetched client-side

## Deployment

Deployed to Azure Static Web Apps via GPP Dev MCP tools.

```bash
# Small app (inline deploy)
deploy_push(app: "powell", files: {...}, changes: "description")

# Or local script for larger deployments
node scripts/deploy-local.mjs powell ./powell "description"
```

## Project Structure

```
powell/
├── index.html        # Main app page
├── forecast.js       # Forecasting engine (mass-balance, storage↔elevation)
├── forecast.test.js  # Forecast validation tests
├── data.js           # API fetch and data normalization
├── PLAN.md           # Implementation plan
├── CHANGELOG.md      # Change log
├── ROADMAP.md        # Future improvements
└── README.md         # This file
```
