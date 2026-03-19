#!/usr/bin/env node
/**
 * cache-data.mjs — Fetch live data from USGS/NOAA, run forecasts, write cache files.
 *
 * Outputs:
 *   cache/current.json        — Latest elevation, snowpack, historical SWE, metadata
 *   cache/forecasts/YYYY-MM-DD.json — Daily forecast snapshot for backtesting
 *   cache/forecast-index.json — Index of all forecast snapshots
 *
 * Usage:
 *   node scripts/cache-data.mjs
 *
 * Designed to run in GitHub Actions on a daily cron schedule.
 * No API keys required — USGS and NCEI are public, CORS-enabled APIs.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, 'cache');
const FORECASTS_DIR = join(CACHE_DIR, 'forecasts');

// Ensure dirs exist
mkdirSync(FORECASTS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// API Constants (mirror data.js)
// ---------------------------------------------------------------------------
const USGS_BASE = 'https://waterservices.usgs.gov/nwis/dv/';
const NCEI_BASE = 'https://www.ncei.noaa.gov/access/services/data/v1';
const POWELL_SITE = '09379900';
const PARAM_ELEVATION = '62614';

const SNOTEL_STATIONS = [
  'USS0006J03S', 'USS0006J09S', 'USS0006L02S', 'USS0006L11S',
  'USS0007M12S', 'USS0009G03S', 'USS0009J01S', 'USS0007J03S',
  'USS0006K24S', 'USS0006K29S',
];

// ---------------------------------------------------------------------------
// Elevation ↔ Storage table (mirror forecast.js)
// ---------------------------------------------------------------------------
const ELEV_STORAGE_TABLE = [
  [3370, 1.71], [3400, 2.20], [3420, 2.67], [3440, 3.22],
  [3460, 3.86], [3480, 4.59], [3490, 5.00], [3500, 5.44],
  [3520, 6.43], [3525, 6.70], [3540, 7.51], [3560, 8.69],
  [3575, 9.60], [3580, 9.97], [3600, 11.39], [3620, 13.00],
  [3640, 14.82], [3660, 16.87], [3680, 19.17], [3700, 21.75],
];

const MONTHLY_NET_STORAGE_MAF = {
  1: -0.273, 2: -0.221, 3: -0.163, 4: -0.041,
  5: 0, 6: 0, 7: 0, 8: -0.355,
  9: -0.182, 10: -0.073, 11: -0.147, 12: -0.225,
};

const SPRING_DISTRIBUTION = { 5: 0.35, 6: 0.45, 7: 0.20 };
const SWE_SLOPE = 0.001732;
const SWE_INTERCEPT = -6.037;
const MIN_ELEV = 3370;

// ---------------------------------------------------------------------------
// Core forecast functions (inline to avoid ESM browser-module import issues)
// ---------------------------------------------------------------------------
function elevationToStorage(elev) {
  if (elev <= ELEV_STORAGE_TABLE[0][0]) return ELEV_STORAGE_TABLE[0][1];
  if (elev >= ELEV_STORAGE_TABLE[ELEV_STORAGE_TABLE.length - 1][0])
    return ELEV_STORAGE_TABLE[ELEV_STORAGE_TABLE.length - 1][1];
  for (let i = 0; i < ELEV_STORAGE_TABLE.length - 1; i++) {
    const [e1, s1] = ELEV_STORAGE_TABLE[i];
    const [e2, s2] = ELEV_STORAGE_TABLE[i + 1];
    if (elev >= e1 && elev <= e2) {
      const frac = (elev - e1) / (e2 - e1);
      return s1 + frac * (s2 - s1);
    }
  }
  return ELEV_STORAGE_TABLE[0][1];
}

function storageToElevation(storage) {
  if (storage <= ELEV_STORAGE_TABLE[0][1]) return ELEV_STORAGE_TABLE[0][0];
  if (storage >= ELEV_STORAGE_TABLE[ELEV_STORAGE_TABLE.length - 1][1])
    return ELEV_STORAGE_TABLE[ELEV_STORAGE_TABLE.length - 1][0];
  for (let i = 0; i < ELEV_STORAGE_TABLE.length - 1; i++) {
    const [e1, s1] = ELEV_STORAGE_TABLE[i];
    const [e2, s2] = ELEV_STORAGE_TABLE[i + 1];
    if (storage >= s1 && storage <= s2) {
      const frac = (storage - s1) / (s2 - s1);
      return e1 + frac * (e2 - e1);
    }
  }
  return ELEV_STORAGE_TABLE[0][0];
}

function predictSpringNetGain(sweApr1) {
  return SWE_SLOPE * sweApr1 + SWE_INTERCEPT;
}

function forecast({ currentElevation, currentDate, sweApr1, releaseMultiplier = 1.0, forecastEndDate }) {
  let storage = elevationToStorage(currentElevation);
  const start = new Date(currentDate + 'T00:00:00');
  const end = new Date(forecastEndDate + 'T00:00:00');
  const springGain = predictSpringNetGain(sweApr1);
  const results = [];
  const current = new Date(start);
  current.setMonth(current.getMonth() + 1);
  current.setDate(1);

  while (current <= end) {
    const month = current.getMonth() + 1;
    let netChange = MONTHLY_NET_STORAGE_MAF[month] || 0;
    if (SPRING_DISTRIBUTION[month]) {
      netChange += springGain * SPRING_DISTRIBUTION[month];
    }
    netChange *= releaseMultiplier;
    storage += netChange;
    const elev = Math.max(MIN_ELEV, storageToElevation(storage));
    if (elev === MIN_ELEV) storage = elevationToStorage(MIN_ELEV);
    results.push({
      date: current.toISOString().slice(0, 10),
      elevation: Math.round(elev * 10) / 10,
      storage: Math.round(storage * 1000) / 1000,
    });
    current.setMonth(current.getMonth() + 1);
  }
  return results;
}

function findLowPoint(results) {
  if (!results.length) return null;
  return results.reduce((min, r) => r.elevation < min.elevation ? r : min, results[0]);
}

// ---------------------------------------------------------------------------
// API Fetchers
// ---------------------------------------------------------------------------
async function fetchElevation(startDate, endDate) {
  const url = `${USGS_BASE}?format=json&sites=${POWELL_SITE}&parameterCd=${PARAM_ELEVATION}&startDT=${startDate}&endDT=${endDate}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`USGS elevation: ${resp.status}`);
  const data = await resp.json();
  const ts = data.value?.timeSeries?.[0]?.values?.[0]?.value;
  if (!ts) return [];
  return ts.map(v => ({
    date: v.dateTime.slice(0, 10),
    value: parseFloat(v.value),
  })).filter(v => !isNaN(v.value) && v.value > 0);
}

async function fetchSnowpack(startDate, endDate) {
  const stations = SNOTEL_STATIONS.join(',');
  const url = `${NCEI_BASE}?dataset=daily-summaries&stations=${stations}&startDate=${startDate}&endDate=${endDate}&dataTypes=WESD&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NCEI snowpack: ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) return [];
  const byDate = {};
  for (const row of data) {
    const date = row.DATE;
    const val = parseInt(row.WESD?.trim());
    if (!date || isNaN(val)) continue;
    if (!byDate[date]) byDate[date] = { sum: 0, count: 0 };
    byDate[date].sum += val;
    byDate[date].count++;
  }
  return Object.entries(byDate)
    .map(([date, { sum, count }]) => ({ date, avgSWE: Math.round(sum / count), stationCount: count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchHistoricalApr1SWE(years) {
  const results = [];
  for (const year of years) {
    try {
      const data = await fetchSnowpack(`${year}-04-01`, `${year}-04-01`);
      if (data.length > 0) results.push({ year, avgSWE: data[0].avgSWE });
    } catch { /* skip */ }
  }
  return results;
}

