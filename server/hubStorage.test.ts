import assert from 'node:assert/strict';
import test from 'node:test';
import { hubStorageCapacity, illustrativeStorageCapacityKg, storageAvailability } from '../shared/hubStorage.js';
import { buildHubStorageAnalytics } from './hubStorage.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';

const now = new Date('2026-10-21T04:00:00Z');
async function fixture() {
  const data = await createSeedData(), admin = data.users[0];
  const site = { ...data.facilities[0], id: 'STORAGE-ONE', monthlyCapacityKg: 999999, status: 'Available' as const };
  const hub = { ...data.users.find(item => item.role === 'Recycler')!, id: 'STORAGE-OPERATOR', role: 'BalikTela Hub' as const,
    webHubOperator: true, accountStatus: 'Active' as const, organizationVerified: true, canonicalVerification: 'verified',
    scope: { ...admin.scope, facilityIds: [site.id] } };
  const consumer = { ...data.users.find(item => item.role === 'Consumer')!, id: 'STORAGE-CONSUMER' };
  const batch = { ...data.materialBatches[0], id: 'STORAGE-BATCH', sourceUserId: consumer.id, declaredWeightKg: 900,
    createdAt: '2026-08-01T00:00:00Z' };
  const listing = { ...data.listings[0], id: 'STORAGE-LISTING', ownerId: consumer.id, batchId: batch.id, weighingHubId: hub.id,
    deliveryRoute: 'via_hub' as const, status: 'Open' as const, canonicalStatus: 'available', createdAt: batch.createdAt };
  data.users = [admin, hub, consumer]; data.facilities = [site]; data.materialBatches = [batch]; data.listings = [listing];
  data.transfers = []; data.recoveryRecords = [];
  data.measurements = [{ ...data.measurements[0], id: 'STORAGE-RECEIPT', batchId: batch.id, transferId: null,
    facilityId: site.id, recordedBy: hub.id, canonicalStage: 'collection', stage: 'Receipt', status: 'Measured', weightKg: 900,
    timestamp: '2026-08-02T00:00:00Z', supersedesMeasurementId: null }];
  const source = await loadDashboardAnalyticsSnapshot(new MemoryStore(data));
  source.hubDisposals = { available: true, records: [] };
  const view = (actor = admin) => buildHubStorageAnalytics(source, source.facilities, actor, now);
  const dispose = (weightKg: number) => source.hubDisposals!.records.push({ id: `DISPOSE-${weightKg}`, listingId: listing.id,
    operatorId: hub.id, listingTitle: listing.title, category: listing.textileType, weightKg, reason: 'Storage test disposal',
    disposedAt: '2026-10-20T00:00:00Z' });
  return { data, source, admin, site, hub, consumer, batch, listing, view, dispose };
}

test('storage threshold uses exact kilograms, preserves true utilization and respects operating overrides', () => {
  assert.equal(illustrativeStorageCapacityKg('STORAGE-ONE'), 1000);
  assert.equal(illustrativeStorageCapacityKg('__proto__'), 1000);
  for (const held of [0, 899.9]) assert.equal(storageAvailability(1000, held, 0, 'Available', true).status, 'Available');
  for (const held of [900, 1000, 1500]) assert.equal(storageAvailability(1000, held, 0, 'Available', true).status, 'Intake paused');
  assert.equal(storageAvailability(1000, 1500, 0, 'Available', true).utilization, 150, 'Do not hide existing overfilled data.');
  assert.equal(storageAvailability(1000, 899.9, 0, 'Available', true).utilization, 90);
  assert.equal(storageAvailability(1000, 800, 100, 'Available', true).selectable, false);
  for (const status of ['Maintenance','Inactive','Pilot onboarding']) assert.equal(storageAvailability(1000, 0, 0, status, true).status, status);
  assert.equal(storageAvailability(1000, 0, 0, 'Available', false).status, 'No approved operator');
  for (const held of [null, NaN, -1]) assert.equal(storageAvailability(1000, held, 0, 'Available', true).selectable, false);
});

test('configured storage overrides illustration; monthly throughput never supplies physical capacity', async () => {
  const { source, view, dispose } = await fixture();
  source.facilities[0].storageCapacityKg = 2000;
  source.facilities[0].currentIntakeKg = 999999;
  let row = view().rows[0];
  assert.equal(row.capacityKg,2000); assert.equal(row.capacitySource,'Configured');
  assert.equal(row.storedKg,900);assert.equal(row.utilization,45);assert.equal(row.availableToReceiveKg,900);
  assert.equal(view().illustrativeCapacity,false);
  source.facilities[0].storageCapacityKg = 1000;
  row = view().rows[0];assert.equal(row.status,'Intake paused');assert.equal(row.allocatedPercent,90);
  dispose(900);
  row = view().rows[0];assert.equal(row.status,'Available');assert.equal(row.utilization,0);assert.equal(row.capacityKg,1000);
  source.facilities[0].isDemo = false;source.facilities[0].storageCapacityKg = null;
  row = view().rows[0];assert.equal(row.capacityKg,0);assert.equal(row.capacitySource,'Not configured');
  assert.equal(row.status,'Capacity not configured');assert.equal(row.selectable,false);assert.equal(row.utilization,null);
  assert.equal(hubStorageCapacity({id:'FAC-001',isDemo:false}).capacityKg,0,'Real Hubs never inherit an illustrative limit.');
  assert.equal(hubStorageCapacity({id:'FAC-001',isDemo:true,storageCapacityKg:3000}).capacityKg,3000);
});

