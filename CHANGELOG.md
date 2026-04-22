# Changelog

## 2026-04-22

### Changed
- Default chart x-axis range now auto-computed from current observation: starts 3 months before (Jan 2026 for current conditions) and extends 17 months ahead. Previously hardcoded to Jul 2025 → Jul 2027, which left a stale historical tail on the left
- Threshold annotation labels staggered horizontally across the chart (8% → 28% → 48% → 68% → 85% → 95% positions) instead of all stacking at the start/end edges. Eliminates the label pileups that obscured the chart
- Chart container height bumped (480px → 540px desktop, 340px → 380px mobile) and chart layout padding added so x-axis date labels render fully without clipping
- Release Rate Multiplier slider is now disabled and visually grayed out when Auto-tier or Emergency policies are active, since those policies override the slider value with BOR's tier structure. Description text updated to explain the override

## 2026-04-21

### Added
- `predictSpringNetGain()` now clamps regression output to physical bounds `[-1.5, +8.0]` MAF. Prevents nonsensical extrapolation at very low or high SWE (the raw regression predicted -4.3 MAF at April 2026's SWE ≈ 1,034, which is physically implausible when BOR operating authorities constrain releases)
- `forecast()` gains two new optional parameters:
  - `dynamicReleases: boolean` — release multiplier is computed per-step from current elevation using BOR's 2007 Interim Guidelines + 2024 SEIS ROD Section 6(E) tier structure (1.10x above 3,575 → 1.00x above 3,525 → 0.95x above 3,500 → 0.80x above 3,490 → 0.67x below)
  - `droaMAF: number` — simulates upstream augmentation (Flaming Gorge / Blue Mesa / Navajo per the 2019 DROA) by adding the total evenly over `droaDurationMonths` (default 12)
- `releaseMultiplierForElevation()` and `droaMonthlyBoost()` helpers exported
- `BOR_APR2026_MOST_PROBABLE` — 16-month reference dataset from the April 17, 2026 24-Month Study, Model Run ID 3310. Chart now overlays this as a dashed gray reference line
- Policy scenario toggle on home page: **Fixed releases** (default, historical behavior) / **Auto-tier releases** (dynamic) / **Emergency (Apr 2026)** (dynamic + 1 MAF DROA augmentation)
- Emergency advisory banner at top of home page citing the April 17, 2026 BOR announcement
- Methodology page: new sections on Policy Scenarios, Emergency Actions (DROA + Section 6(E)), and Reconciliation with BOR's 24-Month Study
- 16 new tests covering SWE regression bounds, tier-aware release multipliers, dynamic vs. static drawdown comparison, DROA augmentation, and BOR Dec 2026 reconciliation (60 tests total, all passing)

### Fixed
- Forecast no longer collapses to dead pool in drought scenarios. Previously, at SWE=1034 our base case projected dead pool (3,370 ft) by December 2026; BOR's Most Probable shows 3,471 ft. With the new clamp + Auto-tier policy, the model matches BOR's December projection within 10 ft when driven by comparable inputs

## 2026-03-19

### Added
- Daily data caching system (`scripts/cache-data.mjs`) — fetches USGS elevation + NOAA snowpack, runs 5 forecast scenarios, saves snapshots
- GitHub Actions workflow (`.github/workflows/daily-cache.yml`) — runs daily at 6 AM UTC
- Forecast snapshot storage (`cache/forecasts/YYYY-MM-DD.json`) — timestamped predictions for backtesting
- Control dataset (`cache/control.json`) — accumulates actual observations for regression refinement
- Cache-first data loading in `data.js` — checks `cache/current.json` (36h freshness), falls back to live APIs

### Fixed
- Chart x-axis now shows full forecast range on initial load (changed `suggestedMax` to `max`)

## 2026-03-14

### Added
- Navigation header (Home | API | Methodology) across all three pages
- Dead pool clamp warning when forecast floors at 3,370 ft
- Forecast input timestamp showing SWE, release multiplier, and generation date
- Table of contents with anchor links on methodology.html
- Water drop favicon on all pages
- `staticwebapp.config.json` for public (no SSO) Azure SWA deployment
- `api.html` — public forecast API with interactive form, URL hash API, JS module docs, and Claude/LLM integration instructions
- `methodology.html` — white paper explaining the forecasting model for general audiences

### Changed
- Chart threshold annotations: staggered label positions, key thresholds (DROA, Min Power Pool, Dead Pool) shown larger/bolder with semi-transparent backgrounds
- Home nav link uses `./` instead of `/index.html` for correct active state detection

### Fixed
- SSO blocking public access — added explicit `staticwebapp.config.json` with anonymous access

## 2026-03-13

### Added
- `forecast.js` — mass-balance forecast engine with SWE regression (R²=0.899), 20-point elevation-storage lookup table, monthly net storage model calibrated from 2020-2025 data
- `forecast.test.js` — 44-test validation suite including 5-year hindcast (2020-2024), monotonicity checks, threshold analysis, and 2026 forward scenarios
- `data.js` — client-side API fetch module for USGS elevation data, NOAA NCEI snowpack (10 SNOTEL stations), and historical April 1 SWE
- `index.html` — main visualization page with Chart.js time-series, threshold annotations, interactive SWE/release sliders, hero stats, and consequence display
- Initial deployment to Azure SWA (gpp-powell)

### Research & Planning
- Confirmed USGS Water Services API (site 09379900) for Lake Powell elevation with CORS
- Identified NOAA NCEI as SNOTEL data source (NRCS endpoints unreachable)
- Validated 10 Upper Colorado Basin SNOTEL stations return data via NCEI
- Cataloged Glen Canyon Dam thresholds from 3,700 ft (full pool) to 3,370 ft (dead pool)
- Designed mass-balance forecasting approach with volume-based (MAF) decline rates
- Created PLAN.md with architecture, data sources, algorithm design, and phased implementation
