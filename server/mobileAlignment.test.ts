import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeRecord, encodeFlowEvent, encodeRecord } from './database/codecs.js';
import { canonicalMutations } from './database/mutations.js';
import { BATCH_STATUSES, LISTING_STATUSES, OFFER_STATUSES, TRANSFER_STATUSES, availableStockKg } from '../shared/workflows.js';
import { isApprovedHub } from '../shared/hubs.js';
import { hasPermission, scopeBatches, scopeTransfers } from './access-control.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { buildHubDirectory, buildWeighingMonitoring, eligibleForWeighing } from './hubs.js';

const at = '2026-10-17T01:00:00.000Z';
const base = { _id: 'FIXTURE', created_at: at, updated_at: at, requested_kg: 10, agreed_weight_kg: 10 };

test('every native mobile lifecycle status round-trips without rewriting drafts, revisions or closures', () => {
  for (const [collection, labels] of [['listings', LISTING_STATUSES], ['offers', OFFER_STATUSES], ['transfers', TRANSFER_STATUSES]] as const) {
    for (const [status, label] of Object.entries(labels)) {
      const document = { ...base, status };
      const record = decodeRecord(collection, document);
      assert.equal(record.status, label);
      assert.equal(encodeRecord(collection, record as never).status, status);
    }
    const unknown = decodeRecord(collection, { ...base, status: 'future_mobile_status' });
    assert.equal(unknown.status, 'Unknown');
    assert.equal(encodeRecord(collection, unknown as never).status, 'future_mobile_status');
  }
});

test('flow-only receipt evidence is visible without turning estimates or processing into verification', () => {
  const record = decodeRecord('transfers', { ...base, status: 'completed', _flow_events: [
    { id: 'FLOW-1', stage: 'receipt', weight_kg: 9, weight_status: 'Estimated', occurred_at: at },
    { id: 'FLOW-2', stage: 'processing', weight_kg: 8, weight_status: 'Measured', occurred_at: at },
  ] });
  assert.equal(record.receiptWeightKg, 9);
  assert.equal(record.verifiedWeightKg, null);
  assert.equal(record.events[1].type, 'Processing');
  const encoded = encodeFlowEvent('T', 'B', 'L', record.events[0], 1);
  assert.equal(encoded.stage, 'receipt');
  assert.equal(encoded.weight_kg, 9);
  assert.equal(encoded.weight_status, 'Estimated');
});

test('native batch processing and receipt states are not relabeled as validation or recovery', () => {
  for (const [current_status, label] of Object.entries(BATCH_STATUSES)) {
    const record = decodeRecord('materialBatches', { ...base, current_status, location: { description: 'Unstructured mobile address' }, weight_status: 'Verified' });
    assert.equal(record.currentStatus, label);
    assert.equal(record.city, '');
    assert.equal(encodeRecord('materialBatches', record).current_status, current_status);
  }
});

test('recovery rejects and processing loss remain separate and survive corrections', () => {
  const record = decodeRecord('recoveryRecords', { ...base, input_kg: 10, output_kg: 7, rejected_kg: 2, loss_kg: 1 });
  assert.equal(record.inputWeightKg, record.outputWeightKg! + record.residualWeightKg! + record.lossWeightKg!);
  assert.equal(encodeRecord('recoveryRecords', record).loss_kg, 1);
  const writes = canonicalMutations([{ name: 'recoveryRecords', previous: record, record: { ...record, note: 'Reviewed' } }]);
  assert.ok(!Object.hasOwn(writes[0].values, 'loss_kg'), 'An unrelated edit must not reset mobile loss.');
});

test('available stock subtracts reservations and a partial disposal locks reweighing', async () => {
  assert.equal(availableStockKg({ quantityKg: 100, availableWeightKg: 60, reservedKg: 20 }), 40);
  assert.equal(availableStockKg({ quantityKg: 100, availableWeightKg: null }), null);
  assert.equal(availableStockKg({ quantityKg: 100, availableWeightKg: 0 }), 0);
  const seed = await createSeedData();
  assert.equal(eligibleForWeighing({ ...seed.listings[0], disposedAt: null, disposedWeightKg: 1 }), false);
});

test('native Hub roles are approval-gated, scoped and never receive administrator permissions', async () => {
  const seed = await createSeedData();
  const hub = { ...seed.users[0], role: 'BalikTela Hub' as const, organizationId: null, organizationVerified: true,
    scope: { organizationIds: [], facilityIds: [], regions: [], canExport: false, aggregateOnly: false } };
  assert.equal(isApprovedHub(hub), true);
  assert.equal(isApprovedHub({ ...hub, organizationVerified: false }), false);
  assert.equal(hasPermission(hub, 'analytics.read'), true);
  assert.equal(hasPermission(hub, 'users.manage'), false);
  assert.equal(hasPermission(hub, 'hubs.manage'), false);
  assert.equal(hasPermission({ ...hub, organizationVerified: false }, 'analytics.read'), false);
  const owned = { ...seed.materialBatches[0], id: 'ASSIGNED-BATCH', sourceUserId: 'OTHER', currentCustodianId: 'OTHER', sourceOrganizationId: null };
  const privateBatch = { ...owned, id: 'OTHER-BATCH' };
  const evidence = { listings: [{ ...seed.listings[0], batchId: owned.id, weighingHubId: hub.id }], measurements: [] };
  assert.deepEqual(scopeBatches(hub, [owned, privateBatch], evidence).map(item => item.id), [owned.id]);
});

