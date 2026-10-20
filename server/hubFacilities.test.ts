import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectHubCohort } from './dashboardAnalytics.js';
import { buildHubFacilityAnalytics } from './hubFacilities.js';
import { buildHubOperations } from './hubOperations.js';

const now = new Date('2026-10-20T04:00:00Z');
const query = { dateRange: 'Custom range', startDate: '2026-09-01', endDate: '2026-09-30' };

test('seven existing registry records are seven Hubs, not two account Hubs or nine combined records', async () => {
  const data = await createSeedData(), admin = data.users[0], template = data.facilities[0];
  data.facilities = Array.from({ length: 7 }, (_, index) => ({ ...template, id: `HUB-REGISTRY-${index}`, status: 'Available' as const }));
  const account = data.users.find(user => user.role === 'Recycler')!;
  data.users = [admin, ...Array.from({ length: 2 }, (_, index) => ({ ...account, id: `HUB-LOGIN-${index}`,
    role: 'BalikTela Hub' as const, scope: { ...account.scope, facilityIds: [] } }))];
  data.listings = []; data.transfers = []; data.measurements = []; data.recoveryRecords = []; data.materialBatches = [];
  const before = structuredClone(data), store = new MemoryStore(data);
  const result = await buildDashboardAnalytics(store, admin, query, undefined, now);
  assert.equal(result.hubFacilities.summary.hubs, 7);
  assert.equal(result.hubFacilities.summary.unassignedOperators, 2);
  assert.deepEqual(result.hubFacilities.rows.map(row => row.id), data.facilities.map(hub => hub.id));
  assert.ok(result.hubFacilities.rows.every(row => row.status === 'No operator assigned' && row.utilization === null));
  assert.equal((await store.all('users')).length, 3, 'Viewing registered Hubs must not create login accounts.');
  assert.deepEqual(data, before, 'Existing identifiers, classifications and history must not be rewritten.');
});

async function fixture() {
  const data = await createSeedData(), admin = data.users[0];
  const site = { ...data.facilities[0], id: 'SITE-HUB-ONE', name: 'Shared Hub site', monthlyCapacityKg: 1000, currentIntakeKg: 99999, status: 'Near capacity' as const };
  const hub = { ...structuredClone(data.users.find(item => item.role === 'Recycler')!), id: 'HUB-OPERATOR-ONE', role: 'BalikTela Hub' as const,
    webHubOperator: true, scope: { ...admin.scope, facilityIds: [site.id] } };
  const batch = { ...data.materialBatches[0], id: 'HUB-BATCH-ONE', createdAt: '2026-09-02T01:00:00Z' };
  const listing = { ...data.listings[0], id: 'HUB-LIST-ONE', batchId: batch.id, weighingHubId: hub.id, deliveryRoute: 'via_hub' as const, createdAt: batch.createdAt };
  data.users = [admin, hub]; data.facilities = [site]; data.materialBatches = [batch]; data.listings = [listing]; data.transfers = [];
  data.recoveryRecords = [];
  data.measurements = [{ ...data.measurements[0], id: 'HUB-RECEIPT-ONE', batchId: batch.id, facilityId: site.id,
    transferId: null, recordedBy: hub.id, canonicalStage: 'collection', stage: 'Receipt', status: 'Measured', weightKg: 100,
    supersedesMeasurementId: null, timestamp: '2026-09-03T01:00:00Z' }];
  const source = await loadDashboardAnalyticsSnapshot(new MemoryStore(data));
  source.hubDisposals = { available: true, records: [{ id: 'DISPOSAL-ONE', listingId: listing.id, operatorId: hub.id,
    listingTitle: listing.title, category: listing.textileType, weightKg: 20, reason: 'Test disposal', disposedAt: '2026-09-04T01:00:00Z' }] };
  return { data, source, admin, hub, site, batch, listing };
}

test('regional Hub counts include all registered Hub records regardless of legacy facility classification', async () => {
  const { data, source, admin, site } = await fixture();
  source.facilities = ['Collection point','Sorting facility','Recycler','Upcycling hub','Repair hub'].map((type, index) => ({ ...site, id: `HUB-TYPE-${index}`, type: type as typeof site.type }));
  const result = await buildDashboardAnalytics(new MemoryStore(data), admin, query, source, now);
  assert.equal(result.hubFacilities.summary.hubs, 5);
  assert.equal(result.regionalActivity.find(row => row.region === site.region)?.collectionPoints, 5);
});

test('Hub facility intake, disposal and balance reconcile with Recovery Monitoring, not legacy processing counters', async () => {
  const { data, source, admin, site, batch } = await fixture(), before = structuredClone(source);
  const result = await buildDashboardAnalytics(new MemoryStore(data), admin, query, source, now);
  const row = result.hubFacilities.rows[0];
  assert.equal(row.id, site.id); assert.equal(row.capacityKg, 1000); assert.equal(row.receivedKg, 100);
  assert.equal(row.utilization, 10); assert.equal(row.remainingCapacityKg, 900); assert.equal(row.status, 'Available');
  assert.equal(row.disposedKg, 20); assert.equal(row.awaitingDisposalKg, 80);
  const operations = buildHubOperations(source, [batch], admin, 'Test', now);
  assert.equal(row.receivedKg, operations.summary.collectedKg); assert.equal(row.disposedKg, operations.summary.disposedKg);
  assert.equal(row.awaitingDisposalKg, operations.summary.awaitingDisposalKg);
  assert.deepEqual(source, before);
});

