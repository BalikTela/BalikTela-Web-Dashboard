import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperationalDemo, normalizeDemoRow } from './analytics/operationalDemo.js';
import { buildOctoberDemo } from './analytics/octoberDemo.js';
import { completeDemoLifecycle, type OperationalDemoData } from './analytics/completeDemoLifecycle.js';
import { DEMO_LIFECYCLE_COLUMNS, planDemoLifecycle, verifyDemoDependencies, type DemoTable } from './analytics/demoLifecyclePlan.js';
import { aggregateMaterialEvidence } from './materialEvidence.js';
import { encodeRecord } from './database/codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from './database/schema.js';
import { wasteRecords } from '../src/data/mockData.js';
import type { DatabaseShape } from './types.js';

const legacy = buildOperationalDemo(undefined, undefined, null, { lifecycleVersion: 1 });
const completed = buildOperationalDemo();
const table = <K extends keyof DatabaseShape>(data: OperationalDemoData, name: K) => data.domainTables.find(([key]) => key === name)![1] as DatabaseShape[K];
const canonical = (data: OperationalDemoData): DemoTable[] => [...data.domainTables.filter(([name]) => DEMO_LIFECYCLE_COLUMNS[WEB_PERSISTENCE_COLLECTION_MAP[name]])
  .map(([name, rows]) => ({ table: WEB_PERSISTENCE_COLLECTION_MAP[name], rows: rows.map(row => normalizeDemoRow(encodeRecord(name as never, row as never))) })),
  { table: 'flow_events', rows: data.flowEvents.map(normalizeDemoRow) }];

test('completed demo portions preserve source mass and add real final-output evidence, not synthetic exceptions to KPI rules', () => {
  assert.deepEqual(completed, buildOperationalDemo());
  const batches = table(completed, 'materialBatches'), transfers = table(completed, 'transfers');
  const records = table(completed, 'recoveryRecords'), measurements = table(completed, 'measurements');
  const totals = aggregateMaterialEvidence(batches, transfers, records, { measurements, listings: table(completed, 'listings') });
  for (const [actual, field] of [[totals.generatedKg, 'generatedKg'], [totals.collectedKg, 'collectedKg'], [totals.sortedKg, 'sortedKg'], [totals.reusedKg, 'reusedKg'], [totals.recycledKg, 'recycledKg']] as const) {
    assert.equal(actual, wasteRecords.reduce((sum, item) => sum + item[field], 0));
  }
  assert.equal(totals.completedKg, totals.reusedKg + totals.recycledKg);
  assert.equal(totals.diversionRate, Number(((totals.reusedKg + totals.recycledKg) / totals.collectedKg * 100).toFixed(1)));
  assert.equal(totals.collectionConflicts, 0); assert.equal(totals.outcomeConflicts, 0);
  assert.equal(totals.missingCollectionBatches, 0); assert.equal(totals.completedMissingWeight, 0);
  assert.equal(totals.unlinkedOutcomeKg, 0);
  assert.equal(batches.length, wasteRecords.length * 2);
  assert.equal(transfers.length, table(legacy, 'transfers').length);
  assert.equal(totals.unresolvedCollectedKg + totals.matchedDiversionKg, totals.collectedKg);
  for (const name of ['offers', 'walletEntries', 'users', 'organizations', 'facilities', 'systemInteractions'] as const) assert.deepEqual(table(completed, name), table(legacy, name));
  for (const [name, rows] of completed.domainTables) assert.equal(new Set(rows.map(row => row.id)).size, rows.length, `${name} IDs must be unique`);
});

test('each completed transfer has its own batch, consistent stage weights and a final-output event before completion', () => {
  const transfers = table(completed, 'transfers'), records = table(completed, 'recoveryRecords');
  assert.equal(new Set(transfers.map(item => item.batchId)).size, transfers.length);
  for (const transfer of transfers) {
    const final = records.filter(item => item.transferId === transfer.id && item.stage === 'Recovery');
    assert.equal(final.length, 1); assert.equal(final[0].batchId, transfer.batchId);
    assert.equal(final[0].outputWeightKg, transfer.verifiedWeightKg);
    assert.equal(final[0].outcome, transfer.circularOutcome);
    assert.ok(Date.parse(final[0].timestamp) < Date.parse(transfer.updatedAt));
    const output = transfer.events.find(item => item.type === 'Processing')!;
    const measurement = table(completed, 'measurements').find(item => item.id === output.measurementId)!;
    assert.equal(measurement.canonicalStage, 'recovery_output'); assert.equal(measurement.batchId, transfer.batchId);
    assert.equal(measurement.weightKg, final[0].outputWeightKg); assert.equal(output.timestamp, measurement.timestamp);
    assert.ok(transfer.events.every((item, i) => !i || item.timestamp >= transfer.events[i-1].timestamp));
  }
  for (const record of records) assert.ok(Math.abs(record.inputWeightKg - record.outputWeightKg! - record.residualWeightKg! - (record.lossWeightKg ?? 0)) < 0.000001);
});

