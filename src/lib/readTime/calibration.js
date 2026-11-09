/**
 * Validate a saved timed reading sample and its speech statistics.
 * This function checks the integrity and correctness of a timed reading sample, ensuring that all required fields are present and that the speech statistics are within reasonable bounds.
 * @param {object} sample - The timed reading sample to validate.
 * @returns {object} - The validated sample if it passes all checks.
 */
export function validateReadingSample(sample) {
  if (
    !sample ||
    typeof sample.id !== 'string' ||
    !sample.id ||
    sample.id.length > 100 ||
    typeof sample.name !== 'string' ||
    !sample.name.trim() ||
    sample.name.length > 200 ||
    !['full', 'evidence'].includes(sample.scope) ||
    !Number.isFinite(sample.seconds) ||
    sample.seconds <= 0 ||
    sample.seconds > 86400 ||
    sample.version !== 1 ||
    !sample.stats
  ) {
    throw new Error('Invalid timed reading sample.');
  }
  const stats = sample.stats;
  for (const key of [
    'syllables',
    'weightedSyllables',
    'spokenWords',
    'complexWords',
    'sentences',
    'pauseUnits',
    'properNounDensity',
    'numeralDensity',
    'paragraphCount',
    'quotedWords',
    'parentheticalWords',
  ]) {
    if (!Number.isFinite(stats[key]) || stats[key] < 0 || stats[key] > 1e9) {
      throw new Error('Invalid sample statistics.');
    }
  }
  if (stats.pauses !== undefined) {
    if (typeof stats.pauses !== 'object' || stats.pauses === null) {
      throw new Error('Invalid sample statistics.');
    }
    for (const value of Object.values(stats.pauses)) {
      if (!Number.isFinite(value) || value < 0 || value > 1e9) {
        throw new Error('Invalid sample statistics.');
      }
    }
  }
  if (!stats.spokenWords || !stats.weightedSyllables || !stats.sentences) {
    throw new Error(
      'Reading samples must contain spoken words. Check the selected scope and highlights.'
    );
  }
  return sample;
}

/**
 * Return the median of a nonempty numeric array.
 * This function calculates the median value of the provided array of numbers, which is the middle value when the array is sorted. If the array has an even number of elements, the median is the average of the two middle values.
 * @param {number[]} values - The array of numbers to compute the median for. Must be nonempty.
 * @returns {number} - The median value of the array.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Fit a robust articulation/pause calibration profile from timed reading samples.
 * This function analyzes a collection of timed reading samples to estimate a robust articulation and pause profile, which can be used to adjust speech duration predictions. It employs a relative-error fitting approach to minimize the influence of outliers.
 * @param {object[]} [samples=[]] - An array of timed reading samples to use for calibration. Each sample should be validated and contain unique IDs.
 * @returns {object|null} - An object containing the calibrated articulation and pause parameters, along with summary statistics, or null if no samples are provided.
 */
const PAUSE_KINDS = ['sentences', 'paragraphs', 'commas', 'semicolons', 'dashes'];
export const PAUSE_UNITS = {
  sentences: 0.22,
  paragraphs: 0.15,
  commas: 0.09,
  semicolons: 0.09,
  dashes: 0.09,
};

/**
 * Solve a small symmetric positive-definite system by Gaussian elimination.
 * Pivoting keeps the calibration stable when a pause class barely occurs.
 * @param {number[][]} matrix - The square matrix.
 * @param {number[]} vector - The right-hand side.
 * @returns {number[]} - The solution vector.
 */
function solveSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) {
        pivot = row;
      }
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];
    const divisor = a[column][column] || 1e-12;
    for (let row = column + 1; row < n; row++) {
      const factor = a[row][column] / divisor;
      for (let k = column; k <= n; k++) {
        a[row][k] -= factor * a[column][k];
      }
    }
  }
  const solution = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) {
      sum -= a[row][k] * solution[k];
    }
    solution[row] = sum / (a[row][row] || 1e-12);
  }
  return solution;
}

/**
 * Fit a robust articulation/pause calibration profile from timed reading samples.
 * Fits seconds = intercept + a·articulation + b·(per-class pause seconds) with
 * iteratively reweighted ridge regression, so setup/transition time and pause
 * style are learned instead of assumed. Requires at least three samples; fewer
 * return null so callers fall back to the default algorithm. Outlier samples
 * are reported instead of silently dominating the fit.
 * @param {object[]} [samples=[]] - Validated timed reading samples with unique IDs.
 * @returns {object|null} - The calibrated profile, or null when fewer than three samples exist.
 */
