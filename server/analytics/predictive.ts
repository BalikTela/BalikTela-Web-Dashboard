import { linearRegression, linearRegressionLine, mean, quantile } from 'simple-statistics';
import type { ForecastEvaluation, ForecastMethod, PredictiveReport, TrainingObservation } from '../../shared/predictive.js';
import { DATASET_WEEKS, MATERIALS, REGIONS, TRAIN_WEEKS, VALIDATION_WEEKS, syntheticDataset, weekDate } from './synthetic.js';

export const FORECAST_METHODS: ForecastMethod[] = ['last-value', 'trailing-mean', 'linear-trend', 'seasonal-naive'];
const HORIZON = 4;
const validationEnd = TRAIN_WEEKS + VALIDATION_WEEKS;
const round = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));

interface EvaluationPoint { actual: number; predicted: number; horizon: number }

export function forecastSeries(history: number[], method: ForecastMethod, horizon = HORIZON): number[] {
  if (!history.length || history.some(value => !Number.isFinite(value) || value < 0)) throw new Error('A finite, non-negative historical series is required.');
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > HORIZON) throw new Error('Forecast horizon must be one to four weeks.');
  if (!FORECAST_METHODS.includes(method)) throw new Error('Unknown forecast method.');
  if (method === 'linear-trend' && history.length < 2) throw new Error('Linear trend requires at least two observations.');
  if (method === 'seasonal-naive' && history.length < 52) throw new Error('Seasonal naive requires at least 52 historical weeks.');
  const tail = history.slice(-26);
  const trend = method === 'linear-trend' ? linearRegressionLine(linearRegression(tail.map((value, index) => [index, value]))) : null;
  return Array.from({ length: horizon }, (_, index) => {
    const value = method === 'last-value' ? history.at(-1)!
      : method === 'trailing-mean' ? mean(history.slice(-8))
        : method === 'seasonal-naive' ? history[history.length - 52 + index]
          : trend!(tail.length + index);
    return Math.max(0, value);
  });
}

function backtest(series: number[], method: ForecastMethod, start: number, end: number, upperSeries?: number[], upperMethod?: ForecastMethod): EvaluationPoint[] {
  const points: EvaluationPoint[] = [];
  // Each origin sees only weeks preceding it. Model selection never sees test-block outcomes.
  for (let origin = start; origin + HORIZON <= end; origin++) {
    const predicted = forecastSeries(series.slice(0, origin), method);
    const upper = upperSeries && upperMethod ? forecastSeries(upperSeries.slice(0, origin), upperMethod) : null;
    predicted.forEach((value, index) => points.push({ actual: series[origin + index], predicted: upper ? Math.min(value, upper[index]) : value, horizon: index }));
  }
  return points;
}

export function evaluateForecast(points: EvaluationPoint[], bands?: number[]): ForecastEvaluation {
  if (!points.length) throw new Error('Evaluation requires held-out predictions.');
  const absoluteError = points.reduce((sum, point) => sum + Math.abs(point.predicted - point.actual), 0);
  const actualTotal = points.reduce((sum, point) => sum + point.actual, 0);
  return {
    maeKg: round(absoluteError / points.length),
    wapePercent: actualTotal > 0 ? round(absoluteError / actualTotal * 100) : null,
    biasKg: round(mean(points.map(point => point.predicted - point.actual))), predictions: points.length,
    intervalCoveragePercent: bands ? round(points.filter(point => Math.abs(point.predicted - point.actual) <= bands[point.horizon]).length / points.length * 100) : null,
  };
}

export function fitVolumeModel(series: number[], upperSeries?: number[], upperMethod?: ForecastMethod, upperBands?: number[]) {
  if (series.length !== DATASET_WEEKS) throw new Error('The PoC evaluation requires 120 complete weekly observations.');
  const candidates = FORECAST_METHODS.map(method => {
    const points = backtest(series, method, TRAIN_WEEKS, validationEnd, upperSeries, upperMethod);
    return { method, points, evaluation: evaluateForecast(points) };
  }).sort((a, b) => a.evaluation.maeKg - b.evaluation.maeKg);
  const chosen = candidates[0];
  const bands = Array.from({ length: HORIZON }, (_, horizon) => quantile(chosen.points.filter(point => point.horizon === horizon).map(point => Math.abs(point.actual - point.predicted)), 0.8));
  const test = backtest(series, chosen.method, validationEnd, DATASET_WEEKS, upperSeries, upperMethod);
  const evaluation = evaluateForecast(test, bands);
  if (upperSeries && upperMethod && upperBands) {
    let covered = 0;
    for (let origin = validationEnd; origin + HORIZON <= DATASET_WEEKS; origin++) {
      const upper = forecastSeries(upperSeries.slice(0, origin), upperMethod);
      for (let h = 0; h < HORIZON; h++) {
        const point = test[(origin - validationEnd) * HORIZON + h];
        const lower = Math.max(0, point.predicted - bands[h]);
        const ceiling = Math.min(point.predicted + bands[h], upper[h] + upperBands[h]);
        if (point.actual >= lower && point.actual <= ceiling) covered++;
      }
    }
    evaluation.intervalCoveragePercent = round(covered / test.length * 100);
  }
  return { method: chosen.method, validation: chosen.evaluation, test: evaluation, bands, future: forecastSeries(series, chosen.method) };
}

