# Lake Powell Water Level Analyzer

A public web app for analyzing Lake Powell's water level against Glen Canyon Dam's operating thresholds, with interactive snowpack-based forecasting and a public API.

**Live:** https://gray-mushroom-071fcfc0f.6.azurestaticapps.net
**Repo:** https://github.com/ebootheee/powell

## Architecture

The app fetches live data from USGS and NOAA NCEI, displays 3 years of history on an animated Chart.js chart, and projects the reservoir trajectory forward using a mass-balance model driven by snowpack (SWE) regression. Users adjust SWE scenario and release rate via sliders; the forecast and threshold crossings update in real-time.

All computation runs client-side. No backend, no API keys, no build step. A daily GitHub Actions job caches data and saves forecast snapshots for backtesting.

## Data Sources

| Source | What | Site/Param |
|--------|------|------------|
| USGS Water Services | Lake elevation (daily) | Site 09379900, param 62614 |
| NOAA NCEI | Snowpack SWE (daily) | 10 SNOTEL stations, WESD datatype |
| NOAA NCEI | Historical April 1 SWE | Same stations, 2020-2025 |

## Source Structure

```
powell/
├── index.html                 # Main visualization page
├── forecast.js                # Forecast engine (ESM module)
│                              #   - Elevation-storage lookup table (20 points)
│                              #   - SWE → spring net gain regression (R²=0.899)
│                              #   - Monthly mass-balance model (MAF)
│                              #   - Threshold definitions and analysis
├── data.js                    # API fetch module (USGS, NCEI)
├── api.html                   # Public API — interactive form + docs
├── methodology.html           # White paper explaining the model
├── forecast.test.js           # 44-test validation suite
├── scripts/
│   └── cache-data.mjs         # Daily data fetch + forecast snapshot script
├── cache/
│   ├── current.json           # Cached live data (elevation, snowpack)
│   ├── control.json           # Actual observations for backtesting
│   └── forecasts/
│       ├── index.json         # Forecast snapshot index
│       └── YYYY-MM-DD.json    # Daily forecast snapshots (5 scenarios)
├── .github/workflows/
│   └── daily-cache.yml        # Daily cron job (6 AM UTC)
├── staticwebapp.config.json   # Azure SWA config (public access)
├── PLAN.md                    # Implementation plan
├── CHANGELOG.md               # Change log
├── ROADMAP.md                 # Future improvements
└── README.md                  # This file
```

## Key Files

| File | Purpose |
|------|---------|
| `forecast.js` | Core engine: `forecast()`, `elevationToStorage()`, `storageToElevation()`, `predictSpringNetGain()`, `findLowPoint()`, `getCrossedThresholds()` |
| `data.js` | `loadAllData()` — cache-first with live API fallback |
| `scripts/cache-data.mjs` | Daily job: fetches data, runs 5 scenarios, saves snapshots |
| `index.html` | Chart.js visualization, sliders, threshold display, hero stats |
| `api.html` | Public API: URL hash params, JS module import, Claude/LLM integration |

## Tech Stack

- Vanilla HTML/CSS/JS (ESM modules, no build step)
- Chart.js 4.4.7 + chartjs-adapter-date-fns + chartjs-plugin-annotation (CDN)
- Dark theme with CSS custom properties

## Forecast Model

Mass-balance approach: `Storage(t+1) = Storage(t) + monthly_net_change_MAF`

- **SWE regression:** `net_gain = 0.001732 × SWE - 6.037` (R² = 0.899)
- **Monthly net storage:** Calibrated from 2020-2025 BOR data (in MAF)
- **Elevation ↔ Storage:** 20-point BOR area-capacity lookup with linear interpolation
- **Hindcast accuracy:** ±4 ft for current-regime years (2023-2024), ±25-39 ft for atypical release years

## Deploy

Public deployment on Azure Static Web Apps (Free tier, no SSO):

```bash
# From the GPP-Dev project root:
node scripts/deploy-local.mjs powell ./powell --public "description of changes"
```

## Run Tests

```bash
node powell/forecast.test.js
```