test('lifecycle completion is pure and refuses real or foreign batches', () => {
  const untouched = structuredClone(legacy); completeDemoLifecycle(legacy); assert.deepEqual(legacy, untouched);
  const foreign = structuredClone(legacy); table(foreign, 'materialBatches')[0].isDemo = false;
  assert.throws(() => completeDemoLifecycle(foreign), /only accepts generated SYN demo/);
});

test('repair plans are deterministic, narrow, replayable without duplicates and preserve unknown fields', () => {
  const before = canonical(legacy), after = canonical(completed);
  const current = structuredClone(before);
  current[0].rows[0].preserved_metadata = 'untouched';
  for (const row of current.flatMap(item => item.rows)) for (const key of Object.keys(row)) {
    if (key.endsWith('_at') && typeof row[key] === 'string') row[key] = String(row[key]).replace('.000Z', '+00:00');
  }
  const plan = planDemoLifecycle(before, after, current);
  assert.ok(plan.length > 0); assert.ok(plan.every(item => Object.keys(DEMO_LIFECYCLE_COLUMNS).includes(item.table)));
  for (const mutation of plan) {
    const target = current.find(item => item.table === mutation.table)!;
    if (mutation.before) {
      assert.ok(Object.keys(mutation.patch).every(column => DEMO_LIFECYCLE_COLUMNS[mutation.table].includes(column)));
      Object.assign(target.rows.find(item => item.id === mutation.id)!, mutation.patch);
    } else target.rows.push(mutation.after);
  }
  assert.deepEqual(planDemoLifecycle(before, after, current), []);
  assert.equal(current[0].rows[0].preserved_metadata, 'untouched');
});

test('repair refuses edited demo records, real ID collisions, missing originals and account writes', () => {
  const before = canonical(legacy), after = canonical(completed);
  for (const mutate of [
    (rows: DemoTable[]) => { rows[0].rows[0].is_demo = false; },
    (rows: DemoTable[]) => { rows[0].rows[0].declared_weight_kg = 1234567; },
    (rows: DemoTable[]) => { rows[0].rows.shift(); },
  ]) {
    const current = structuredClone(before); mutate(current);
    assert.throws(() => planDemoLifecycle(before, after, current));
  }
  assert.throws(() => planDemoLifecycle(before, [...after, { table: 'users', rows: [] }], before), /cannot write this table/);
  assert.throws(() => verifyDemoDependencies([{ id: 'SYN-WLT-1', points: 5 }], [{ id: 'SYN-WLT-1', points: 4 }]), /were edited/);
});

test('repair preserves custom listing status and only corrects exact historical synthetic timestamp variants', () => {
  const before = canonical(legacy), after = canonical(completed), current = structuredClone(before);
  const listing = current.find(item => item.table === 'listings')!.rows[0]; listing.status = 'closed';
  const measurement = current.find(item => item.table === 'measurements')!.rows.find(row => row.stage === 'validation')!;
  measurement.measured_at = new Date(Date.parse(String(measurement.measured_at)) + 3_600_000).toISOString();
  measurement.created_at = measurement.measured_at;
  const event = current.find(item => item.table === 'flow_events')!.rows.find(row => /-REC-4$/.test(row.id))!;
  event.occurred_at = new Date(Date.parse(String(event.occurred_at)) - 3_600_000).toISOString(); event.created_at = event.occurred_at;
  const plan = planDemoLifecycle(before, after, current);
  assert.ok(plan.find(item => item.id === measurement.id)?.patch.measured_at);
  assert.ok(plan.find(item => item.id === event.id)?.patch.occurred_at);
  assert.equal(plan.find(item => item.id === listing.id)?.patch.status, undefined);
  measurement.measured_at = '2026-10-19T00:00:00.000Z';
  assert.throws(() => planDemoLifecycle(before, after, current), /was edited/);
});

test('October uses the same completed evidence contract and keeps its existing mass and transfer totals', () => {
  const original = buildOctoberDemo({ lifecycleVersion: 1 }), next = buildOctoberDemo();
  assert.equal(next.summary.batches, 48); assert.equal(next.summary.sourceCohorts, 24);
  for (const key of ['declaredKg', 'collectedKg', 'sortedKg', 'reusedKg', 'recycledKg'] as const) assert.equal(next.summary[key], original.summary[key]);
  const totals = aggregateMaterialEvidence(table(next, 'materialBatches'), table(next, 'transfers'), table(next, 'recoveryRecords'), { measurements: table(next, 'measurements'), listings: table(next, 'listings') });
  assert.ok(totals.diversionRate! > 0 && totals.diversionRate! <= 100); assert.equal(totals.outcomeConflicts, 0);
});
