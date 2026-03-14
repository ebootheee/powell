# Changelog

## 2026-03-13

### Research & Planning
- Completed data source research: confirmed USGS Water Services API (site 09379900) returns Lake Powell elevation with CORS enabled
- Confirmed downstream release data available at USGS site 09380000 (Lees Ferry)
- Identified Bureau of Reclamation hydrodata endpoints (site 919) for inflow, storage, release breakdown
- Cataloged all Glen Canyon Dam operating thresholds from 3,700 ft (full pool) to 3,370 ft (dead pool)
- Researched forecasting methodology: mass-balance approach with SWE-driven inflow projection
- Selected tech stack: Vanilla JS + Chart.js (no build step) for Azure SWA deployment
- Created initial PLAN.md with architecture, data sources, algorithm design, and phased implementation
