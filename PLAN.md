# Lake Powell Water Level Analyzer — Implementation Plan

**Status:** Research Complete, Ready to Build
**Last Updated:** 2026-03-13

## Objective

Build a single-page, animated web app that lets users analyze Lake Powell's water level situation against Glen Canyon Dam's operating thresholds. Users see the current level, historical trends, and a forecasted trajectory to this year's low point — with consequences clearly shown at each critical elevation.

---

## Architecture

**Stack:** Vanilla HTML/CSS/JS + Chart.js (CDN, no build step)
**Hosting:** Azure Static Web Apps via GPP Dev MCP (`deploy_push`)
**Data:** All client-side fetches to public government APIs (CORS confirmed for USGS)

### Why This Stack
- Zero build step = trivial deployment via `deploy_push`
- Chart.js provides animated time-series charts, threshold annotation lines, and interactive tooltips out of the box
- All APIs are public and free — no keys, no backend needed
- Single HTML file (or small set) keeps it under the SWA inline deploy limit
- If NRCS SNOTEL has CORS issues, we can pre-bake snowpack data as static JSON or use Azure Functions proxy on Standard tier

---

## Data Sources (Confirmed Working)

### 1. Lake Powell Elevation (Primary)
- **API:** USGS Water Services
- **Site:** `09379900` (Lake Powell at Glen Canyon Dam, AZ)
- **Parameter:** `62614` (elevation above NGVD 1929, ft)
- **CORS:** `Access-Control-Allow-Origin: *` ✅
- **URL Pattern:**
  ```
  https://waterservices.usgs.gov/nwis/dv/?format=json&sites=09379900&parameterCd=62614&startDT={start}&endDT={end}
  ```
- **Current reading:** 3,529.4 ft (March 12, 2026) — 39.4 ft above minimum power pool

### 2. Downstream Releases
- **API:** USGS Water Services
- **Site:** `09380000` (Colorado River at Lees Ferry, AZ — immediately below dam)
- **Parameter:** `00060` (discharge, cfs)
- **CORS:** ✅ (same USGS service)
- **Current:** ~7,800-8,100 cfs

### 3. Bureau of Reclamation (Backup / Additional Metrics)
- **Site:** 919 (Lake Powell)
- **Endpoints:** `https://www.usbr.gov/uc/water/hydrodata/reservoir_data/919/json/{ID}.json`
- **Key IDs:** 49 (elevation), 17 (storage), 29 (inflow), 42 (total release), 39 (power release)
- **Data back to 1963**, simple JSON arrays
- **CORS:** Needs testing — may need proxy or static pre-fetch

### 4. Snowpack (SWE)
- **API:** NRCS Report Generator
- **URL Pattern:**
  ```
  https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/{stationTriplet}/{dateRange}/WTEQ::value
  ```
- **Status:** Server currently timing out (2026-03-13). May be intermittent.
- **Fallback:** Pre-fetch snowpack data as static JSON, or use USGS inflow as proxy
- **Key stations:** Upper Colorado Basin SNOTEL network

### 5. Upstream Inflow Proxy
- **API:** USGS Water Services
- **Site:** `09180500` (Colorado River near Cisco, UT)
- **Parameter:** `00060` (discharge, cfs)
- **CORS:** ✅
- **Use:** Alternative to SNOTEL — actual measured inflow correlates with snowmelt

---

## Glen Canyon Dam Operating Thresholds

These are the core reference lines on the visualization:

| Elevation (ft) | Label | Consequence |
|---|---|---|
| **3,700** | Full Pool | Maximum capacity, 24.3 MAF, 1,320 MW generation |
| **3,575** | Upper/Mid Tier Boundary | Releases reduced from 8.23 to 7.48 MAF/year |
| **3,525** | DROA Target | Drought response trigger, upstream reservoirs release water to Powell |
| **3,500** | Emergency Planning | Secretary must plan for releases as low as 6.0 MAF/year |
| **3,490** | Minimum Power Pool | **Hydropower stops** — 1,320 MW lost, $billions in replacement costs |
| **3,470** | Penstock Intake | Penstocks inoperable, only river outlet works remain |
| **3,370** | Dead Pool | **No water passes through dam** — treaty violations, catastrophic |

