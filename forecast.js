/**
 * Lake Powell Forecasting Engine
 *
 * Mass-balance model: Storage(t+1) = Storage(t) + Inflow - Release - Evaporation
 * Elevation derived from storage via lookup table interpolation.
 */

// ============================================================
// Elevation ↔ Storage Conversion (BOR Area-Capacity Table)
// ============================================================

const ELEV_STORAGE_TABLE = [
  // [elevation_ft, storage_MAF]
  [3370, 1.71],   // Dead pool
  [3400, 2.20],
  [3420, 2.67],
  [3440, 3.22],
  [3460, 3.86],
  [3480, 4.59],
  [3490, 5.00],   // Min power pool
  [3500, 5.44],
  [3520, 6.43],
  [3525, 6.70],   // DROA target
  [3540, 7.51],
  [3560, 8.69],
  [3575, 9.60],   // Upper/Mid tier boundary
  [3580, 9.97],
  [3600, 11.39],
  [3620, 13.00],
  [3640, 14.82],
  [3660, 16.87],
  [3680, 19.16],
  [3700, 24.32],  // Full pool
];

/**
 * Convert elevation (ft) to storage (MAF) via linear interpolation
 */
function elevationToStorage(elev) {
  const table = ELEV_STORAGE_TABLE;
  if (elev <= table[0][0]) return table[0][1];
  if (elev >= table[table.length - 1][0]) return table[table.length - 1][1];

  for (let i = 0; i < table.length - 1; i++) {
    if (elev >= table[i][0] && elev <= table[i + 1][0]) {
      const frac = (elev - table[i][0]) / (table[i + 1][0] - table[i][0]);
      return table[i][1] + frac * (table[i + 1][1] - table[i][1]);
    }
  }
  return table[table.length - 1][1];
}

/**
 * Convert storage (MAF) to elevation (ft) via linear interpolation
 */
function storageToElevation(storage) {
  const table = ELEV_STORAGE_TABLE;
  if (storage <= table[0][1]) return table[0][0];
  if (storage >= table[table.length - 1][1]) return table[table.length - 1][0];

  for (let i = 0; i < table.length - 1; i++) {
    if (storage >= table[i][1] && storage <= table[i + 1][1]) {
      const frac = (storage - table[i][1]) / (table[i + 1][1] - table[i][1]);
      return table[i][0] + frac * (table[i + 1][0] - table[i][0]);
    }
  }
  return table[table.length - 1][0];
}


// ============================================================
// SWE → Annual Inflow Regression
// ============================================================

// Calibrated from 2020-2025 data:
// April 1 basin-avg SWE (tenths mm) vs April-July spring rise (ft)
// rise = 0.02697 * swe - 92.7  (R² = 0.844)
//
// We convert this to an inflow volume model instead of rise,
// because rise depends on release rates which vary.

// Historical April-July inflow volumes (MAF) from USGS/BOR
// and corresponding April 1 SWE (tenths mm, 10-station basin avg)
const CALIBRATION_DATA = [
  // { year, sweApr1, inflowAprJul_MAF, releaseAprJul_MAF, peakElev, apr1Elev }
  { year: 2020, sweApr1: 4412, apr1Elev: 3600.2, peakElev: 3610.6 },
  { year: 2021, sweApr1: 3356, apr1Elev: 3566.2, peakElev: 3561.8 },
  { year: 2022, sweApr1: 3662, apr1Elev: 3523.1, peakElev: 3539.5 },
  { year: 2023, sweApr1: 5527, apr1Elev: 3521.6, peakElev: 3584.3 },
  { year: 2024, sweApr1: 4445, apr1Elev: 3558.4, peakElev: 3586.8 },
  { year: 2025, sweApr1: 3686, apr1Elev: 3558.7, peakElev: 3561.4 },
];

// Compute net storage gain (MAF) for Apr-Jul from elevation changes
// netGain = storage(peak) - storage(apr1)
// This includes inflow MINUS releases MINUS evap during that period
const SWE_INFLOW_PAIRS = CALIBRATION_DATA.map(d => {
  const storageApr1 = elevationToStorage(d.apr1Elev);
  const storagePeak = elevationToStorage(d.peakElev);
  const netGain = storagePeak - storageApr1;
  return { swe: d.sweApr1, netGainMAF: netGain };
});

