import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore, type DashboardSourceSnapshot } from './store.js';
import type { HubDisposalRecord } from '../shared/hubs.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildHubOperations } from './hubOperations.js';
import { buildHubDisposalMonitoring } from './hubs.js';

const now = new Date('2026-10-20T04:00:00Z');
async function fixture() {
  const data = await createSeedData(), admin = data.users[0], operator = data.users.find(item => item.role === 'Recycler')!;
  const hub = { ...structuredClone(operator), id: 'BALANCE-HUB', role: 'BalikTela Hub' as const, organizationVerified: true };
  const batch = { ...data.materialBatches[0], id: 'BALANCE-BATCH', createdAt: '2026-10-01T01:00:00Z' };
  const listing = { ...data.listings[0], id: 'BALANCE-LISTING', batchId: batch.id, weighingHubId: hub.id,
    deliveryRoute: 'via_hub' as const, createdAt: batch.createdAt, availableWeightKg: 9999 };
  const receipt = { ...data.measurements[0], id: 'INTAKE', batchId: batch.id, transferId: null,
    canonicalStage: 'collection' as const, stage: 'Receipt' as const, recordedBy: hub.id, weightKg: 100, status: 'Measured' as const,
    timestamp: '2026-10-02T01:00:00Z', supersedesMeasurementId: null };
  const disposal = { id: 'DISPOSAL', listingId: listing.id, operatorId: hub.id, listingTitle: listing.title, category: batch.materialCategory,
    weightKg: 20, reason: 'Disposal record', disposedAt: '2026-10-03T01:00:00Z' };
  const store = new MemoryStore(data), source: DashboardSourceSnapshot & { hubDisposals: { available: boolean; records: HubDisposalRecord[] } } = { ...await loadDashboardAnalyticsSnapshot(store), users: [...data.users, hub],
    allBatches: [batch], listings: [listing], measurements: [receipt], allTransfers: [], recoveryRecords: [],
    hubDisposals: { available: true, records: [disposal] } };
  const calculate = () => buildHubOperations(source, source.allBatches, admin, 'Fixture cohort', now);
  return { data, admin, hub, batch, listing, receipt, disposal, store, source, calculate };
}

test('Hub awaiting disposal reconciles intake, partial disposal and measured outflow once, never listing stock or reservations', async () => {
  const { data, hub, receipt, disposal, source, calculate } = await fixture();
  source.hubDisposals.records.push({ ...disposal }, { ...disposal, id: 'SECOND-DISPOSAL', weightKg: 10 });
  source.listings.push({ ...source.listings[0], id: 'SECOND-LISTING', reservedKg: 999 });
  const transfer = { ...data.transfers[0], id: 'OUT', batchId: receipt.batchId, listingId: source.listings[0].id, providerId: hub.id,
    recipientId: data.users[0].id, status: 'Completed' as const, handoverWeightKg: 25, agreedWeightKg: 5000,
    events: [], updatedAt: '2026-10-04T01:00:00Z' };
  source.allTransfers = [transfer, { ...transfer }];
  const result = calculate();
  assert.equal(result.summary.collectedKg, 100); assert.equal(result.summary.disposedKg, 30);
  assert.equal(result.summary.awaitingDisposalKg, 45); assert.equal(result.summary.batches, 1);
  assert.equal(result.summary.balancedBatches, 1);
  assert.deepEqual(result.records.map(item => item.awaitingDisposalKg).sort(), [45, null].sort());
  assert.equal(result.regions[0].awaitingDisposalKg, 45);
  assert.equal(result.records.find(item => item.balanceStatus === 'Reconciled')?.transferredOutKg, 25);
});

test('missing intake remains unknown even when disposal and zero listing stock exist', async () => {
  const { source, calculate } = await fixture(); source.measurements = []; source.listings[0].availableWeightKg = 0;
  const result = calculate(); assert.equal(result.summary.collectedKg, null);
  assert.equal(result.summary.disposedKg, 20); assert.equal(result.summary.awaitingDisposalKg, null);
  assert.equal(result.summary.missingIntakeBatches, 1); assert.equal(result.records[0].balanceStatus, 'Intake not recorded');
});

