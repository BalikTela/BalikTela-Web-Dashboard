import assert from 'node:assert/strict';
import test from 'node:test';
import { changeDescription, formatMass, hasDiscrepancy, percentage, pointsDescription, toKilograms, toTons } from '../shared/metrics.js';
import { paginationWindow } from '../shared/pagination.js';
import { emptyListingFilters, filterListings } from '../src/lib/listingFilters.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDataQuality } from './dataQuality.js';
const asOf = new Date('2026-10-17T04:00:00Z');
const historicalQuery = { dateRange: 'Custom range', startDate: '2026-07-01', endDate: '2026-09-21' };

test('aggregate-only analytics omits stakeholder identities and lifecycle records while retaining regional totals', async () => {
  const seed = await createSeedData();
  const store = new MemoryStore(seed);
  const admin = seed.users[0];
  const actor = { ...admin, role: 'Government' as const, scope: { ...admin.scope, aggregateOnly: true } };
  const unrestricted = await buildDashboardAnalytics(store, admin, historicalQuery, undefined, asOf);
  const aggregate = await buildDashboardAnalytics(store, actor, historicalQuery, undefined, asOf);
  assert.deepEqual(aggregate.transactions, []);
  assert.deepEqual(aggregate.stakeholders, []);
  assert.deepEqual(aggregate.circularFlow, unrestricted.circularFlow);
  assert.deepEqual(aggregate.regionalActivity, unrestricted.regionalActivity);
  assert.equal(aggregate.facilities.reduce((sum, item) => sum + item.capacityKg, 0), unrestricted.facilities.reduce((sum, item) => sum + item.capacityKg, 0));
  const serialized = JSON.stringify(aggregate);
  for (const user of seed.users) assert.ok(!serialized.includes(user.fullName) && !serialized.includes(user.email));
  for (const facility of seed.facilities) assert.ok(!serialized.includes(facility.id) && !serialized.includes(facility.name));
  for (const transfer of seed.transfers) assert.ok(!serialized.includes(transfer.id));
  const quality = JSON.stringify(buildDataQuality(actor, seed.materialBatches, seed.transfers, 5, asOf));
  for (const record of [...seed.materialBatches, ...seed.transfers]) assert.ok(!quality.includes(record.id));
});

test('metric ton conversions preserve small weights, missing evidence, and round trips', () => {
  assert.equal(formatMass(96310), '96.31 t');
  assert.equal(formatMass(89), '0.089 t');
  assert.equal(formatMass(0), '0 t');
  assert.equal(formatMass(0.001), '0.000001 t');
  assert.equal(formatMass(null), 'Pending');
  assert.equal(toKilograms(toTons(123.456)), 123.456);
});

test('percentages use actual denominators, raw point changes, and honest zero baselines', () => {
  assert.equal(percentage(1, 3), 33.3);
  assert.equal(percentage(0, 10), 0);
  assert.equal(percentage(10, 0), 0);
  assert.match(changeDescription(10, 0, 'April'), /No baseline activity/);
  assert.equal(changeDescription(120, 100, 'April'), '+20% vs April');
  assert.equal(pointsDescription(449, 1000, 435, 1000, 'April'), '+1.4 pts vs April');
  assert.match(pointsDescription(2, 10, 0, 0, 'April'), /No comparable denominator/);
  assert.equal(hasDiscrepancy(0.05, 0.5, 5), true, 'Sub-kilogram batches must use their real weight, not a 1 kg floor.');
  assert.equal(hasDiscrepancy(0, 10, 0), false);
});

test('pagination reaches every row and clamps short or empty result sets', () => {
  assert.deepEqual(paginationWindow(23, 3, 10), { page: 3, pages: 3, size: 10, start: 20, end: 23, total: 23 });
  assert.equal(paginationWindow(4, 9, 10).page, 1);
  assert.equal(paginationWindow(0, 4, 10).end, 0);
  assert.equal(paginationWindow(100, 2, 25).start, 25);
});

test('listing filters compose with trimmed search, evidence state, pathway, and record type', async () => {
  const { listings } = await createSeedData();
  const result = filterListings(listings, '  cotton ', { ...emptyListingFilters, status: 'Open', region: 'Metro Manila', textileType: 'Cotton', circularPathway: 'Recycling', weightStatus: 'Measured', wasteSource: 'Pre-consumer', recordType: 'Demo' });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'LST-2609-001');
  assert.equal(filterListings(listings, '', { ...emptyListingFilters, recordType: 'Operational' }).length, 0);
});

test('untransferred batches remain in diversion denominators; outputs and percentages reconcile', async () => {
  const seed = await createSeedData();
  const store = new MemoryStore(seed);
  const data = await buildDashboardAnalytics(store, seed.users[0], historicalQuery, undefined, asOf);
  assert.equal(data.circularFlow.generatedKg, 575);
  assert.equal(data.operations.metrics.declaredKg, 575);
  assert.equal(data.circularFlow.reusedKg, 89);
  assert.equal(data.impactMetrics.diversionRate, percentage(89, 575));
  assert.equal(data.circularFlow.residualKg + data.circularFlow.reusedKg + data.circularFlow.recycledKg, 575);
  assert.equal(data.wasteTrend.reduce((sum, point) => sum + point.recorded, 0), 575);
  assert.match(data.kpis[0].value, / t$/);
  assert.equal(data.facilities[0].capacityKg, 6480, 'Monthly capacity must be prorated over July 1-Sep 21 (2.7 months).');
  assert.equal(data.facilities[0].utilization, percentage(data.facilities[0].intakeKg, 6480));
  const filtered = await buildDashboardAnalytics(store, seed.users[0], { ...historicalQuery, textileType: 'Cotton' }, undefined, asOf);
  assert.equal(filtered.circularFlow.generatedKg, 320);
  assert.equal(filtered.circularFlow.reusedKg, 0);
  assert.equal(filtered.impactMetrics.diversionRate, 0);
});

test('analytics excludes other years and future batches, keeps all transactions, and does not duplicate facility outcomes', async () => {
  const seed = await createSeedData();
  const batch = seed.materialBatches[3];
  seed.materialBatches.push({ ...batch, id: 'OLD', createdAt: '2025-09-01T00:00:00Z' }, { ...batch, id: 'FUTURE', createdAt: '2026-10-18T00:00:00Z' });
  seed.recoveryRecords.push({ ...seed.recoveryRecords[0], id: 'EXTRA-STAGE', facilityId: 'FAC-002', timestamp: '2026-09-16T00:00:00Z' });
  seed.transfers = Array.from({ length: 120 }, (_, index) => ({ ...seed.transfers[0], id: `TR-${index}`, verifiedWeightKg: 0.5 }));
  const data = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], {}, undefined, asOf);
  assert.equal(data.circularFlow.generatedKg, 575);
  assert.equal(data.transactions.length, 120);
  assert.equal(data.facilities.reduce((sum, facility) => sum + facility.processedKg, 0), 60);
  const empty = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], { textileType: 'Nonexistent' }, undefined, asOf);
  assert.equal(empty.kpis.find(item => item.label === 'Diversion Rate')?.value, 'Not available');
});