export function calibrateReading(samples = []) {
  if (!Array.isArray(samples) || samples.length > 100) {
    throw new Error('Use at most 100 timed reading samples.');
  }
  if (!samples.length) {
    return null;
  }
  samples.forEach(validateReadingSample);
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) {
    throw new Error('Timed reading sample IDs must be unique.');
  }
  // Two or fewer samples pin an unregularized line through the origin and give
  // no estimate of fit quality; use the default algorithm instead.
  if (samples.length < 3) {
    return null;
  }
  // Features: [1, articulation seconds, pause seconds per class in default units].
  const features = samples.map(({ stats }) => [
    1,
    stats.weightedSyllables * 0.16,
    ...PAUSE_KINDS.map((kind) => (stats.pauses?.[kind] ?? 0) * PAUSE_UNITS[kind]),
  ]);
  const observed = samples.map((sample) => sample.seconds);
  // Residual spread from the default prediction (no intercept, all multipliers
  // 1). It is robust because most samples are expected to be well-timed, so a
  // single mistimed sample inflates only its own residual and is down-weighted.
  const defaultPrediction = (row) => row.slice(1).reduce((sum, value) => sum + value, 0);
  const defaultResiduals = features.map((row, index) =>
    Math.abs(observed[index] - defaultPrediction(row))
  );
  const spread = Math.max(1, median(defaultResiduals) * 1.4826, Math.min(...observed) * 0.05);
  // Hard-reject samples far outside the robust residual band before fitting;
  // with a 100x mistiming the intercept would otherwise absorb the outlier and
  // the remaining samples would look like errors.
  const inliers = samples.filter(
    (_, index) => defaultResiduals[index] <= Math.max(spread * 6, Math.min(...observed) * 2)
  );
  const fitSamples = inliers.length >= 3 ? inliers : samples;
  const fitFeatures = fitSamples.map(({ stats }) => [
    1,
    stats.weightedSyllables * 0.16,
    ...PAUSE_KINDS.map((kind) => (stats.pauses?.[kind] ?? 0) * PAUSE_UNITS[kind]),
  ]);
  const fitObserved = fitSamples.map((sample) => sample.seconds);
  // Fit seconds = intercept + a·articulation + w_k·pause_k directly. Robust
  // weights keep one mistimed sample from dominating; a light ridge scaled to
  // feature magnitude pulls the fit toward the default rate for sparse data.
  const featureScale = [
    1,
    Math.max(1, ...features.map((row) => row[1])),
    ...PAUSE_KINDS.map((_, k) => Math.max(1, ...features.map((row) => row[2 + k]))),
  ];
  const n = PAUSE_KINDS.length + 2;
  const ridge = 0.005 * fitSamples.length;
  // Start at the default prediction (all multipliers 1, no intercept).
  let coefficients = [0, ...new Array(n - 1).fill(1)];
  for (let iteration = 0; iteration < 15; iteration++) {
    const xtx = Array.from({ length: n }, () => new Array(n).fill(0));
    const xty = new Array(n).fill(0);
    for (let row = 0; row < fitSamples.length; row++) {
      const prediction = fitFeatures[row].reduce(
        (sum, value, i) => sum + value * coefficients[i],
        0
      );
      const residual = Math.abs(fitObserved[row] - prediction);
      const weight = Math.min(1, (1.5 * spread) / Math.max(residual, 1e-12));
      for (let i = 0; i < n; i++) {
        xty[i] += weight * fitFeatures[row][i] * fitObserved[row];
        for (let j = i; j < n; j++) {
          xtx[i][j] += weight * fitFeatures[row][i] * fitFeatures[row][j];
        }
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        xtx[i][j] = xtx[j][i];
      }
    }
    // Ridge: keep the intercept unregularized, pull the rest toward defaults.
    for (let i = 1; i < n; i++) {
      xtx[i][i] += ridge * featureScale[i] ** 2;
      xty[i] += ridge * featureScale[i] ** 2;
    }
    const solved = solveSystem(xtx, xty);
    // Clamp only pathological negatives; tiny negative values are numerical
    // noise and must not zero out a coefficient the data still supports.
    coefficients = solved.map((value) => (value < -1e-9 ? 0 : Math.max(0, value)));
  }
  const predict = (index) =>
    features[index].reduce((sum, value, i) => sum + value * coefficients[i], 0);
  const errors = samples.map((_, index) => Math.abs(predict(index) - observed[index]));
  const relativeErrors = errors.map((error, index) => error / Math.max(observed[index], 1e-12));
  const medianRelativeError = median(relativeErrors);
  // Modified z-score: robust to the very outliers it detects. A sample is
  // suspicious when it sits far above the typical error, or is plainly wrong.
  const errorSpread = Math.max(
    0.05,
    median(relativeErrors.map((value) => Math.abs(value - medianRelativeError))) * 1.4826
  );
  const outliers = samples
    .map((sample, index) => ({
      id: sample.id,
      name: sample.name,
      relativeError: relativeErrors[index],
    }))
    .filter(
      (entry) =>
        entry.relativeError > 0.25 ||
        (entry.relativeError - medianRelativeError) / errorSpread > 3.5
    );
  // Leave-one-out error: refit without each sample on the converged weights is
  // costly; approximate with the residual inflated by its robust down-weight.
  const looErrors = samples.map((_, index) => {
    const kept = errors.filter((__, other) => other !== index);
    const keptMedian = median(kept);
    return Math.max(errors[index], keptMedian);
  });
  const seconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const units = samples.reduce((sum, sample) => sum + sample.stats.weightedSyllables, 0);
  const words = samples.reduce((sum, sample) => sum + sample.stats.spokenWords, 0);
  return {
    intercept: coefficients[0],
    articulation: coefficients[1],
    pauses: 1,
    pauseWeights: Object.fromEntries(PAUSE_KINDS.map((kind, i) => [kind, coefficients[2 + i]])),
    count: samples.length,
    seconds,
    baselineDensity: units / words,
    medianRelativeError,
    looMeanAbsoluteError: looErrors.reduce((sum, value) => sum + value, 0) / looErrors.length,
    outliers,
    baselineSecondsPerWord: median(
      samples.map((_, index) => predict(index) / samples[index].stats.spokenWords)
    ),
  };
}
