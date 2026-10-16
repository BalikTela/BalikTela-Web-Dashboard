import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildPredictiveReport, evaluateForecast, fitMaterialPreferences, fitVolumeModel, forecastSeries, trainingCsv } from './analytics/predictive.js';
import { generateSyntheticDataset, syntheticDataset, weekDate, WEEK_MS } from './analytics/synthetic.js';
import { createHash } from 'node:crypto';

const { observations, manifest } = syntheticDataset;
const sum = (values: number[]) => Math.round(values.reduce((total, value) => total + value, 0) * 100) / 100;

test('predictive dataset has 9,600 unique reproducible synthetic observations with a canonical checksum', () => {
  assert.equal(observations.length, 9600);
  assert.equal(new Set(observations.map(row => row.id)).size, 9600);
  assert.ok(observations.every(row => row.isSynthetic));
  assert.equal(generateSyntheticDataset().manifest.sha256, manifest.sha256);
  assert.notEqual(generateSyntheticDataset(42).manifest.sha256, manifest.sha256);
  assert.equal(createHash('sha256').update(JSON.stringify(observations)).digest('hex'), manifest.sha256);
});

test('chronological split is 6,720 / 1,440 / 1,440; all linked outcomes stay inside their partition week', () => {
  assert.deepEqual(manifest.partitions.map(part => part.records), [6720, 1440, 1440]);
  assert.deepEqual(manifest.partitions.map(part => part.weeks), [84, 18, 18]);
  for (const part of manifest.partitions) {
    const rows = observations.filter(row => row.partition === part.name);
    assert.equal(rows.length, part.records);
    assert.equal(new Set(rows.map(row => row.weekStart)).size, part.weeks);
    for (const row of rows) {
      assert.ok(row.weekStart >= part.start && row.weekStart < part.endExclusive);
      assert.ok(row.occurredAt < row.collectionAt && row.collectionAt < row.selectionAt);
      assert.ok(Date.parse(row.selectionAt) < Date.parse(row.weekStart) + WEEK_MS);
      assert.ok(row.selectionAt < manifest.cutoffExclusive);
      assert.ok(row.declaredKg > 0 && row.collectedKg >= 0 && row.collectedKg <= row.declaredKg);
    }
  }
});

test('forecast baselines implement actual last-value, trailing mean, linear and seasonal projections', () => {
  assert.deepEqual(forecastSeries([1, 2, 3], 'last-value'), [3, 3, 3, 3]);
  assert.deepEqual(forecastSeries([1, 2, 3], 'trailing-mean'), [2, 2, 2, 2]);
  assert.deepEqual(forecastSeries([1, 2, 3], 'linear-trend'), [4, 5, 6, 7]);
  assert.deepEqual(forecastSeries(Array.from({ length: 60 }, (_, i) => i), 'seasonal-naive'), [8, 9, 10, 11]);
  assert.throws(() => forecastSeries([1], 'linear-trend'));
  assert.throws(() => forecastSeries([1], 'seasonal-naive'));
  assert.throws(() => forecastSeries([], 'last-value'));
  assert.throws(() => forecastSeries([NaN], 'last-value'));
  assert.throws(() => forecastSeries([-1], 'last-value'));
  assert.throws(() => forecastSeries([1], 'last-value', 5));
});

test('forecast errors use the observed mass denominator and do not turn a zero baseline into accuracy', () => {
  const metrics = evaluateForecast([{ actual: 100, predicted: 120, horizon: 0 }, { actual: 300, predicted: 240, horizon: 0 }], [30]);
  assert.equal(metrics.maeKg, 40);
  assert.equal(metrics.wapePercent, 20);
  assert.equal(metrics.biasKg, -20);
  assert.equal(metrics.intervalCoveragePercent, 50);
  assert.equal(evaluateForecast([{ actual: 0, predicted: 1, horizon: 0 }]).wapePercent, null);
});

test('four-week forecasts reconcile totals, mass constraints and empirical ranges', () => {
  const report = buildPredictiveReport();
  assert.equal(report.status, 'ready');
  assert.deepEqual(report.forecast.map(point => point.weekStart), [120, 121, 122, 123].map(weekDate));
  assert.equal(report.totals.collectedKg, sum(report.forecast.map(point => point.collectedKg)));
  assert.equal(report.totals.declaredKg, sum(report.forecast.map(point => point.declaredKg)));
  for (const point of report.forecast) {
    assert.ok(point.collectedKg <= point.declaredKg);
    assert.ok(point.collectedLowerKg >= 0 && point.declaredLowerKg >= 0);
    assert.ok(point.collectedLowerKg <= point.collectedKg && point.collectedKg <= point.collectedUpperKg);
    assert.ok(point.declaredLowerKg <= point.declaredKg && point.declaredKg <= point.declaredUpperKg);
    assert.ok(point.collectedUpperKg <= point.declaredUpperKg);
  }
  assert.equal(report.models?.declared.test.predictions, 60);
  assert.equal(report.models?.collected.validation.predictions, 60);
  assert.ok(report.models!.collected.test.intervalCoveragePercent! >= 0 && report.models!.collected.test.intervalCoveragePercent! <= 100);
});