/**
 * Linear regression: y = slope * x + intercept
 */
function linearRegression(points) {
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // R²
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (const { x, y } of points) {
    const pred = slope * x + intercept;
    ssRes += (y - pred) ** 2;
    ssTot += (y - meanY) ** 2;
  }
  const rSquared = 1 - ssRes / ssTot;

  return { slope, intercept, rSquared };
}

// SWE -> Net storage gain (MAF) during spring (Apr-Jul)
const SWE_REGRESSION = linearRegression(
  SWE_INFLOW_PAIRS.map(d => ({ x: d.swe, y: d.netGainMAF }))
);

/**
 * Predict net storage gain (MAF) from April 1 SWE
 * @param {number} sweApr1 - Basin-average April 1 SWE in tenths of mm
 * @returns {number} Net storage gain in MAF (inflow minus releases during Apr-Jul)
 */
function predictSpringNetGain(sweApr1) {
  return SWE_REGRESSION.slope * sweApr1 + SWE_REGRESSION.intercept;
}


// ============================================================
// Monthly Net Storage Change (MAF) — Calibrated from 2020-2025
// ============================================================

// Average monthly net storage change (MAF) = inflow - release - evaporation
// Computed from actual elevation changes converted to storage via the lookup table.
// Spring months (May-Jun) are replaced by SWE regression at forecast time.
const MONTHLY_NET_STORAGE_MAF = {
  // Post-peak decline (Aug-Dec)
  8: -0.355,   // Aug: high releases, low inflow
  9: -0.182,   // Sep: releases moderate
  10: -0.073,  // Oct: releases low, some fall rain
  11: -0.147,  // Nov
  12: -0.225,  // Dec
  // Winter decline (Jan-Apr)
  1: -0.273,   // Jan: steady releases, minimal inflow
  2: -0.221,   // Feb
  3: -0.163,   // Mar: decline slowing as spring approaches
  4: -0.041,   // Apr: transition month, early inflow starting
  // Spring inflow (May-Jul): replaced by SWE forecast
  5: 0,  6: 0,  7: 0,
};

// Spring net storage gain is distributed across May-Jul with this shape:
// May: early melt, Jun: peak melt, Jul: tail end minus higher releases
const SPRING_DISTRIBUTION = { 5: 0.35, 6: 0.45, 7: 0.20 };


// ============================================================
// Main Forecast Function
// ============================================================

/**
 * @typedef {Object} ForecastParams
 * @property {number} currentElevation - Current water level (ft)
 * @property {string} currentDate - Current date (YYYY-MM-DD)
 * @property {number} sweApr1 - April 1 SWE forecast (tenths mm). If before April 1, this is projected/current SWE.
 * @property {number} [releaseMultiplier=1.0] - Multiplier on default decline rates (1.0 = normal, 0.8 = reduced releases)
 * @property {string} [forecastEndDate] - End date for forecast (default: 18 months out)
 */

/**
 * @typedef {Object} ForecastPoint
 * @property {string} date - YYYY-MM-DD
 * @property {number} elevation - Predicted elevation in ft
 * @property {number} storage - Predicted storage in MAF
 */

/**
 * Generate monthly forecast of Lake Powell elevation
 * @param {ForecastParams} params
 * @returns {ForecastPoint[]}
 */
