import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOctoberDemo, OCTOBER_CUTOFF } from './analytics/octoberDemo.js';
import { buildOperationalDemo } from './analytics/operationalDemo.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { canonicalMutations, type RecordMutation } from './database/mutations.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildReport } from './reports.js';
import type { DatabaseShape, MeasurementRecord, RecoveryRecord, TransferRecord } from './types.js';

test('October demo is explicitly synthetic, additive and limited to recorded dates in all four regions', () => {
  const demo = buildOctoberDemo();
  assert.deepEqual(demo, buildOctoberDemo());
  assert.equal(demo.records.length, 24);
  assert.equal(new Set(demo.records.map(row => row.region)).size, 4);
  assert.equal(new Set(demo.records.map(row => row.textileType)).size, 6);
  assert.ok(demo.domainTables.every(([name]) => !['users','organizations','facilities'].includes(name)));
  for (const [name, rows] of demo.domainTables) for (const row of rows) {
    assert.match(row.id, /^SYN-[A-Z]+-OCT26-/);
    if ('isDemo' in row) assert.equal(row.isDemo, true);
    for (const key of ['createdAt','updatedAt','timestamp','occurredAt'] as const) {
      if (key in row) {
        const time = Date.parse(String(row[key as keyof typeof row]));
        assert.ok(time >= Date.parse('2026-10-01T00:00:00+08:00') && time <= Date.parse(OCTOBER_CUTOFF), `${name}.${key} must not be future-dated.`);
      }
    }
  }
});

test('October material mass, measurements, lifecycle timestamps and rewards reconcile', () => {
  const demo = buildOctoberDemo();
  const transfers = demo.domainTables.find(([name]) => name === 'transfers')![1] as TransferRecord[];
  const measurements = demo.domainTables.find(([name]) => name === 'measurements')![1] as MeasurementRecord[];
  const recovery = demo.domainTables.find(([name]) => name === 'recoveryRecords')![1] as RecoveryRecord[];
  assert.equal(transfers.length, 48);
  for (const record of demo.records) {
    assert.ok(record.generatedKg >= record.collectedKg && record.collectedKg >= record.sortedKg);
    assert.ok(record.sortedKg >= record.reusedKg + record.recycledKg);
  }
  for (const record of recovery) assert.ok(Math.abs(record.inputWeightKg - record.outputWeightKg! - record.residualWeightKg!) < 0.000001);
  for (const transfer of transfers) {
    assert.equal(transfer.events.at(-1)!.timestamp, transfer.updatedAt);
    assert.equal(transfer.pendingRewardCredits, transfer.verifiedWeightKg! * 2);
    assert.equal(transfer.verifiedWeightKg, transfer.agreedWeightKg);
    for (let i = 1; i < transfer.events.length; i++) assert.ok(Date.parse(transfer.events[i].timestamp!) >= Date.parse(transfer.events[i-1].timestamp!));
    for (const event of transfer.events.filter(item => item.measurementId)) assert.equal(event.timestamp, measurements.find(item => item.id === event.measurementId)?.timestamp);
  }
  const writes = demo.domainTables.flatMap(([name, rows]) => rows.map(record => ({ name, record } as RecordMutation)));
  assert.ok(canonicalMutations(writes).every(row => row.mode === 'insert'));
});

