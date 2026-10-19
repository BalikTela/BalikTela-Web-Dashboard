import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildHubDirectory, buildWeighingMonitoring, eligibleForWeighing, registerHubRoutes } from './hubs.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import { hasPermission } from './access-control.js';
import { issueToken } from './auth.js';
import { canonicalMutations } from './database/mutations.js';
import { decodeRecord, encodeRecord } from './database/codecs.js';
import { isApprovedHub } from '../shared/hubs.js';
import type { UserRecord } from './types.js';

async function fixture() {
  const data = await createSeedData();
  const admin = data.users[0];
  const approved = data.users.find(item => item.role === 'Recycler')!;
  approved.organizationVerified = true;
  approved.scope.facilityIds = ['FAC-001'];
  const pending = { ...structuredClone(approved), id: 'HUB-PENDING', fullName: 'Pending Hub (demo)', email: 'pending-hub@fixture.invalid', organizationVerified: false, verification: 'Pending demo review' as const };
  const legacy = { ...structuredClone(pending), id: 'HUB-LEGACY', role: 'BalikTela Hub' as const };
  data.users.push(pending, legacy);
  const batch = { ...data.materialBatches[0], id: 'HUB-BATCH', declaredWeightKg: null, currentWeightKg: null, weightStatus: null, createdAt: '2026-10-15T01:00:00Z', updatedAt: '2026-10-15T01:00:00Z' };
  data.materialBatches.push(batch);
  data.listings.push({ ...data.listings[0], id: 'HUB-LISTING', batchId: batch.id, quantityKg: null, availableWeightKg: null, weightStatus: null, weighingHubId: pending.id, deliveryRoute: 'via_hub', reservedKg: 0, status: 'Open', createdAt: batch.createdAt });
  return { data, admin, approved, pending, legacy, batch, store: new MemoryStore(data) };
}
const allTime = { dateRange: 'All time' };
const now = new Date('2026-10-18T04:00:00Z');

test('Hub mappings preserve unknown mass, route IDs and canonical measurement provenance', async () => {
  const { data, pending } = await fixture();
  const listing = data.listings.at(-1)!;
  const row = { ...encodeRecord('listings', listing), available_weight_kg: null, weight_kg: null, weight_status: null };
  const decoded = decodeRecord('listings', row);
  assert.equal(decoded.quantityKg, null);
  assert.equal(decodeRecord('listings', { ...row, available_weight_kg: 0 }).quantityKg, null);
  assert.equal(decoded.weightStatus, null);
  assert.equal(decoded.weighingHubId, pending.id);
  assert.equal(decoded.deliveryRoute, 'via_hub');
  const measurement = decodeRecord('measurements', { _id: 'HUB-MSR', batch_id: listing.batchId, stage: 'listing', weight_kg: 12.5, weight_status: 'Verified', method: 'Collecting Hub scale', measurement_context: 'Scale S-01, dry textiles', recorded_by: pending.id, verified_by: pending.id, measured_at: now, facility_id: 'FAC-001', supersedes_measurement_id: 'OLDER' });
  assert.equal(measurement.canonicalStage, 'listing');
  assert.equal(measurement.note, 'Scale S-01, dry textiles');
  for (const status of ['draft', 'archived', 'closed']) {
    const mapped = decodeRecord('listings', { ...row, status });
    assert.equal(mapped.canonicalStatus, status);
    assert.equal(eligibleForWeighing(mapped), status !== 'closed');
  }
  assert.equal(encodeRecord('measurements', measurement).stage, 'listing');
  assert.equal(encodeRecord('measurements', measurement).facility_id, 'FAC-001');
  assert.equal(encodeRecord('measurements', measurement).supersedes_measurement_id, 'OLDER');
  const before = { ...data.users[0], organizationVerified: true };
  const writes = canonicalMutations([{ name: 'users', previous: before, record: { ...before, accountStatus: 'Suspended' } }]);
  assert.equal(writes[0].values.organization_verified, false);
});