test('scoped datasets reconcile, unknown filters fail, and sparse regional categories remain gated', () => {
  const all = buildPredictiveReport({ historyWeeks: 120 });
  const regional = all.regions.map(region => buildPredictiveReport({ region, historyWeeks: 120 }));
  assert.equal(sum(regional.map(report => report.scope.records)), 9600);
  all.history.forEach((point, i) => assert.equal(sum(regional.map(report => report.history[i].declaredKg)), point.declaredKg));
  assert.ok(regional.every(report => report.status === 'ready' && report.scope.records === 2400));
  const sparse = buildPredictiveReport({ region: 'Metro Manila', materialCategory: 'Cotton' });
  assert.equal(sparse.status, 'insufficient-data');
  assert.equal(sparse.models, null);
  assert.equal(sparse.forecast.length, 0);
  assert.throws(() => buildPredictiveReport({ region: 'Invented' }));
  assert.throws(() => buildPredictiveReport({ historyWeeks: 10 }));
  const restricted = buildPredictiveReport({ allowedRegions: ['Central Visayas'] });
  assert.deepEqual(restricted.regions, ['Central Visayas']);
  assert.equal(restricted.scope.records, 2400);
  assert.equal(buildPredictiveReport({ allowedRegions: [] }).scope.records, 0);
});

test('historical display is not a training cutoff and leaves forecasts and evaluations unchanged', () => {
  const short = buildPredictiveReport({ historyWeeks: 13 });
  const long = buildPredictiveReport({ historyWeeks: 120 });
  assert.equal(short.history.length, 13);
  assert.equal(long.history.length, 120);
  assert.deepEqual(short.forecast, long.forecast);
  assert.deepEqual(short.models, long.models);
  assert.deepEqual(short.preferences, long.preferences);
});

test('changing held-out outcomes cannot change volume method selection or material-window selection', () => {
  const report = buildPredictiveReport({ historyWeeks: 120 });
  const series = report.history.map(point => point.declaredKg);
  const original = fitVolumeModel(series);
  const perturbed = fitVolumeModel(series.map((value, index) => index >= 102 ? value * 3 : value));
  assert.equal(perturbed.method, original.method);
  assert.deepEqual(perturbed.validation, original.validation);
  assert.notDeepEqual(perturbed.test, original.test);
  const preferences = fitMaterialPreferences(observations);
  const altered = fitMaterialPreferences(observations.map(row => row.partition === 'test' ? { ...row, recyclerSelected: !row.recyclerSelected } : row));
  assert.equal(altered.windowWeeks, preferences.windowWeeks);
  assert.notEqual(altered.testBrierScore, preferences.testBrierScore);
});

test('material probabilities use category offers, shares use all selections, and scores come from held-out offers', () => {
  const { preferences } = buildPredictiveReport();
  assert.ok(preferences);
  assert.equal(preferences.testOffers, 1440);
  assert.ok(preferences.testBrierScore >= 0 && preferences.testBrierScore <= 1);
  assert.ok(preferences.baselineBrierScore >= 0 && preferences.baselineBrierScore <= 1);
  assert.equal(preferences.ranked.length, 6);
  const total = preferences.ranked.reduce((value, item) => value + item.selected, 0);
  preferences.ranked.forEach((item, index) => {
    assert.equal(item.selectionProbability, (item.selected + 1) / (item.offers + 2));
    assert.equal(item.observedSelectedSharePercent, Math.round(item.selected / total * 10000) / 100);
    assert.ok(item.selected <= item.offers && item.selectionProbability > 0 && item.selectionProbability < 1);
    if (index) assert.ok(item.selectionProbability <= preferences.ranked[index - 1].selectionProbability);
    assert.equal(item.weeklyRates.length, 12);
  });
  assert.ok(Math.abs(sum(preferences.ranked.map(item => item.observedSelectedSharePercent)) - 100) < .05);
});

test('bundled CSV and manifest reproduce the canonical fixture, not operational Supabase rows', async () => {
  const csv = await readFile(new URL('../data/predictive/v1/observations.csv', import.meta.url), 'utf8');
  assert.equal(csv, trainingCsv());
  assert.equal(csv.trim().split('\n').length, 9601);
  const artifact = JSON.parse(await readFile(new URL('../data/predictive/v1/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(artifact, manifest);
  const evaluation = JSON.parse(await readFile(new URL('../data/predictive/v1/evaluation.json', import.meta.url), 'utf8'));
  assert.deepEqual(evaluation, buildPredictiveReport({ historyWeeks: 120 }));
});