test('unique partial and complete disposal automatically reopen stock, without resetting intake history', async () => {
  const { source, view, dispose } = await fixture();
  let row = view().rows[0];
  assert.equal(row.storedKg, 900); assert.equal(row.utilization, 90); assert.equal(row.status, 'Intake paused');
  dispose(400);
  source.hubDisposals!.records.push({ ...source.hubDisposals!.records[0] });
  row = view().rows[0];
  assert.equal(row.storedKg, 500); assert.equal(row.utilization, 50); assert.equal(row.status, 'Available');
  assert.equal(row.availableToReceiveKg, 400); assert.equal(row.disposedKg, 400);
  dispose(500);
  row = view().rows[0];
  assert.equal(row.storedKg, 0); assert.equal(row.utilization, 0); assert.equal(row.status, 'Available');
  assert.equal(source.measurements[0].weightKg, 900);
  assert.equal(view().illustrativeCapacity, true);
});

test('pending consumer routing reserves one declaration per batch and receipt replaces, not adds to, reservation', async () => {
  const { source, listing, view } = await fixture();
  const measurement = source.measurements[0]; source.measurements = [];
  source.listings.push({ ...listing, id: 'DUPLICATE-ASSIGNMENT' });
  let row = view().rows[0];
  assert.equal(row.storedKg, 0); assert.equal(row.reservedKg, 900); assert.equal(row.status, 'Intake paused');
  source.measurements.push(measurement); row = view().rows[0];
  assert.equal(row.storedKg, 900); assert.equal(row.reservedKg, 0); assert.equal(row.allocatedPercent, 90);
  source.measurements = []; source.allBatches[0].declaredWeightKg = null;
  assert.equal(view().rows[0].reservedKg, null); assert.equal(view().rows[0].selectable, false);
});

test('missing intake, invalid or excessive disposal and unavailable feeds never manufacture zero stock', async () => {
  const { source, view, dispose } = await fixture();
  dispose(1000);
  assert.equal(view().rows[0].storedKg, null); assert.equal(view().rows[0].selectable, false);
  source.measurements = [];
  assert.equal(view().rows[0].storedKg, null);
  source.hubDisposals!.records[0].weightKg = -1;
  assert.equal(view().rows[0].storedKg, null);
  source.hubDisposals = { available: false, records: [] };
  assert.equal(view().rows[0].storedKg, null);
});

test('a supported outbound handover releases stock once, without treating recovery output as disposal', async () => {
  const { data, source, hub, view, dispose } = await fixture();
  const template = (await createSeedData()).transfers[0];
  dispose(100);
  source.allTransfers = [{ ...template, id: 'STORAGE-OUTBOUND', batchId: data.materialBatches[0].id,
    providerId: hub.id, recipientId: 'OTHER-RECIPIENT', status: 'Completed', handoverWeightKg: 300,
    updatedAt: '2026-10-20T02:00:00Z', events: [] }];
  const row = view().rows[0];
  assert.equal(row.storedKg, 500); assert.equal(row.disposedKg, 100); assert.equal(row.utilization, 50);
});

test('storage includes old and archived material regardless of date, material or stakeholder filters', async () => {
  const { data, source, admin } = await fixture();
  source.allBatches[0].currentStatus = 'Archived';
  const before = structuredClone(source);
  for (const query of [{}, {dateRange:'Custom range',startDate:'2026-10-01',endDate:'2026-10-21'},
    {dateRange:'Custom range',startDate:'2026-09-01',endDate:'2026-09-30',textileType:'Denim',stakeholderType:'Producer'}]) {
    const result = await buildDashboardAnalytics(new MemoryStore(data), admin, query, source, now);
    assert.equal(result.hubStorage.rows[0].storedKg, 900);
    assert.equal(result.hubStorage.rows[0].capacityKg, 1000);
    assert.equal(result.hubStorage.rows[0].status, 'Intake paused');
  }
  assert.deepEqual(source, before);
});

test('site totals include coworkers and preserve aggregate privacy and ambiguous-site safeguards', async () => {
  const { source, site, hub, admin, view } = await fixture();
  const coworker = { ...hub, id: 'STORAGE-COWORKER' }; source.users.push(coworker);
  source.measurements[0].recordedBy = coworker.id;
  source.listings[0].weighingHubId = coworker.id;
  assert.equal(view(hub).rows[0].storedKg, 900, 'A coworker must not make the same Hub look empty.');
  const government = { ...admin, role: 'Government' as const, scope: { ...admin.scope, aggregateOnly: true } };
  const aggregate = view(government);
  assert.equal(aggregate.rows[0].storedKg, 900); assert.equal(aggregate.rows[0].selectable, false);
  for (const value of [site.id, site.name, hub.id, coworker.id]) assert.ok(!JSON.stringify(aggregate).includes(value));
  source.measurements[0].facilityId = null;
  coworker.scope = { ...coworker.scope, facilityIds: [site.id, 'OTHER-SITE'] };
  assert.equal(view().rows[0].storedKg, null); assert.equal(view().summary.unattributedBatches, 1);
});