test('Hub permissions fail closed for legacy and unknown roles and never grant approval to operators', async () => {
  const { admin, approved, pending, legacy } = await fixture();
  assert.equal(isApprovedHub(approved), true);
  assert.equal(isApprovedHub(pending), false);
  assert.equal(isApprovedHub({ ...approved, organizationVerified: undefined }), false);
  assert.equal(isApprovedHub(legacy), false);
  assert.equal(isApprovedHub({ ...approved, accountStatus: 'Suspended' }), false);
  assert.equal(hasPermission(admin, 'hubs.manage'), true);
  assert.equal(hasPermission(approved, 'hubs.manage'), false);
  assert.equal(hasPermission(legacy, 'analytics.read'), false);
  assert.equal(hasPermission({ ...admin, role: 'Unknown role' as UserRecord['role'] }, 'analytics.read'), false);
});

test('Hub monitoring separates queue, latest measurement and completed recovery mass', async () => {
  const { data, store, admin, approved, batch } = await fixture();
  const before = await buildDashboardAnalytics(store, admin, allTime, undefined, now);
  const original = await buildWeighingMonitoring(store, admin, allTime, now);
  assert.equal(original.summary.awaiting, 1);
  assert.equal(original.tasks.find(item => item.batchId === batch.id)?.quantityKg, null);
  const base = data.measurements[0];
  data.measurements.push({ ...base, id: 'HUB-MSR-OLD', batchId: batch.id, transferId: null, canonicalStage: 'listing', weightKg: 100, recordedBy: approved.id, status: 'Measured', timestamp: '2026-10-16T01:00:00Z' },
    { ...base, id: 'HUB-MSR-NEW', batchId: batch.id, transferId: null, canonicalStage: 'listing', weightKg: 95, recordedBy: approved.id, verifiedBy: approved.id, status: 'Verified', supersedesMeasurementId: 'HUB-MSR-OLD', timestamp: '2026-10-17T01:00:00Z' });
  const result = await buildWeighingMonitoring(store, admin, allTime, now);
  assert.equal(result.summary.measurements, 2);
  assert.equal(result.summary.latestWeighedKg, 95);
  assert.equal(result.summary.verifiedBatches, 1);
  assert.equal(result.history.find(item => item.id === 'HUB-MSR-OLD')?.current, false);
  assert.equal(result.history.find(item => item.id === 'HUB-MSR-NEW')?.current, true);
  data.measurements.push({ ...data.measurements.at(-1)!, id: 'FUTURE-MSR', supersedesMeasurementId: 'HUB-MSR-NEW', timestamp: '2026-10-20T01:00:00Z' });
  assert.equal((await buildWeighingMonitoring(store, admin, allTime, now)).summary.latestWeighedKg, 95);
  data.listings.push({ ...data.listings.at(-1)!, id: 'DIRECT-LISTING', deliveryRoute: 'direct', weighingHubId: null, batchId: data.materialBatches[0].id });
  assert.ok(!(await buildWeighingMonitoring(store, admin, allTime, now)).tasks.some(item => item.id === 'DIRECT-LISTING'));
  const after = await buildDashboardAnalytics(store, admin, allTime, undefined, now);
  assert.deepEqual(after.circularFlow, before.circularFlow);
  assert.equal(after.impactMetrics.estimatedCo2eKg, null);
  assert.match(after.metadata.denominatorNote, /1 batches have no declared weight/);
  // Mirror mobile's batch/listing update after scale evidence is recorded.
  await store.update('materialBatches', batch.id, { declaredWeightKg: 95, currentWeightKg: 95, weightStatus: 'Verified' });
  await store.update('listings', 'HUB-LISTING', { quantityKg: 95, availableWeightKg: 95, weightStatus: 'Verified' });
  const weighed = await buildDashboardAnalytics(store, admin, allTime, undefined, now);
  assert.equal(weighed.circularFlow.generatedKg, before.circularFlow.generatedKg + 95);
  assert.equal(weighed.circularFlow.collectedKg, before.circularFlow.collectedKg);
  assert.equal(weighed.circularFlow.recycledKg, before.circularFlow.recycledKg);
  assert.equal(weighed.circularFlow.reusedKg, before.circularFlow.reusedKg);
  const listing = data.listings.at(-1)!;
  for (const changed of [{ reservedKg: 1 }, { disposedAt: now.toISOString() }, { remainderPending: true }, { status: 'Reserved' as const }]) assert.equal(eligibleForWeighing({ ...listing, ...changed }), false);
});