function forecast(params) {
  const {
    currentElevation,
    currentDate,
    sweApr1,
    releaseMultiplier = 1.0,
    forecastEndDate,
  } = params;

  const start = new Date(currentDate);
  const endDefault = new Date(start);
  endDefault.setMonth(endDefault.getMonth() + 18);
  const end = forecastEndDate ? new Date(forecastEndDate) : endDefault;

  // Compute spring net gain from SWE
  const springNetGainMAF = predictSpringNetGain(sweApr1);

  // Convert spring net gain (MAF) to elevation gain using current-level sensitivity
  // ft_per_MAF varies with elevation, so we'll compute step by step
  const results = [];
  let currentElev = currentElevation;
  let currentStorage = elevationToStorage(currentElevation);

  // Step month by month
  let date = new Date(start.getFullYear(), start.getMonth(), 1);
  // Start from the first of next month
  date.setMonth(date.getMonth() + 1);

  while (date <= end) {
    const month = date.getMonth() + 1; // 1-12
    const year = date.getFullYear();

    let monthlyChangeMAF;

    if (month >= 5 && month <= 7) {
      // Spring inflow months: use SWE-derived net gain distributed by month
      const fraction = SPRING_DISTRIBUTION[month];
      monthlyChangeMAF = springNetGainMAF * fraction;
    } else {
      // Non-spring months: use calibrated average net storage change (MAF)
      monthlyChangeMAF = MONTHLY_NET_STORAGE_MAF[month];
      // Apply release multiplier (>1 = more releases = faster decline)
      if (monthlyChangeMAF < 0) {
        monthlyChangeMAF *= releaseMultiplier;
      }
    }

    currentStorage += monthlyChangeMAF;
    // Clamp to valid range
    currentStorage = Math.max(ELEV_STORAGE_TABLE[0][1], currentStorage);
    currentStorage = Math.min(ELEV_STORAGE_TABLE[ELEV_STORAGE_TABLE.length - 1][1], currentStorage);
    currentElev = storageToElevation(currentStorage);

    const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;
    results.push({
      date: dateStr,
      elevation: Math.round(currentElev * 10) / 10,
      storage: Math.round(currentStorage * 100) / 100,
    });

    date.setMonth(date.getMonth() + 1);
  }

  return results;
}


// ============================================================
// Find projected low point
// ============================================================

/**
 * Find the lowest projected elevation in the forecast
 * @param {ForecastPoint[]} forecastResults
 * @returns {{ date: string, elevation: number, storage: number }}
 */
function findLowPoint(forecastResults) {
  let lowest = forecastResults[0];
  for (const point of forecastResults) {
    if (point.elevation < lowest.elevation) {
      lowest = point;
    }
  }
  return lowest;
}


// ============================================================
// Threshold Analysis
// ============================================================

const THRESHOLDS = [
  { elevation: 3700, label: 'Full Pool', severity: 'safe' },
  { elevation: 3575, label: 'Upper/Mid Tier Boundary', severity: 'caution',
    consequence: 'Releases reduced from 8.23 to 7.48 MAF/year. Hydropower generation degraded.' },
  { elevation: 3525, label: 'DROA Protection Target', severity: 'warning',
    consequence: 'Drought response activated. Upstream reservoirs release water to Powell.' },
  { elevation: 3500, label: 'Emergency Planning Trigger', severity: 'danger',
    consequence: 'Secretary must plan for releases as low as 6.0 MAF/year.' },
  { elevation: 3490, label: 'Minimum Power Pool', severity: 'critical',
    consequence: 'Hydropower generation stops. 1,320 MW lost. Billions in replacement power costs.' },
  { elevation: 3470, label: 'Penstock Intake', severity: 'critical',
    consequence: 'Penstocks inoperable. Only untested river outlet works remain.' },
  { elevation: 3370, label: 'Dead Pool', severity: 'catastrophic',
    consequence: 'No water passes through dam. Treaty violations. Downstream water supply crisis.' },
];

/**
 * Determine which thresholds a given elevation has crossed
 * @param {number} elevation
 * @returns {Object[]} Thresholds that have been crossed (elevation is below them)
 */
function getCrossedThresholds(elevation) {
  return THRESHOLDS.filter(t => elevation < t.elevation && t.elevation < 3700);
}

/**
 * Get the next threshold below current elevation
 * @param {number} elevation
 * @returns {Object|null}
 */
function getNextThresholdBelow(elevation) {
  const below = THRESHOLDS
    .filter(t => t.elevation < elevation)
    .sort((a, b) => b.elevation - a.elevation);
  return below.length > 0 ? below[0] : null;
}


// ============================================================
// Exports
// ============================================================

export {
  elevationToStorage,
  storageToElevation,
  predictSpringNetGain,
  forecast,
  findLowPoint,
  getCrossedThresholds,
  getNextThresholdBelow,
  THRESHOLDS,
  ELEV_STORAGE_TABLE,
  SWE_REGRESSION,
  SWE_INFLOW_PAIRS,
  CALIBRATION_DATA,
  MONTHLY_NET_STORAGE_MAF,
  linearRegression,
};