test('partial intake coverage cannot masquerade as a complete awaiting-disposal total', async () => {
  const { source, batch, listing, calculate } = await fixture();
  source.allBatches.push({ ...batch, id: 'NO-RECEIPT' });
  source.listings.push({ ...listing, id: 'NO-RECEIPT-LISTING', batchId: 'NO-RECEIPT' });
  const result = calculate(); assert.equal(result.summary.collectedKg, 100);
  assert.equal(result.summary.missingIntakeBatches, 1); assert.equal(result.summary.balancedBatches, 1);
  assert.equal(result.summary.awaitingDisposalKg, null);
  assert.equal(result.records.find(item => item.batchId === batch.id)?.awaitingDisposalKg, 80);
});

test('unavailable, invalid, overdrawn and chronologically conflicting disposal evidence withholds balances', async () => {
  const { source, disposal, calculate } = await fixture();
  source.hubDisposals.available = false; assert.equal(calculate().summary.awaitingDisposalKg, null);
  source.hubDisposals.available = true;
  for (const record of [{ ...disposal, weightKg: -1 }, { ...disposal, weightKg: 101 }, { ...disposal, disposedAt: '2026-10-01T02:00:00Z' }]) {
    source.hubDisposals.records = [record];
    assert.equal(calculate().summary.awaitingDisposalKg, null);
  }
  source.hubDisposals.records = [{ ...disposal, disposedAt: '2026-10-21T01:00:00Z' }];
  assert.equal(calculate().summary.awaitingDisposalKg, 100, 'Future disposal is not yet an outflow.');
  source.hubDisposals.records = [{ ...disposal, weightKg: 100 }];
  assert.equal(calculate().summary.awaitingDisposalKg, 0, 'A reconciled empty Hub balance is a real zero.');
});

test('Hub outflow requires measured evidence, applies corrections, and refuses ambiguous transfer movements', async () => {
  const { data, source, hub, receipt, calculate } = await fixture();
  const transfer = { ...data.transfers[0], id: 'MOVE', batchId: receipt.batchId, recipientId: data.users[0].id, providerId: data.users[1].id,
    status: 'Completed' as const, events: [], updatedAt: '2026-10-04T01:00:00Z' };
  source.allTransfers = [transfer];
  assert.equal(calculate().summary.awaitingDisposalKg, null, 'A completed flag does not establish Hub outflow.');
  const reading = { ...receipt, id: 'OUTFLOW', transferId: transfer.id, stage: 'Handover' as const, canonicalStage: 'handover' as const,
    weightKg: 10, timestamp: '2026-10-04T01:00:00Z' };
  source.measurements.push(reading);
  assert.equal(calculate().summary.awaitingDisposalKg, 70);
  source.measurements.push({ ...reading, id: 'CORRECTED-OUTFLOW', weightKg: 15, supersedesMeasurementId: reading.id });
  assert.equal(calculate().summary.awaitingDisposalKg, 65);
  source.measurements.push({ ...receipt, id: 'LATER-RECEIPT-CORRECTION', timestamp: '2026-10-05T01:00:00Z', supersedesMeasurementId: receipt.id });
  assert.equal(calculate().summary.awaitingDisposalKg, null, 'A later intake correction cannot silently erase earlier outflows.');
  source.measurements.pop();
  source.allTransfers[0] = { ...transfer, status: 'Cancelled' };
  assert.equal(calculate().summary.awaitingDisposalKg, null, 'A cancellation after handover needs return evidence.');
  source.allTransfers[0] = { ...transfer, recipientId: hub.id };
  assert.equal(calculate().summary.awaitingDisposalKg, 80, 'An incoming transfer is not an additional outflow.');
});

test('Overview, Hub operations and disposal ledger share the same balance, filters and Hub privacy', async () => {
  const { source, batch, admin, hub, store } = await fixture(), original = structuredClone(source);
  const query = { dateRange: 'Last 3 calendar months' };
  const analytics = await buildDashboardAnalytics(store, admin, query, source, now);
  const ledger = await buildHubDisposalMonitoring(store, admin, query, now, source);
  assert.deepEqual(ledger.handling, analytics.hubOperations);
  assert.equal(ledger.handling?.awaitingDisposalKg, 80);
  const aggregate = buildHubOperations(source, [batch], { ...admin, role: 'Government' }, 'Fixture', now);
  assert.deepEqual(aggregate.records, []); assert.equal(aggregate.regions[0].awaitingDisposalKg, 80);
  assert.equal(buildHubOperations(source, [batch], { ...hub, id: 'OTHER-HUB' }, 'Fixture', now).summary.batches, 0);
  assert.equal((await buildHubDisposalMonitoring(store, admin, { ...query, region: 'No matching region' }, now, source)).handling?.awaitingDisposalKg, 0);
  assert.deepEqual(source, original, 'Reading balances must never modify mobile or shared records.');
});