---

## Forecasting Algorithm

### Approach: Mass-Balance with SWE-Driven Inflow Projection

The reservoir level at any future date is:

```
Elevation(t+1) = StorageToElevation(
  ElevationToStorage(Elevation(t)) + Inflow(t) - Release(t) - Evap(t)
)
```

### Key Components

1. **Elevation ↔ Storage Conversion**
   - Lake Powell has a published area-capacity table
   - Fit a polynomial regression to convert between elevation (ft) and storage (acre-ft)
   - This is a non-linear relationship (lake gets wider at higher elevations)

2. **Inflow Projection (the hard part)**
   - **Historical approach:** Use April 1 SWE (% of median) to predict April-July inflow volume via linear regression (R² ~0.70-0.85)
   - **Before April 1:** Use current SWE reading as a proxy, noting that snowpack hasn't peaked yet
   - **User controls:** Slider for inflow scenario (dry/normal/wet) maps to percentiles of historical inflow distribution
   - **Monthly distribution:** Use historical monthly inflow fractions to spread annual total across months

3. **Release Projection**
   - Default to current operating tier release rate (currently 7.48 MAF/year = ~625 KAF/month)
   - User can adjust release rate slider
   - Show how different release policies change the trajectory

4. **Evaporation**
   - Relatively small (~500 KAF/year at current levels)
   - Use historical monthly averages, scaled by surface area (which scales with elevation)

### What the User Sees

- **Main chart:** 3 years of historical elevation + projected trajectory to year-end
- **Threshold lines:** Horizontal reference lines at each critical elevation with labels
- **Forecast band:** Shaded area showing range between dry and wet scenarios
- **Interactive sliders:**
  - Inflow scenario (dry → wet)
  - Release rate
- **"What happens" panel:** When the projected low point crosses a threshold, show the consequences

### Testing the Algorithm

Build the forecasting math as a standalone JS module with unit tests:
- `forecast.js` — pure functions for mass-balance, storage↔elevation conversion, inflow projection
- `forecast.test.js` — test cases against known historical outcomes (e.g., does the model predict the 2022 low of ~3,522 ft when fed 2022 SWE data?)
- Run tests with a simple HTML test harness or Node.js
- Once validated, the same module is imported into the main app

---

## UX Design

### Layout (Single Page)

```
┌─────────────────────────────────────────────────┐
│  LAKE POWELL WATER LEVEL ANALYZER               │
│  Current: 3,529.4 ft  ▼ -1.1 ft this month     │
│  [40 ft above minimum power pool]               │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  MAIN CHART                             │    │
│  │  3-year historical + forecast           │    │
│  │  Threshold lines with labels            │    │
│  │  Shaded forecast confidence band        │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  Inflow Scenario:  [===●=====] 85% of median    │
│  Release Rate:     [=====●===] 7.48 MAF/yr      │
│                                                 │
├─────────────────────────────────────────────────┤
│  PROJECTED LOW POINT: 3,485 ft (November 2026)  │
│  ⚠ Below Minimum Power Pool (3,490 ft)          │
│                                                 │
│  What this means:                               │
│  • Hydropower generation stops (1,320 MW lost)  │
│  • $X billion in replacement power costs        │
│  • Tribal communities hit hardest               │
│  • Southwest grid loses critical balancing       │
├─────────────────────────────────────────────────┤
│  THRESHOLD BREAKDOWN                            │
│  [Visual gauge showing current level vs each]   │
└─────────────────────────────────────────────────┘
```

### Animation
- On load: chart draws historical line animating left to right
- Forecast line extends with a different style (dashed, lighter color)
- When user adjusts sliders, forecast line smoothly redraws
- Current level indicator pulses subtly
- Threshold crossings highlighted with color change

