/**
 * Data fetching module for Lake Powell analyzer.
 * All APIs are CORS-enabled, no keys required.
 */

const USGS_BASE = 'https://waterservices.usgs.gov/nwis/dv/';
const NCEI_BASE = 'https://www.ncei.noaa.gov/access/services/data/v1';

// USGS Sites
const POWELL_SITE = '09379900';       // Lake Powell at Glen Canyon Dam
const LEES_FERRY_SITE = '09380000';   // Colorado River at Lees Ferry (releases)

// USGS Parameter codes
const PARAM_ELEVATION = '62614';      // Reservoir elevation (ft above NGVD 1929)
const PARAM_DISCHARGE = '00060';      // Discharge (cfs)

// SNOTEL stations (10 across Upper Colorado Basin sub-basins)
const SNOTEL_STATIONS = [
  'USS0006J03S',  // Columbine, CO (Colorado Headwaters)
  'USS0006J09S',  // Rabbit Ears, CO (Yampa)
  'USS0006L02S',  // Park Cone, CO (Gunnison)
  'USS0006L11S',  // Butte, CO (Gunnison)
  'USS0007M12S',  // Molas Lake, CO (San Juan)
  'USS0009G03S',  // Hobbs Park, WY (Green River)
  'USS0009J01S',  // King's Cabin, UT (Green River)
  'USS0007J03S',  // Bear River, CO (Yampa)
  'USS0006K24S',  // Copper Mountain, CO (Blue River)
  'USS0006K29S',  // Elliot Ridge, CO (Eagle)
];

/**
 * Fetch daily elevation data from USGS
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<{date: string, value: number}[]>}
 */
async function fetchElevation(startDate, endDate) {
  const url = `${USGS_BASE}?format=json&sites=${POWELL_SITE}&parameterCd=${PARAM_ELEVATION}&startDT=${startDate}&endDT=${endDate}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`USGS elevation fetch failed: ${resp.status}`);
  const data = await resp.json();
  const ts = data.value?.timeSeries?.[0]?.values?.[0]?.value;
  if (!ts) return [];
  return ts.map(v => ({
    date: v.dateTime.slice(0, 10),
    value: parseFloat(v.value),
  })).filter(v => !isNaN(v.value) && v.value > 0);
}

/**
 * Fetch downstream discharge (releases) from Lees Ferry
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<{date: string, value: number}[]>}
 */
async function fetchReleases(startDate, endDate) {
  const url = `${USGS_BASE}?format=json&sites=${LEES_FERRY_SITE}&parameterCd=${PARAM_DISCHARGE}&startDT=${startDate}&endDT=${endDate}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`USGS release fetch failed: ${resp.status}`);
  const data = await resp.json();
  const ts = data.value?.timeSeries?.[0]?.values?.[0]?.value;
  if (!ts) return [];
  return ts.map(v => ({
    date: v.dateTime.slice(0, 10),
    value: parseFloat(v.value),
  })).filter(v => !isNaN(v.value) && v.value > 0);
}

/**
 * Fetch basin-average SWE from NCEI (SNOTEL stations)
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<{date: string, avgSWE: number, stationCount: number}[]>}
 */
async function fetchSnowpack(startDate, endDate) {
  const stations = SNOTEL_STATIONS.join(',');
  const url = `${NCEI_BASE}?dataset=daily-summaries&stations=${stations}&startDate=${startDate}&endDate=${endDate}&dataTypes=WESD&format=json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`NCEI snowpack fetch failed: ${resp.status}`);
  const data = await resp.json();
  if (!Array.isArray(data) || data.length === 0) return [];

  // Group by date, compute average
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
    .map(([date, { sum, count }]) => ({
      date,
      avgSWE: Math.round(sum / count),
      stationCount: count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch historical April 1 SWE for multiple years (for context display)
 * @param {number[]} years
 * @returns {Promise<{year: number, avgSWE: number}[]>}
 */
async function fetchHistoricalApr1SWE(years) {
  const results = [];
  // Batch into one request per year to avoid timeouts
  for (const year of years) {
    try {
      const data = await fetchSnowpack(`${year}-04-01`, `${year}-04-01`);
      if (data.length > 0) {
        results.push({ year, avgSWE: data[0].avgSWE });
      }
    } catch {
      // Skip failed years
    }
  }
  return results;
}

/**
 * Try to load cached data (from daily GitHub Actions job).
 * Returns null if cache is missing or stale (>36 hours old).
 */
async function tryLoadCache() {
  try {
    const resp = await fetch('./cache/current.json');
    if (!resp.ok) return null;
    const cache = await resp.json();

    // Check freshness — cache is stale after 36 hours
    const age = Date.now() - new Date(cache.generatedAt).getTime();
    const MAX_AGE_MS = 36 * 60 * 60 * 1000;
    if (age > MAX_AGE_MS) {
      console.log(`Cache is ${(age / 3600000).toFixed(1)}h old — falling back to live APIs`);
      return null;
    }

    console.log(`Using cached data from ${cache.generatedAt}`);
    return cache;
  } catch {
    return null;
  }
}

/**
 * Load all data needed for the app.
 * Tries cache first, falls back to live APIs.
 * @returns {Promise<Object>}
 */
async function loadAllData() {
  // Try cache first
  const cache = await tryLoadCache();
  if (cache) {
    return {
      elevation: cache.elevationFull || cache.elevation,
      snowpack: [],
      historicalSWE: cache.historicalSWE,
      currentElev: cache.currentElev,
      currentSWE: cache.currentSWE,
      medianApr1SWE: cache.medianApr1SWE,
      fromCache: true,
      cacheDate: cache.date,
    };
  }

  // Fall back to live APIs
  console.log('No fresh cache — fetching live data from USGS & NOAA...');
  const today = new Date().toISOString().slice(0, 10);
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
  const startDate = threeYearsAgo.toISOString().slice(0, 10);

  // Recent snowpack: last 7 days (NCEI has ~1 day lag)
  const sweEnd = new Date();
  sweEnd.setDate(sweEnd.getDate() - 1);
  const sweStart = new Date(sweEnd);
  sweStart.setDate(sweStart.getDate() - 7);

  const [elevation, snowpack, historicalSWE] = await Promise.all([
    fetchElevation(startDate, today),
    fetchSnowpack(sweStart.toISOString().slice(0, 10), sweEnd.toISOString().slice(0, 10)),
    fetchHistoricalApr1SWE([2020, 2021, 2022, 2023, 2024, 2025]),
  ]);

  // Current values
  const currentElev = elevation.length > 0 ? elevation[elevation.length - 1] : null;
  const currentSWE = snowpack.length > 0 ? snowpack[snowpack.length - 1] : null;

  // Compute median April 1 SWE from historical
  const apr1Values = historicalSWE.map(h => h.avgSWE).sort((a, b) => a - b);
  const medianApr1SWE = apr1Values.length > 0
    ? apr1Values[Math.floor(apr1Values.length / 2)]
    : 4181; // fallback

  return {
    elevation,
    snowpack,
    historicalSWE,
    currentElev,
    currentSWE,
    medianApr1SWE,
    fromCache: false,
  };
}

export {
  fetchElevation,
  fetchReleases,
  fetchSnowpack,
  fetchHistoricalApr1SWE,
  tryLoadCache,
  loadAllData,
  SNOTEL_STATIONS,
};