test('approved Recycler Hub operators can monitor assigned or personally measured batches without seeing unrelated transfers', async () => {
  const seed = await createSeedData();
  const operator = { ...seed.users[0], id: 'RECYCLER-HUB', role: 'Recycler' as const, organizationId: null, organizationVerified: true,
    scope: { organizationIds: [], facilityIds: [], regions: [], canExport: false, aggregateOnly: false } };
  const assigned = { ...seed.materialBatches[0], id: 'ASSIGNED', sourceUserId: 'OTHER', currentCustodianId: 'OTHER', sourceOrganizationId: null };
  const measured = { ...assigned, id: 'MEASURED' }; const unrelated = { ...assigned, id: 'UNRELATED' };
  const evidence = { listings: [{ ...seed.listings[0], batchId: assigned.id, weighingHubId: operator.id }],
    measurements: [{ ...seed.measurements[0], batchId: measured.id, recordedBy: operator.id }] };
  const transfers = [assigned, measured, unrelated].map(batch => ({ ...seed.transfers[0], id: `T-${batch.id}`, batchId: batch.id, providerId: 'OTHER', recipientId: 'RECIPIENT' }));
  assert.deepEqual(scopeBatches(operator, [assigned, measured, unrelated], evidence).map(row => row.id), ['ASSIGNED', 'MEASURED']);
  assert.deepEqual(scopeTransfers(operator, transfers, evidence).map(row => row.id), ['T-ASSIGNED', 'T-MEASURED']);
  assert.deepEqual(scopeBatches({ ...operator, organizationVerified: false }, [assigned, measured, unrelated], evidence), []);
  assert.deepEqual(scopeTransfers({ ...operator, organizationVerified: false }, transfers, evidence), []);
  assert.deepEqual(scopeTransfers({ ...operator, accountStatus: 'Suspended' }, transfers, evidence), []);
  assert.deepEqual(scopeTransfers({ ...operator, role: 'Producer' }, transfers, evidence), []);
  assert.equal(hasPermission(operator, 'hubs.manage'), false);
});

test('Hub declaration measurements are included once and native roles are not converted or duplicated', async () => {
  const seed = await createSeedData();
  const hub = { ...seed.users[0], id: 'NATIVE-HUB', role: 'BalikTela Hub' as const, organizationVerified: true };
  seed.users.push(hub);
  const batch = { ...seed.materialBatches[0], id: 'DECLARATION-BATCH', createdAt: at, updatedAt: at };
  seed.materialBatches.push(batch);
  seed.measurements.push({ ...seed.measurements[0], id: 'DECLARATION-MEASUREMENT', batchId: batch.id, transferId: null,
    canonicalStage: 'declaration', method: 'Collecting Hub scale', weightKg: 25, recordedBy: hub.id, timestamp: at });
  const store = new MemoryStore(seed);
  const directory = await buildHubDirectory(store, seed.users[0]);
  assert.equal(directory.hubs.filter(item => item.id === hub.id).length, 1);
  assert.equal(directory.hubs.find(item => item.id === hub.id)?.state, 'Approved');
  const result = await buildWeighingMonitoring(store, seed.users[0], { dateRange: 'All time' }, new Date('2026-10-18T00:00:00Z'));
  assert.equal(result.history.filter(item => item.id === 'DECLARATION-MEASUREMENT').length, 1);
  assert.equal((await store.findById('users', hub.id))?.role, 'BalikTela Hub');
});

test('native completed transfers stay visible but do not invent verified diversion or unreversed rewards', async () => {
  const seed = await createSeedData();
  seed.transfers = [{ ...seed.transfers[0], status: 'Completed', canonicalStatus: 'completed', verifiedWeightKg: null, circularOutcome: null }];
  seed.walletEntries = [
    { id: 'EARN', userId: seed.users[0].id, transferId: seed.transfers[0].id, type: 'Earned', credits: 50, description: 'Fixture', createdAt: at },
    { id: 'REVERSE', userId: seed.users[0].id, transferId: seed.transfers[0].id, type: 'Adjustment', credits: -50, description: 'Fixture reversal', createdAt: at },
  ];
  const result = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], { dateRange: 'All time' }, undefined, new Date('2026-10-18T00:00:00Z'));
  assert.equal(result.transactions[0].status, 'Completed');
  assert.match(result.transactions[0].impact, /final recovery evidence assessed separately/);
  assert.equal(result.circularFlow.recycledKg, 0);
  assert.equal(result.circularFlow.reusedKg, 86, 'A separately validated final recovery remains evidence even if the legacy transfer has no validation summary.');
  assert.equal(result.barterMetrics.rewardCredits, 0);
  assert.equal(result.barterMetrics.validated, 0);
  assert.equal(result.sharedActivity.completionAwaitingVerification, 1);
});
