/**
 * Forecast Engine Test Suite
 * Run: node forecast.test.js
 *
 * Validates the forecast model against known historical outcomes.
 */

import {
  elevationToStorage,
  storageToElevation,
  predictSpringNetGain,
  forecast,
  findLowPoint,
  getCrossedThresholds,
  getNextThresholdBelow,
  releaseMultiplierForElevation,
  SWE_REGRESSION,
  SWE_INFLOW_PAIRS,
  THRESHOLDS,
  NET_GAIN_FLOOR_MAF,
  NET_GAIN_CEILING_MAF,
  BOR_APR2026_MOST_PROBABLE,
} from './forecast.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    const msg = detail ? `${message} — ${detail}` : message;
    failures.push(msg);
    console.log(`  ✗ ${msg}`);
  }
}

function assertClose(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert(
    diff <= tolerance,
    message,
    `expected ${expected}, got ${actual} (diff: ${diff.toFixed(2)}, tol: ${tolerance})`
  );
}

// ============================================================
console.log('\n=== Elevation ↔ Storage Conversion ===');
// ============================================================

// Test known points from the BOR table
assertClose(elevationToStorage(3370), 1.71, 0.01, 'Dead pool: 3370ft = 1.71 MAF');
assertClose(elevationToStorage(3490), 5.00, 0.01, 'Min power pool: 3490ft = 5.00 MAF');
assertClose(elevationToStorage(3525), 6.70, 0.01, 'DROA target: 3525ft = 6.70 MAF');
assertClose(elevationToStorage(3700), 24.32, 0.01, 'Full pool: 3700ft = 24.32 MAF');

// Test reverse
assertClose(storageToElevation(1.71), 3370, 0.1, 'Reverse: 1.71 MAF = 3370ft');
assertClose(storageToElevation(5.00), 3490, 0.1, 'Reverse: 5.00 MAF = 3490ft');
assertClose(storageToElevation(6.70), 3525, 0.1, 'Reverse: 6.70 MAF = 3525ft');
assertClose(storageToElevation(24.32), 3700, 0.1, 'Reverse: 24.32 MAF = 3700ft');

// Test interpolation at midpoints
assertClose(elevationToStorage(3495), 5.22, 0.15, 'Midpoint interp: 3495ft ≈ 5.22 MAF');
assertClose(elevationToStorage(3550), 8.10, 0.15, 'Midpoint interp: 3550ft ≈ 8.10 MAF');

// Round-trip test
const testElevations = [3400, 3490, 3525, 3550, 3600, 3650, 3700];
for (const e of testElevations) {
  const s = elevationToStorage(e);
  const e2 = storageToElevation(s);
  assertClose(e2, e, 0.5, `Round-trip: ${e}ft -> ${s.toFixed(2)}MAF -> ${e2.toFixed(1)}ft`);
}

// Edge cases
assertClose(elevationToStorage(3300), 1.71, 0.01, 'Below dead pool clamps to 1.71 MAF');
assertClose(elevationToStorage(3800), 24.32, 0.01, 'Above full pool clamps to 24.32 MAF');
assertClose(storageToElevation(0), 3370, 0.1, 'Below min storage clamps to 3370ft');
assertClose(storageToElevation(30), 3700, 0.1, 'Above max storage clamps to 3700ft');

// ============================================================
console.log('\n=== SWE → Net Gain Regression ===');
// ============================================================

console.log(`  Regression: gain = ${SWE_REGRESSION.slope.toFixed(6)} * swe + ${SWE_REGRESSION.intercept.toFixed(3)}`);
console.log(`  R² = ${SWE_REGRESSION.rSquared.toFixed(3)}`);

assert(SWE_REGRESSION.rSquared > 0.7, `R² > 0.7 (got ${SWE_REGRESSION.rSquared.toFixed(3)})`);

// Big snow year (2023: SWE 5527) should produce large positive gain
const gain2023 = predictSpringNetGain(5527);
assert(gain2023 > 1.0, `2023 big snow predicts positive gain: ${gain2023.toFixed(2)} MAF`);