test('October fixture feeds the operational chart, regional totals and reports math without changing historical fixtures', async () => {
  const demo = buildOctoberDemo();
  const seed = await createSeedData();
  const historical = buildOperationalDemo();
  for (const [name, rows] of historical.domainTables) (seed[name] as DatabaseShape[keyof DatabaseShape]).push(...rows as never[]);
  const existing = { ...seed.materialBatches[0], id: 'OCT-EXISTING-FRACTIONAL', isDemo: false,
    createdAt: '2026-10-15T01:00:00Z', declaredWeightKg: 46.999, currentWeightKg: 46.999 };
  seed.materialBatches.push(existing);
  const store = new MemoryStore(seed);
  const actor = seed.users[0];
  const now = new Date('2026-10-17T04:00:00Z');
  const septemberQuery = { dateRange: 'Custom range', startDate: '2026-09-01', endDate: '2026-09-30' };
  const before = await buildDashboardAnalytics(store, actor, septemberQuery, undefined, now);
  for (const [name, rows] of demo.domainTables) for (const row of rows) await store.insert(name as never, row as never);
  const september = await buildDashboardAnalytics(store, actor, septemberQuery, undefined, now);
  assert.deepEqual(september.circularFlow, before.circularFlow);
  const october = await buildDashboardAnalytics(store, actor, { dateRange: 'Custom range', startDate: '2026-10-01', endDate: '2026-10-16' }, undefined, now);
  assert.equal(october.circularFlow.generatedKg, demo.summary.declaredKg + existing.declaredWeightKg);
  assert.equal(october.circularFlow.collectedKg, demo.summary.collectedKg);
  assert.equal(october.circularFlow.reusedKg, demo.summary.reusedKg, 'Final reuse records are explicitly present on distinct demo portions.');
  assert.equal(october.circularFlow.recycledKg, demo.summary.recycledKg, 'Final recycling records are explicitly present on distinct demo portions.');
  assert.equal(october.circularFlow.recycledAvailable, true);
  assert.equal(october.impactMetrics.diversionRate, Number(((demo.summary.reusedKg + demo.summary.recycledKg) / demo.summary.collectedKg * 100).toFixed(1)));
  assert.equal(october.materialEvidence.completedKg, demo.summary.reusedKg + demo.summary.recycledKg);
  assert.equal(october.operations.metrics.completedTransfers, 48);
  assert.equal(october.regionalActivity.reduce((sum, row) => sum + row.collectionKg, 0), demo.summary.collectedKg);
  assert.equal(october.wasteTrend[0].month, 'Oct 2026');
  assert.equal(october.wasteTrend[0].collected, demo.summary.collectedKg);
  assert.equal(october.engagementMetrics.monthlyActiveUsersAvailable, true);
  assert.deepEqual(await store.findById('materialBatches', existing.id), existing);
  const report = await buildReport(store, actor, 'material-flow', { dateRange: 'Custom range', startDate: '2026-10-01', endDate: '2026-10-16' }, undefined, now);
  assert.equal(report.rows.at(-1)![3], '53.290999');
  assert.ok(Math.abs(Number(report.rows.at(-1)![3]) * 1000 - october.circularFlow.generatedKg) < 0.000001);
});

test('default August-October demo window reconciles growing trends, totals and exports without rewriting history', async () => {
  const seed = await createSeedData();
  for (const demo of [buildOperationalDemo(), buildOctoberDemo()]) {
    for (const [name, rows] of demo.domainTables) (seed[name] as DatabaseShape[keyof DatabaseShape]).push(...rows as never[]);
  }
  const before = structuredClone(seed);
  const store = new MemoryStore(seed), actor = seed.users[0], now = new Date('2026-10-19T04:00:00Z');
  const data = await buildDashboardAnalytics(store, actor, {}, undefined, now);
  assert.equal(data.metadata.period.startDate, '2026-08-01');
  assert.deepEqual(data.wasteTrend.map(row => row.month), ['Aug 2026', 'Sept 2026', 'Oct 2026']);
  const flowKeys = { recorded: 'generatedKg', collected: 'collectedKg', recycled: 'recycledKg', reused: 'reusedKg' } as const;
  for (const key of ['recorded', 'collected', 'recycled', 'reused'] as const) {
    assert.ok(data.wasteTrend.every((row, index, rows) => index === 0 || row[key] > rows[index - 1][key]), `${key} demo trend should rise from August through October.`);
    const total = data.wasteTrend.reduce((sum, row) => sum + row[key], 0);
    const expected = data.circularFlow[flowKeys[key]];
    assert.ok(Math.abs(total - expected) < 0.000001);
  }
  const rate = data.materialEvidence.matchedDiversionKg / data.circularFlow.collectedKg * 100;
  assert.equal(data.impactMetrics.diversionRate, Number(rate.toFixed(1)));
  assert.ok(Math.abs(data.materialEvidence.matchedDiversionKg + data.materialEvidence.unlinkedOutcomeKg - data.circularFlow.reusedKg - data.circularFlow.recycledKg) < 0.000001);
  const report = await buildReport(store, actor, 'material-flow', {}, undefined, now);
  assert.equal(report.period.startDate, data.metadata.period.startDate);
  assert.ok(Math.abs(Number(report.rows.at(-1)![4]) * 1000 - data.circularFlow.collectedKg) < 0.000001);
  const allTime = await buildDashboardAnalytics(store, actor, { dateRange: 'All time' }, undefined, now);
  assert.equal(allTime.wasteTrend[0].month, 'Jan 2026');
  assert.ok(allTime.circularFlow.collectedKg > data.circularFlow.collectedKg);
  for (const [name, rows] of Object.entries(before)) assert.deepEqual(await store.all(name as keyof DatabaseShape), rows, `${name} must remain unchanged.`);
});