test('government and research region scopes withhold Hub identities and weighing details', async () => {
  const { data, store, admin } = await fixture();
  const government = { ...admin, role: 'Government' as const, scope: { ...admin.scope, aggregateOnly: false, regions: ['Davao Region'] } };
  const directory = await buildHubDirectory(store, government);
  assert.deepEqual(directory.hubs, []);
  assert.equal(directory.summary.operators, 0);
  assert.equal((await buildHubDirectory(store, admin, { region: 'Davao Region' })).summary.operators, 0);
  const monitoring = await buildWeighingMonitoring(store, government, allTime, now);
  assert.deepEqual(monitoring.tasks, []);
  assert.deepEqual(monitoring.history, []);
  assert.equal(monitoring.summary.awaiting, 0);
  const producer = data.users.find(item => item.role === 'Producer')!;
  producer.scope.organizationIds = [];
  producer.organizationId = null;
  const outOfScope = { ...data.materialBatches[0], id: 'PRIVATE-BATCH', sourceUserId: 'PRIVATE-OWNER', sourceOrganizationId: 'PRIVATE-ORG', currentCustodianId: 'PRIVATE-OWNER' };
  data.materialBatches.push(outOfScope);
  data.listings.push({ ...data.listings.at(-1)!, id: 'PRIVATE-LISTING', batchId: outOfScope.id });
  const scoped = await buildWeighingMonitoring(store, producer, allTime, now);
  assert.ok(scoped.tasks.every(item => item.batchId !== outOfScope.id));
});

test('Hub approval API enforces administrator authority, account readiness, assignment and session revocation', async () => {
  const { store, admin, pending, approved } = await fixture();
  const app = express(); app.use(express.json()); registerHubRoutes(app, store);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const tokens = new Map<string, string>();
  for (const user of [admin, pending, approved]) {
    const id = `SESSION-${user.id}`;
    await store.createSession({ id, userId: user.id, client: 'api', tokenHash: 'fixture', usedTokenHashes: [], csrfHash: 'fixture', expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    tokens.set(user.id, issueToken(user.id, user.role, id));
  }
  const send = async (body: Record<string, unknown>, actor = admin) => fetch(`http://127.0.0.1:${address.port}/api/hubs/${pending.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${tokens.get(actor.id)}` }, body: JSON.stringify(body) });
  try {
    assert.equal((await send({ action: 'approve', reason: 'Forbidden' }, approved)).status, 403);
    assert.equal((await send({ action: 'approve', reason: '' })).status, 400);
    assert.equal((await send({ action: 'approve', reason: 'Invalid facility', facilityIds: ['missing'] })).status, 400);
    await store.update('users', pending.id, { emailVerifiedAt: null });
    assert.equal((await send({ action: 'approve', reason: 'Not ready' })).status, 409);
    await store.update('users', pending.id, { emailVerifiedAt: now.toISOString() });
    const response = await send({ action: 'approve', reason: 'Reviewed operator identity and scale', facilityIds: ['FAC-001'] });
    assert.equal(response.status, 200);
    assert.equal((await store.findById('users', pending.id))?.role, 'Recycler');
    assert.equal((await store.findById('users', pending.id))?.organizationVerified, true);
    assert.ok((await store.findSession(`SESSION-${pending.id}`))?.revokedAt);
    assert.equal((await send({ action: 'revoke', reason: 'Approval withdrawn' })).status, 200);
    const revoked = await store.findById('users', pending.id);
    assert.equal(revoked?.organizationVerified, false);
    assert.equal(revoked?.accountStatus, 'Active');
    assert.ok((await store.all('auditRecords')).some(item => item.action === 'hub.revoke'));
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