// Drought year (2021: SWE 3356) should produce near-zero or negative gain
const gain2021 = predictSpringNetGain(3356);
assert(gain2021 < 1.0, `2021 drought predicts small/negative gain: ${gain2021.toFixed(2)} MAF`);

// Gains should increase with SWE
const gainLow = predictSpringNetGain(3000);
const gainMid = predictSpringNetGain(4500);
const gainHigh = predictSpringNetGain(6000);
assert(gainLow < gainMid && gainMid < gainHigh,
  `Gain increases with SWE: ${gainLow.toFixed(2)} < ${gainMid.toFixed(2)} < ${gainHigh.toFixed(2)}`);

// ============================================================
console.log('\n=== Hindcast Validation (Known Years) ===');
// ============================================================

// Test: Starting from known April 1 elevation and SWE, does the model
// predict the actual peak and following low point within tolerance?

const HISTORICAL = [
  {
    year: 2020, startDate: '2020-04-01', startElev: 3600.2,
    sweApr1: 4412, actualPeak: 3610.6, actualNextLow: 3559.4,
    actualLowDate: '2021-03',
  },
  {
    year: 2021, startDate: '2021-04-01', startElev: 3566.2,
    sweApr1: 3356, actualPeak: 3561.8, actualNextLow: 3522.1,
    actualLowDate: '2022-04',
  },
  {
    year: 2022, startDate: '2022-04-01', startElev: 3523.1,
    sweApr1: 3662, actualPeak: 3539.5, actualNextLow: 3519.5,
    actualLowDate: '2023-04',
  },
  {
    year: 2023, startDate: '2023-04-01', startElev: 3521.6,
    sweApr1: 5527, actualPeak: 3584.3, actualNextLow: 3557.6,
    actualLowDate: '2024-04',
  },
  {
    year: 2024, startDate: '2024-04-01', startElev: 3558.4,
    sweApr1: 4445, actualPeak: 3586.8, actualNextLow: 3557.3,
    actualLowDate: '2025-04',
  },
];

const PEAK_TOLERANCE = 15; // ft - acceptable error for peak prediction
const LOW_TOLERANCE = 15;  // ft - acceptable error for low point prediction

// Note: 2020 and 2022 used atypical release rates (WY2021=8.28 MAF high-tier,
// WY2022=7.07 MAF drought-reduced). The model is calibrated for the current
// Mid-Elevation Release Tier (~7.48 MAF). Those years get wider tolerance.
const ATYPICAL_RELEASE_YEARS = [2020, 2022];
const ATYPICAL_LOW_TOLERANCE = 40; // ft - wider for years with different release rates

for (const h of HISTORICAL) {
  console.log(`\n  --- ${h.year} Hindcast ---`);

  const results = forecast({
    currentElevation: h.startElev,
    currentDate: h.startDate,
    sweApr1: h.sweApr1,
    forecastEndDate: `${h.year + 1}-06-01`,
  });

  // Find predicted peak (May-August of start year)
  const springResults = results.filter(r => {
    const m = parseInt(r.date.split('-')[1]);
    const y = parseInt(r.date.split('-')[0]);
    return y === h.year && m >= 5 && m <= 8;
  });
  const predPeak = springResults.reduce(
    (max, r) => r.elevation > max.elevation ? r : max,
    { elevation: h.startElev }
  );

  // Find predicted low (Sep through Apr next year)
  const declineResults = results.filter(r => {
    const y = parseInt(r.date.split('-')[0]);
    const m = parseInt(r.date.split('-')[1]);
    return (y === h.year && m >= 9) || (y === h.year + 1 && m <= 5);
  });
  const predLow = declineResults.length > 0
    ? declineResults.reduce((min, r) => r.elevation < min.elevation ? r : min)
    : { elevation: h.startElev, date: 'N/A' };

  console.log(`  Start: ${h.startElev}ft, SWE: ${h.sweApr1}`);
  console.log(`  Peak: predicted=${predPeak.elevation}ft actual=${h.actualPeak}ft`);
  console.log(`  Low:  predicted=${predLow.elevation}ft(${predLow.date}) actual=${h.actualNextLow}ft(${h.actualLowDate})`);

  assertClose(predPeak.elevation, h.actualPeak, PEAK_TOLERANCE,
    `${h.year} peak within ${PEAK_TOLERANCE}ft`);

  const lowTol = ATYPICAL_RELEASE_YEARS.includes(h.year) ? ATYPICAL_LOW_TOLERANCE : LOW_TOLERANCE;
  assertClose(predLow.elevation, h.actualNextLow, lowTol,
    `${h.year} low within ${lowTol}ft${ATYPICAL_RELEASE_YEARS.includes(h.year) ? ' (atypical releases)' : ''}`);
}