function selectionProbability(rows: TrainingObservation[], category: string): number {
  const offered = rows.filter(row => row.materialCategory === category);
  return (offered.filter(row => row.recyclerSelected).length + 1) / (offered.length + 2);
}

function preferenceBacktest(rows: TrainingObservation[], window: number, start: number, end: number) {
  const scores: Array<{ probability: number; actual: number; baseline: number }> = [];
  for (let week = start; week < end; week++) {
    const startWeek = weekDate(Math.max(0, week - window));
    const targetWeek = weekDate(week);
    const historical = rows.filter(row => row.weekStart >= startWeek && row.weekStart < targetWeek);
    const pooled = (historical.filter(row => row.recyclerSelected).length + 1) / (historical.length + 2);
    const probabilities = new Map(MATERIALS.map(category => [category, selectionProbability(historical, category)]));
    rows.filter(row => row.weekStart === targetWeek).forEach(row => scores.push({ probability: probabilities.get(row.materialCategory)!, actual: Number(row.recyclerSelected), baseline: pooled }));
  }
  return {
    brier: mean(scores.map(point => (point.probability - point.actual) ** 2)),
    baseline: mean(scores.map(point => (point.baseline - point.actual) ** 2)),
    logLoss: -mean(scores.map(point => point.actual * Math.log(point.probability) + (1 - point.actual) * Math.log(1 - point.probability))),
    count: scores.length,
  };
}

export function fitMaterialPreferences(rows: TrainingObservation[]): NonNullable<PredictiveReport['preferences']> {
  const window = [8, 13, 26, 52].map(weeks => ({ weeks, score: preferenceBacktest(rows, weeks, TRAIN_WEEKS, validationEnd).logLoss })).sort((a, b) => a.score - b.score)[0].weeks;
  const test = preferenceBacktest(rows, window, validationEnd, DATASET_WEEKS);
  const recentStart = weekDate(DATASET_WEEKS - window);
  const previousStart = weekDate(Math.max(0, DATASET_WEEKS - window * 2));
  const recent = rows.filter(row => row.weekStart >= recentStart);
  const previous = rows.filter(row => row.weekStart >= previousStart && row.weekStart < recentStart);
  const totalSelected = recent.filter(row => row.recyclerSelected).length;
  const categories = MATERIALS.filter(category => rows.some(row => row.materialCategory === category));
  return {
    windowWeeks: window, testBrierScore: Number(test.brier.toFixed(4)), baselineBrierScore: Number(test.baseline.toFixed(4)),
    testLogLoss: Number(test.logLoss.toFixed(4)), testOffers: test.count,
    ranked: categories.map(materialCategory => {
      const offered = recent.filter(row => row.materialCategory === materialCategory);
      const selected = offered.filter(row => row.recyclerSelected).length;
      const earlier = previous.filter(row => row.materialCategory === materialCategory);
      return {
        materialCategory, offers: offered.length, selected, selectionProbability: selectionProbability(recent, materialCategory),
        observedSelectedSharePercent: totalSelected ? round(selected / totalSelected * 100) : 0,
        changePoints: earlier.length && offered.length ? round((selected / offered.length - earlier.filter(row => row.recyclerSelected).length / earlier.length) * 100) : null,
        weeklyRates: Array.from({ length: 12 }, (_, index) => {
          const weekStart = weekDate(DATASET_WEEKS - 12 + index);
          const weekly = rows.filter(row => row.weekStart === weekStart && row.materialCategory === materialCategory);
          return weekly.length ? weekly.filter(row => row.recyclerSelected).length / weekly.length : null;
        }),
      };
    }).sort((a, b) => b.selectionProbability - a.selectionProbability),
  };
}

export interface PredictiveScope { region?: string; materialCategory?: string; historyWeeks?: number; allowedRegions?: string[] }