// ---------------------------------------------------------------------------
// THRESHOLDS
// ---------------------------------------------------------------------------
const THRESHOLDS = [
  { elevation: 3700, label: 'Full Pool', severity: 'safe' },
  { elevation: 3575, label: 'Upper/Mid Tier Boundary', severity: 'caution' },
  { elevation: 3525, label: 'DROA Protection Target', severity: 'warning' },
  { elevation: 3500, label: 'Emergency Operations', severity: 'danger' },
  { elevation: 3490, label: 'Min Power Pool', severity: 'danger' },
  { elevation: 3470, label: 'Penstock Intake', severity: 'critical' },
  { elevation: 3370, label: 'Dead Pool', severity: 'critical' },
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[${today}] Fetching live data...`);

  // Fetch 3 years of elevation
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

  // Recent snowpack (7 days)
  const sweEnd = new Date();
  sweEnd.setDate(sweEnd.getDate() - 1);
  const sweStart = new Date(sweEnd);
  sweStart.setDate(sweStart.getDate() - 7);

  const [elevation, snowpack, historicalSWE] = await Promise.all([
    fetchElevation(threeYearsAgo.toISOString().slice(0, 10), today),
    fetchSnowpack(sweStart.toISOString().slice(0, 10), sweEnd.toISOString().slice(0, 10)),
    fetchHistoricalApr1SWE([2020, 2021, 2022, 2023, 2024, 2025, 2026]),
  ]);

  const currentElev = elevation.length > 0 ? elevation[elevation.length - 1] : null;
  const currentSWE = snowpack.length > 0 ? snowpack[snowpack.length - 1] : null;

  // Median April 1 SWE
  const apr1Values = historicalSWE.map(h => h.avgSWE).sort((a, b) => a - b);
  const medianApr1SWE = apr1Values.length > 0
    ? apr1Values[Math.floor(apr1Values.length / 2)]
    : 4181;

  console.log(`  Elevation: ${currentElev?.value} ft (${currentElev?.date})`);
  console.log(`  Snowpack: ${currentSWE?.avgSWE} tenths-mm (${currentSWE?.stationCount} stations)`);
  console.log(`  Median Apr 1 SWE: ${medianApr1SWE}`);

  // ---- Write current.json ----
  const currentCache = {
    generatedAt: new Date().toISOString(),
    date: today,
    currentElev,
    currentSWE,
    historicalSWE,
    medianApr1SWE,
    elevation: elevation.slice(-90), // Last 90 days for quick display; full 3yr is large
    elevationFull: elevation,         // Full 3 years
  };

  writeFileSync(join(CACHE_DIR, 'current.json'), JSON.stringify(currentCache));
  console.log(`  Wrote cache/current.json (${(JSON.stringify(currentCache).length / 1024).toFixed(1)} KB)`);

  // ---- Run forecasts and save snapshot ----
  if (!currentElev) {
    console.log('  No elevation data — skipping forecast snapshot');
    return;
  }

  // Project April 1 SWE from current readings
  const projectedSWE = currentSWE
    ? Math.round(currentSWE.avgSWE / 0.70) // Assume ~70% of peak by mid-March
    : medianApr1SWE;

  const endDate = new Date(currentElev.date + 'T00:00:00');
  endDate.setMonth(endDate.getMonth() + 16);
  const forecastEndDate = endDate.toISOString().slice(0, 10);

  const scenarios = [
    { name: 'dry', swe: Math.round(projectedSWE * 0.75), release: 1.0 },
    { name: 'base', swe: projectedSWE, release: 1.0 },
    { name: 'wet', swe: Math.round(projectedSWE * 1.25), release: 1.0 },
    { name: 'base_high_release', swe: projectedSWE, release: 1.2 },
    { name: 'base_low_release', swe: projectedSWE, release: 0.8 },
  ];

  const forecastSnapshot = {
    generatedAt: new Date().toISOString(),
    date: today,
    inputs: {
      currentElevation: currentElev.value,
      currentDate: currentElev.date,
      projectedSWE,
      medianApr1SWE,
      currentSWE: currentSWE?.avgSWE || null,
    },
    scenarios: {},
  };

  for (const s of scenarios) {
    const results = forecast({
      currentElevation: currentElev.value,
      currentDate: currentElev.date,
      sweApr1: s.swe,
      releaseMultiplier: s.release,
      forecastEndDate,
    });

    const low = findLowPoint(results);
    const crossedThresholds = THRESHOLDS.filter(t => low && low.elevation < t.elevation);

    forecastSnapshot.scenarios[s.name] = {
      swe: s.swe,
      releaseMultiplier: s.release,
      projections: results,
      lowPoint: low,
      crossedThresholds: crossedThresholds.map(t => ({
        elevation: t.elevation,
        label: t.label,
        severity: t.severity,
      })),
    };

    console.log(`  ${s.name}: low ${low?.elevation} ft on ${low?.date} (SWE=${s.swe}, rel=${s.release}x)`);
  }

  const snapshotPath = join(FORECASTS_DIR, `${today}.json`);
  writeFileSync(snapshotPath, JSON.stringify(forecastSnapshot, null, 2));
  console.log(`  Wrote cache/forecasts/${today}.json`);

  // ---- Update forecast index ----
  const existingFiles = readdirSync(FORECASTS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'index.json')
    .sort();

  const index = {
    generatedAt: new Date().toISOString(),
    count: existingFiles.length,
    snapshots: existingFiles.map(f => {
      const date = f.replace('.json', '');
      // Read just the summary from each file
      try {
        const snap = JSON.parse(readFileSync(join(FORECASTS_DIR, f), 'utf-8'));
        const base = snap.scenarios?.base;
        return {
          date,
          currentElevation: snap.inputs?.currentElevation,
          projectedSWE: snap.inputs?.projectedSWE,
          baseLow: base?.lowPoint?.elevation,
          baseLowDate: base?.lowPoint?.date,
        };
      } catch {
        return { date };
      }
    }),
  };

  writeFileSync(join(FORECASTS_DIR, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`  Wrote cache/forecasts/index.json (${index.count} snapshots)`);

  // ---- Write backtestable control dataset ----
  // This accumulates actual observed elevations alongside what we predicted
  const controlPath = join(CACHE_DIR, 'control.json');
  let control = { observations: [] };
  if (existsSync(controlPath)) {
    try { control = JSON.parse(readFileSync(controlPath, 'utf-8')); } catch { /* start fresh */ }
  }

  // Add today's observation if we have one
  if (currentElev) {
    const existing = control.observations.find(o => o.date === currentElev.date);
    if (!existing) {
      control.observations.push({
        date: currentElev.date,
        elevation: currentElev.value,
      });
      // Keep sorted
      control.observations.sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  control.generatedAt = new Date().toISOString();
  control.count = control.observations.length;
  writeFileSync(controlPath, JSON.stringify(control, null, 2));
  console.log(`  Wrote cache/control.json (${control.count} observations)`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Cache update failed:', err);
  process.exit(1);
});