// ============================================================
console.log('\n=== Threshold Analysis ===');
// ============================================================

const crossedAt3520 = getCrossedThresholds(3520);
assert(crossedAt3520.some(t => t.label === 'DROA Protection Target'),
  'At 3520ft: DROA target is crossed');
assert(crossedAt3520.some(t => t.label === 'Upper/Mid Tier Boundary'),
  'At 3520ft: Upper/Mid tier is crossed');
assert(!crossedAt3520.some(t => t.label === 'Minimum Power Pool'),
  'At 3520ft: Min power pool NOT crossed');

const crossedAt3485 = getCrossedThresholds(3485);
assert(crossedAt3485.some(t => t.label === 'Minimum Power Pool'),
  'At 3485ft: Min power pool IS crossed');

const nextBelow3530 = getNextThresholdBelow(3530);
assert(nextBelow3530 && nextBelow3530.elevation === 3525,
  `Next threshold below 3530ft is 3525ft (DROA): got ${nextBelow3530?.elevation}`);

const nextBelow3400 = getNextThresholdBelow(3400);
assert(nextBelow3400 && nextBelow3400.elevation === 3370,
  `Next threshold below 3400ft is 3370ft (Dead Pool): got ${nextBelow3400?.elevation}`);

// ============================================================
console.log('\n=== Forecast Behavior ===');
// ============================================================

// More snow = higher peak
const forecastLowSnow = forecast({
  currentElevation: 3530, currentDate: '2026-03-13',
  sweApr1: 3000, forecastEndDate: '2027-06-01',
});
const forecastHighSnow = forecast({
  currentElevation: 3530, currentDate: '2026-03-13',
  sweApr1: 6000, forecastEndDate: '2027-06-01',
});
const peakLow = Math.max(...forecastLowSnow.map(r => r.elevation));
const peakHigh = Math.max(...forecastHighSnow.map(r => r.elevation));
assert(peakHigh > peakLow,
  `Higher SWE = higher peak: ${peakHigh.toFixed(1)}ft > ${peakLow.toFixed(1)}ft`);

// More releases = lower low point
const forecastNormalRelease = forecast({
  currentElevation: 3530, currentDate: '2026-03-13',
  sweApr1: 4000, releaseMultiplier: 1.0, forecastEndDate: '2027-06-01',
});
const forecastHighRelease = forecast({
  currentElevation: 3530, currentDate: '2026-03-13',
  sweApr1: 4000, releaseMultiplier: 1.3, forecastEndDate: '2027-06-01',
});
const lowNormal = findLowPoint(forecastNormalRelease);
const lowHigh = findLowPoint(forecastHighRelease);
assert(lowHigh.elevation < lowNormal.elevation,
  `Higher releases = lower low: ${lowHigh.elevation}ft < ${lowNormal.elevation}ft`);

// Forecast should have reasonable number of points
assert(forecastNormalRelease.length >= 12,
  `Forecast has ${forecastNormalRelease.length} monthly points (≥12)`);

// ============================================================
// 2026 Forward-Looking Forecast
// ============================================================
console.log('\n=== 2026 Forecast (Current Conditions) ===');

// Current: 3529.4 ft, March 13, 2026
// Current SWE: ~2355 tenths-mm (March 9, typically ~56% of April 1 value)
// Project April 1 SWE: scale up by historical March-to-April ratio
// Typical Mar 9 / Apr 1 ratio: ~65-75%. Use 70% as estimate.
const currentSWE = 2355;
const projectedApr1SWE = Math.round(currentSWE / 0.70);
console.log(`  Current SWE (Mar 9): ${currentSWE} tenths-mm (${(currentSWE/254).toFixed(1)} in)`);
console.log(`  Projected Apr 1 SWE: ${projectedApr1SWE} tenths-mm (${(projectedApr1SWE/254).toFixed(1)} in)`);