test('multiple listings and duplicate disposal rows do not duplicate a physical site or its intake', async () => {
  const { source, admin, site, batch, listing } = await fixture();
  source.listings.push({ ...listing, id: 'HUB-LIST-TWO' });
  source.hubDisposals!.records.push({ ...source.hubDisposals!.records[0] });
  source.hubDisposals!.records.push({ ...source.hubDisposals!.records[0], id: 'DISPOSAL-TWO', listingId: 'HUB-LIST-TWO', weightKg: 10 });
  const result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.summary.hubs, 1); assert.equal(result.rows.length, 1); assert.equal(result.rows[0].batches, 1);
  assert.equal(result.rows[0].receivedKg, 100); assert.equal(result.rows[0].disposedKg, 30); assert.equal(result.rows[0].awaitingDisposalKg, 70);
});

test('missing intake and missing operator links cannot become zero utilization or estimated physical collection', async () => {
  const { source, admin, site, batch } = await fixture();
  source.measurements = [];
  let result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.rows[0].receivedKg, null); assert.equal(result.rows[0].utilization, null);
  assert.equal(result.rows[0].status, 'Intake incomplete'); assert.equal(result.rows[0].disposedKg, 20); assert.equal(result.rows[0].awaitingDisposalKg, null);
  source.users[1].scope.facilityIds = [];
  result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.rows[0].status, 'No operator assigned'); assert.equal(result.rows[0].receivedKg, null);
  assert.equal(result.summary.unassignedOperators, 1); assert.equal(result.summary.unattributedBatches, 1); assert.equal(result.summary.unattributedDisposedKg, 20);
});

test('explicit receipt site wins over current assignments; ambiguous multi-site assignments never split weight', async () => {
  const { source, admin, hub, site, batch } = await fixture();
  const other = { ...site, id: 'SITE-HUB-TWO', name: 'Other site' };
  hub.scope.facilityIds = [other.id];
  let result = buildHubFacilityAnalytics(source, [site, other], [batch], admin, 1, now);
  assert.equal(result.rows[0].receivedKg, 100); assert.equal(result.rows[1].receivedKg, 0);
  source.measurements[0].facilityId = null; hub.scope.facilityIds = [site.id, other.id];
  result = buildHubFacilityAnalytics(source, [site, other], [batch], admin, 1, now);
  assert.equal(result.summary.unattributedReceivedKg, 100); assert.equal(result.summary.unattributedDisposedKg, 20);
  assert.equal(result.summary.unattributedBatches, 1);
  assert.equal(result.rows.reduce((sum, row) => sum + (row.receivedKg ?? 0), 0), 0);
  assert.ok(result.rows.every(row => row.utilization === null && row.status === 'Intake incomplete'));
});

test('Hub facility filters select receipt and operator-assigned batches without requiring processing records', async () => {
  const { data, source, admin, site, batch } = await fixture();
  source.measurements[0].facilityId = null;
  const result = await buildDashboardAnalytics(new MemoryStore(data), admin, { ...query, facilityId: site.id }, source, now);
  assert.equal(result.hubFacilities.rows[0].receivedKg, 100);
  const cohort = selectHubCohort(source, admin, { ...query, facilityId: site.id }, now);
  assert.deepEqual(cohort.batches.map(item => item.id), [batch.id]);
  assert.equal(buildHubOperations(source, cohort.batches, admin, 'Test', now).summary.disposedKg, result.hubFacilities.rows[0].disposedKg);
});

test('Hub-only scope and aggregate regional privacy apply to the same physical registry', async () => {
  const { data, source, admin, site, hub } = await fixture();
  source.facilities.push({ ...site, id: 'PRIVATE-SITE', name: 'Unrelated private site', region: 'Davao Region' });
  let result = await buildDashboardAnalytics(new MemoryStore(data), hub, query, source, now);
  assert.deepEqual(result.hubFacilities.rows.map(row => row.id), [site.id]);
  const government = { ...admin, role: 'Government' as const, scope: { ...admin.scope, aggregateOnly: true, regions: [site.region] } };
  result = await buildDashboardAnalytics(new MemoryStore(data), government, query, source, now);
  assert.equal(result.hubFacilities.aggregateOnly, true); assert.equal(result.hubFacilities.rows.length, 1);
  const text = JSON.stringify(result.hubFacilities);
  for (const secret of [site.id, site.name, hub.id, hub.email, 'PRIVATE-SITE']) assert.ok(!text.includes(secret));
  assert.equal(result.hubFacilities.rows[0].receivedKg, 100); assert.equal(result.hubFacilities.rows[0].utilization, 10);
});

test('shared operators do not duplicate site capacity; zero capacity and overdrawn balances stay explicit', async () => {
  const { source, admin, site, hub, batch } = await fixture();
  source.users.push({ ...hub, id: 'HUB-OPERATOR-TWO', scope: { ...hub.scope, facilityIds: [site.id] } });
  let result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.rows[0].operators, 2); assert.equal(result.rows[0].capacityKg, 1000); assert.equal(result.rows[0].receivedKg, 100);
  site.monthlyCapacityKg = 0;
  result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.rows[0].utilization, null); assert.equal(result.rows[0].status, 'Capacity not configured');
  site.monthlyCapacityKg = 1000; source.hubDisposals!.records[0].weightKg = 110;
  result = buildHubFacilityAnalytics(source, [site], [batch], admin, 1, now);
  assert.equal(result.rows[0].disposedKg, 110); assert.equal(result.rows[0].awaitingDisposalKg, null);
});