### Visual Design
- Dark background (navy/charcoal) — makes the water-blue chart pop
- Threshold zones as subtle horizontal color bands (green → yellow → orange → red)
- Clean typography, minimal UI chrome
- Mobile responsive (Chart.js handles this)

---

## Implementation Phases

### Phase 1: Data Layer + Forecasting Engine
- [ ] Build `forecast.js` with elevation↔storage conversion, mass-balance projector
- [ ] Build test harness with known historical validation cases
- [ ] Build `data.js` for USGS API fetching and data normalization
- [ ] Validate forecast against 2022-2025 actuals

### Phase 2: Core Visualization
- [ ] HTML/CSS layout with Chart.js
- [ ] Main time-series chart with 3 years of historical data
- [ ] Threshold annotation lines with labels and color zones
- [ ] Animated chart drawing on load
- [ ] Current level hero display

### Phase 3: Interactive Forecasting
- [ ] Forecast projection line on chart
- [ ] Inflow scenario slider
- [ ] Release rate slider
- [ ] Confidence band (shaded area between dry/wet scenarios)
- [ ] "What happens" consequence panel that updates with forecast

### Phase 4: Polish + Deploy
- [ ] Visual design refinement (dark theme, color palette)
- [ ] Mobile responsiveness
- [ ] Loading states and error handling for API calls
- [ ] Deploy to Azure SWA via `deploy_push` or `deploy-local.mjs`
- [ ] Verify SSO + functionality

---

## Key Decisions

### 1. Snowpack Data Source (DECISION NEEDED)
**Problem:** NRCS SNOTEL servers are currently unreachable (connection timeout).
**Options:**
- **A) Use USGS inflow data as proxy** — Colorado River at Cisco (09180500) gives actual measured upstream flow. Simpler, more reliable, CORS confirmed. Doesn't give "snowpack" as a leading indicator though.
- **B) Pre-bake SNOTEL data** — Fetch snowpack data server-side periodically, serve as static JSON. Adds maintenance burden.
- **C) Try NRCS at runtime, fall back gracefully** — Best of both worlds if SNOTEL is usually available.
- **Recommendation:** Start with **A** (USGS inflow) for v1, add SNOTEL later if desired. The inflow data is what actually matters for the mass-balance calculation, and it's already a measured value rather than a proxy-of-a-proxy.

### 2. Elevation-Storage Polynomial
**Problem:** Need the area-capacity curve for Lake Powell to convert between elevation and storage.
**Options:**
- **A) Derive from BOR data** — They publish both elevation (ID 49) and storage (ID 17) daily. Fit a polynomial to the paired data.
- **B) Use published coefficients** — BOR may publish the polynomial directly.
- **Recommendation:** **A** — straightforward and verifiable.

### 3. Historical Inflow Distribution
**Problem:** To project monthly inflow from an annual total, we need the typical monthly distribution.
**Solution:** Compute average monthly fractions from 3+ years of historical inflow data (BOR site 919, ID 29).

### 4. How Far to Forecast
**Options:**
- Through end of current water year (September 30)
- Through the projected low point (typically March/April of next year)
- **Recommendation:** Through March of next year — shows the full cycle and the true low point.

### 5. Deployment
**Decision:** Azure Static Web Apps via GPP Dev MCP.
- No advantage to Vercel — SWA already has the pipeline, SSO, and serverless functions if needed
- Single HTML file + JS will be well under the `deploy_push` inline limit
- If app grows beyond 3 files, use `deploy-local.mjs`

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| NRCS SNOTEL API unreachable | Medium | Low | Use USGS inflow data instead |
| BOR JSON endpoint lacks CORS | Medium | Low | Pre-fetch as static JSON or use Azure Functions proxy |
| Forecast accuracy poor | Medium | Medium | Validate against known years, show confidence bands, disclaim |
| USGS API rate limits | Low | Medium | Cache responses, reduce fetch frequency |
| Elevation-storage polynomial fit poor | Low | High | Use enough data points, validate against known pairs |