const scenarios = [
  { name: 'Dry (current stays flat)', swe: currentSWE },
  { name: 'Moderate (projected Apr 1)', swe: projectedApr1SWE },
  { name: 'Optimistic (+20% above projected)', swe: Math.round(projectedApr1SWE * 1.2) },
];

for (const scenario of scenarios) {
  const results = forecast({
    currentElevation: 3529.4,
    currentDate: '2026-03-13',
    sweApr1: scenario.swe,
    forecastEndDate: '2027-06-01',
  });

  const low = findLowPoint(results);
  const peak = results.reduce((max, r) => r.elevation > max.elevation ? r : max);
  const crossed = getCrossedThresholds(low.elevation);
  const criticalCrossings = crossed.filter(t => t.severity === 'critical' || t.severity === 'catastrophic');

  console.log(`\n  ${scenario.name} (SWE=${scenario.swe}):`);
  console.log(`    Peak: ${peak.elevation}ft (${peak.date})`);
  console.log(`    Low:  ${low.elevation}ft (${low.date})`);
  console.log(`    Thresholds crossed: ${crossed.map(t => t.label).join(', ') || 'none'}`);
  if (criticalCrossings.length > 0) {
    console.log(`    ⚠ CRITICAL: ${criticalCrossings.map(t => t.consequence).join('; ')}`);
  }
}

// ============================================================
console.log('\n=== SWE Regression Physical Bounds ===');
// ============================================================

// At very low SWE (far below calibration range), the regression extrapolates
// to wildly negative values. The floor should prevent this.
const extrapLow = SWE_REGRESSION.slope * 1000 + SWE_REGRESSION.intercept;
const clampedLow = predictSpringNetGain(1000);
assert(extrapLow < NET_GAIN_FLOOR_MAF,
  `Raw regression at SWE=1000 extrapolates below floor (${extrapLow.toFixed(2)} < ${NET_GAIN_FLOOR_MAF})`);
assert(clampedLow === NET_GAIN_FLOOR_MAF,
  `Clamped prediction at SWE=1000 equals floor: ${clampedLow.toFixed(2)} === ${NET_GAIN_FLOOR_MAF}`);

// At very high SWE, ceiling should kick in (if raw > ceiling)
const clampedHigh = predictSpringNetGain(10000);
assert(clampedHigh <= NET_GAIN_CEILING_MAF,
  `Clamped prediction at SWE=10000 respects ceiling: ${clampedHigh.toFixed(2)} <= ${NET_GAIN_CEILING_MAF}`);

// Within calibration range, no clamping should occur
const midRange = predictSpringNetGain(4500);
const rawMid = SWE_REGRESSION.slope * 4500 + SWE_REGRESSION.intercept;
assertClose(midRange, rawMid, 0.001,
  `Within calibration range (SWE=4500), prediction matches raw regression`);

// ============================================================
console.log('\n=== Tier-Aware Release Multipliers ===');
// ============================================================

assertClose(releaseMultiplierForElevation(3600), 1.10, 0.001,
  'Above equalization threshold (3575): Upper/Equalization Tier = 1.10x');
assertClose(releaseMultiplierForElevation(3550), 1.00, 0.001,
  'Mid-elevation (3525-3575): Mid-Tier = 1.00x');
assertClose(releaseMultiplierForElevation(3510), 0.95, 0.001,
  'Below DROA (3500-3525): Lower Tier = 0.95x');
assertClose(releaseMultiplierForElevation(3495), 0.80, 0.001,
  'Section 6(E) zone (3490-3500): Emergency = 0.80x (6.0 MAF/yr)');
assertClose(releaseMultiplierForElevation(3480), 0.67, 0.001,
  'Below min power pool (<3490): Minimum operations = 0.67x');

// ============================================================
console.log('\n=== Dynamic Releases Reduce Severity of Drawdown ===');
// ============================================================

