# Changelog

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