export function buildPredictiveReport(scope: PredictiveScope = {}): PredictiveReport {
  const region = scope.region ?? 'All regions';
  const materialCategory = scope.materialCategory ?? 'All materials';
  if (region !== 'All regions' && !REGIONS.includes(region)) throw new Error('Unknown synthetic region.');
  if (materialCategory !== 'All materials' && !MATERIALS.includes(materialCategory)) throw new Error('Unknown synthetic material.');
  const historyWeeks = scope.historyWeeks ?? 26;
  if (![13, 26, 52, 120].includes(historyWeeks)) throw new Error('History must be 13, 26, 52, or 120 weeks.');
  const rows = syntheticDataset.observations.filter(row => (region === 'All regions' || row.region === region)
    && (materialCategory === 'All materials' || row.materialCategory === materialCategory)
    && (scope.allowedRegions === undefined || scope.allowedRegions.includes(row.region)));
  const weekly = Array.from({ length: DATASET_WEEKS }, (_, index) => {
    const weekStart = weekDate(index);
    const records = rows.filter(row => row.weekStart === weekStart);
    return { weekStart, declaredKg: round(records.reduce((sum, row) => sum + row.declaredKg, 0)), collectedKg: round(records.reduce((sum, row) => sum + row.collectedKg, 0)) };
  });
  const activeWeeks = weekly.filter(week => week.declaredKg > 0).length;
  const result: PredictiveReport = {
    mode: 'synthetic-poc', status: 'insufficient-data', message: '', manifest: syntheticDataset.manifest,
    scope: { region, materialCategory, records: rows.length, activeWeeks },
    regions: REGIONS.filter(item => scope.allowedRegions === undefined || scope.allowedRegions.includes(item)), materials: MATERIALS,
    history: weekly.slice(-historyWeeks), forecast: [], totals: { declaredKg: 0, collectedKg: 0 }, models: null, preferences: null,
    limitations: [
      'Synthetic proof of concept only. No real-world model validation or methodology approval is implied.',
      '9,600 event records aggregate to 120 weekly observations, not 9,600 independent weekly time points.',
      'Declared waste means material reported to this simulated platform; it is not a national waste-generation or landfill estimate.',
      'Collection is constrained not to exceed declared mass. Weekly bands are empirical validation-error ranges at nominal 80%, not guaranteed coverage or a four-week-total interval.',
      'Material selection scores estimate a simulated offer being selected, conditional on its category. They are not shares, do not sum to 100%, and do not represent real recycler preferences.',
      'Model selection uses validation only. Final tests use rolling origins: previous observed test weeks may become inputs, but future outcomes never enter a forecast.',
      'Final demonstration forecasts refit the selected methods on available past observations through the fixed dataset cutoff. History display filters do not change the training window.',
    ],
  };
  if (rows.length < 600 || activeWeeks < 104) {
    result.message = `This scope has ${rows.length} records and ${activeWeeks} active weeks. The PoC requires at least 600 records and 104 active weeks for a scoped forecast.`;
    return result;
  }
  const declaredSeries = weekly.map(week => week.declaredKg);
  const collectedSeries = weekly.map(week => week.collectedKg);
  const declared = fitVolumeModel(declaredSeries);
  const collected = fitVolumeModel(collectedSeries, declaredSeries, declared.method, declared.bands);
  result.status = 'ready';
  result.message = 'Synthetic forecasts and selection tendencies; not approved for real-world decisions.';
  result.models = {
    declared: { method: declared.method, validation: declared.validation, test: declared.test },
    collected: { method: collected.method, validation: collected.validation, test: collected.test },
  };
  result.forecast = declared.future.map((value, index) => {
    const mass = round(value);
    const collection = round(Math.min(collected.future[index], mass));
    return {
      weekStart: weekDate(DATASET_WEEKS + index), declaredKg: mass, collectedKg: collection,
      declaredLowerKg: round(Math.max(0, mass - declared.bands[index])), declaredUpperKg: round(mass + declared.bands[index]),
      collectedLowerKg: round(Math.max(0, collection - collected.bands[index])), collectedUpperKg: round(Math.min(collection + collected.bands[index], mass + declared.bands[index])),
    };
  });
  result.totals = {
    declaredKg: round(result.forecast.reduce((sum, week) => sum + week.declaredKg, 0)),
    collectedKg: round(result.forecast.reduce((sum, week) => sum + week.collectedKg, 0)),
  };
  result.preferences = fitMaterialPreferences(rows);
  return result;
}

export function trainingCsv(rows: TrainingObservation[] = syntheticDataset.observations): string {
  const headers: Array<keyof TrainingObservation> = ['id', 'weekStart', 'occurredAt', 'collectionAt', 'selectionAt', 'region', 'materialCategory', 'recyclerId', 'declaredKg', 'collectedKg', 'recyclerSelected', 'partition', 'isSynthetic'];
  const cell = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
  return [headers.join(','), ...rows.map(row => headers.map(key => cell(row[key])).join(','))].join('\n') + '\n';
}