const staticForecast = forecast({
  currentElevation: 3527,
  currentDate: '2026-04-19',
  sweApr1: 1034,
  releaseMultiplier: 1.0,
  forecastEndDate: '2027-06-01',
});
const dynamicForecast = forecast({
  currentElevation: 3527,
  currentDate: '2026-04-19',
  sweApr1: 1034,
  dynamicReleases: true,
  forecastEndDate: '2027-06-01',
});

const staticLow = findLowPoint(staticForecast);
const dynamicLow = findLowPoint(dynamicForecast);
console.log(`  Static (1.0x): low = ${staticLow.elevation} ft on ${staticLow.date}`);
console.log(`  Dynamic tiers: low = ${dynamicLow.elevation} ft on ${dynamicLow.date}`);

assert(dynamicLow.elevation > staticLow.elevation,
  `Dynamic tiers produce higher low than static (BOR auto-reduces releases): ${dynamicLow.elevation} > ${staticLow.elevation}`);

// ============================================================
console.log('\n=== DROA Upstream Augmentation ===');
// ============================================================

const noDroa = forecast({
  currentElevation: 3527,
  currentDate: '2026-04-19',
  sweApr1: 1034,
  dynamicReleases: true,
  droaMAF: 0,
  forecastEndDate: '2027-06-01',
});
const withDroa = forecast({
  currentElevation: 3527,
  currentDate: '2026-04-19',
  sweApr1: 1034,
  dynamicReleases: true,
  droaMAF: 1.0,  // 1 MAF from Flaming Gorge per April 17, 2026 BOR announcement
  forecastEndDate: '2027-06-01',
});

const noDroaLow = findLowPoint(noDroa);
const withDroaLow = findLowPoint(withDroa);
console.log(`  No DROA: low = ${noDroaLow.elevation} ft on ${noDroaLow.date}`);
console.log(`  With 1 MAF DROA: low = ${withDroaLow.elevation} ft on ${withDroaLow.date}`);

assert(withDroaLow.elevation > noDroaLow.elevation,
  `1 MAF DROA lifts the projected low: ${withDroaLow.elevation} > ${noDroaLow.elevation}`);

// ============================================================
console.log('\n=== Reconciliation with BOR April 2026 24-Month Study ===');
// ============================================================

// BOR's Most Probable scenario assumes Apr-Jul 2026 inflow of 1.40 MAF at
// 22% of avg, with WY2026 inflow of 3.87 MAF. Applying dynamic releases and
// using a representative SWE should bring our base model within ~30 ft of
// BOR's monthly projections (it's not an exact match because our calibration
// is 2020-2025 and BOR's inflow forecast is slightly more generous than our
// SWE-only regression).
const borComparable = forecast({
  currentElevation: 3527,
  currentDate: '2026-04-19',
  sweApr1: 1800,  // Representative of BOR's 40% of avg inflow assumption
  dynamicReleases: true,
  forecastEndDate: '2027-05-01',
});

// Find our prediction for end of Dec 2026
const ourDec = borComparable.find(r => r.date === '2026-12-01');
const borDec = BOR_APR2026_MOST_PROBABLE.find(r => r.date === '2026-12-31');
assert(ourDec != null, 'Our forecast includes Dec 2026');
console.log(`  Dec 2026: ours=${ourDec?.elevation} ft, BOR Most Probable=${borDec.elevation} ft`);
assertClose(ourDec.elevation, borDec.elevation, 30,
  `Dec 2026 projection within 30 ft of BOR Most Probable`);

// BOR Most Probable dataset sanity
assert(BOR_APR2026_MOST_PROBABLE.length === 16,
  'BOR reference has 16 monthly data points (Apr 2026 - Jul 2027)');
assert(BOR_APR2026_MOST_PROBABLE[0].elevation > 3500 && BOR_APR2026_MOST_PROBABLE[0].elevation < 3530,
  'BOR Apr 2026 starting elevation ~3527 ft');
assert(BOR_APR2026_MOST_PROBABLE[12].elevation < BOR_APR2026_MOST_PROBABLE[0].elevation,
  'BOR Most Probable shows decline from Apr 2026 to Apr 2027');

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
}
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
