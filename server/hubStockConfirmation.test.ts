import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildHubStorageAnalytics } from './hubStorage.js';
import { createStockConfirmation } from './hubStockConfirmation.js';
import { registerHubStockRoutes } from './hubStockRoutes.js';
import { issueToken } from './auth.js';
import type { HubDisposalRecord } from '../shared/hubs.js';

const countAt = '2026-10-23T01:00:00.000Z', later = new Date('2026-10-23T02:00:00.000Z');
async function fixture() {
  const data = await createSeedData(), admin = data.users[0];
  const site = { ...data.facilities[0], id: 'COUNT-HUB', name: 'Counted Hub', storageCapacityKg: 50000, isDemo: false, status: 'Available' as const };
  const hub = { ...data.users.find(item => item.role === 'Recycler')!, id: 'COUNT-OPERATOR', role: 'BalikTela Hub' as const,
    accountStatus: 'Active' as const, organizationVerified: true, canonicalVerification: 'verified', scope: { ...admin.scope, facilityIds: [site.id] } };
  const consumer = data.users.find(item => item.role === 'Consumer')!;
  const batch = { ...data.materialBatches[0], id: 'COUNT-BATCH', declaredWeightKg: 25000, sourceUserId: consumer.id, createdAt: '2026-10-22T01:00:00Z' };
  const listing = { ...data.listings[0], id: 'COUNT-LISTING', batchId: batch.id, weighingHubId: hub.id, ownerId: consumer.id,
    deliveryRoute: 'via_hub' as const, status: 'Archived' as const, canonicalStatus: 'archived', createdAt: batch.createdAt, availableWeightKg: 0, disposedWeightKg: 25000 };
  const measurement = { ...data.measurements[0], id: 'COUNT-LISTING-WEIGHT', batchId: batch.id, recordedBy: hub.id,
    canonicalStage: 'listing' as const, stage: 'Declaration' as const, transferId: null, status: 'Measured' as const, weightKg: 25000,
    timestamp: '2026-10-22T01:01:00Z', facilityId: null, supersedesMeasurementId: null };
  const disposal: HubDisposalRecord = { id: 'COUNT-OLD-DISPOSAL', listingId: listing.id, operatorId: hub.id,
    listingTitle: listing.title, category: listing.textileType, weightKg: 25000, reason: 'Recorded disposal', disposedAt: '2026-10-22T01:02:00Z' };
  data.users = [admin, hub, consumer]; data.facilities = [site]; data.materialBatches = [batch]; data.listings = [listing];
  data.measurements = [measurement]; data.transfers = []; data.recoveryRecords = []; data.auditRecords = [];
  class DisposalStore extends MemoryStore { async loadHubDisposals() { return { available: true, records: [disposal] }; } }
  const store = new DisposalStore(data), source = await loadDashboardAnalyticsSnapshot(store);
  const confirm = (kg = 0, at = countAt) => {
    const record = createStockConfirmation(source, admin, site.id, kg, at, 'Actual stock checked', at);
    source.stockConfirmations = [...source.stockConfirmations ?? [], record];
    return record;
  };
  const row = () => buildHubStorageAnalytics(source, [site], admin, later).rows[0];
  return { data, store, source, admin, hub, site, batch, listing, measurement, disposal, confirm, row };
}

test('a confirmed zero fixes missing intake without fabricating receipts or deducting historic disposal again', async () => {
  const f = await fixture(), before = structuredClone(f.source);
  assert.equal(f.row().status, 'Stock not established');
  f.confirm();
  const row = f.row();
  assert.equal(row.storedKg, 0); assert.equal(row.status, 'Available'); assert.equal(row.utilization, 0);
  assert.equal(row.disposedKg, 25000); assert.equal(row.availableToReceiveKg, 45000); assert.equal(row.selectable, true);
  assert.equal(row.estimatedStock, false); assert.equal(row.stockNeedsReview, false);
  assert.deepEqual(f.source.measurements, before.measurements); assert.deepEqual(f.source.hubDisposals, before.hubDisposals);
  const result = await buildDashboardAnalytics(f.store, f.admin, { dateRange: 'All time' }, f.source, later);
  assert.equal(result.hubStorage.rows[0].storedKg, 0);
  assert.equal(result.hubOperations.collectedKg, null, 'A stock count must not claim physical intake.');
});

test('only subsequent unique disposals are deducted; an overdrawn count is unknown, never clamped to zero', async () => {
  const f = await fixture(); f.confirm(1000);
  const next = { ...f.disposal, id: 'COUNT-NEW-DISPOSAL', weightKg: 400, disposedAt: '2026-10-23T01:10:00Z' };
  f.source.hubDisposals!.records.push(next, { ...next });
  assert.equal(f.row().storedKg, 600); assert.equal(f.row().disposedKg, 25400);
  f.source.hubDisposals!.records.push({ ...next, id: 'EXCESS', weightKg: 601 });
  assert.equal(f.row().storedKg, null); assert.equal(f.row().stockNeedsReview, true);
});

test('new intake replaces its reservation and is added exactly once after the count', async () => {
  const f = await fixture(); f.confirm();
  const batch = { ...f.batch, id: 'NEXT-BATCH', declaredWeightKg: 500, createdAt: '2026-10-23T01:05:00Z' };
  f.source.allBatches.push(batch);
  f.source.listings.push({ ...f.listing, id: 'NEXT-LISTING', batchId: batch.id, status: 'Open', canonicalStatus: 'available', createdAt: batch.createdAt, disposedWeightKg: 0 });
  assert.equal(f.row().reservedKg, 500); assert.equal(f.row().storedKg, 0);
  const receipt = { ...f.measurement, id: 'NEXT-RECEIPT', batchId: batch.id, canonicalStage: 'collection' as const,
    stage: 'Receipt' as const, weightKg: 500, facilityId: f.site.id, timestamp: '2026-10-23T01:10:00Z' };
  f.source.measurements.push(receipt, { ...receipt });
  assert.equal(f.row().storedKg, 500); assert.equal(f.row().reservedKg, 0);
});

test('supported later outbound handover adjusts a count even when old intake is missing', async () => {
  const f = await fixture(); f.confirm(1000);
  const template = (await createSeedData()).transfers[0];
  f.source.allTransfers.push({ ...template, id: 'COUNT-OUT', batchId: f.batch.id, providerId: f.hub.id, recipientId: f.admin.id,
    handoverWeightKg: 300, status: 'Completed', events: [], updatedAt: '2026-10-23T01:20:00Z' });
  assert.equal(f.row().storedKg, 700);
  f.source.allTransfers[0].handoverWeightKg = null;
  assert.equal(f.row().storedKg, null); assert.equal(f.row().stockNeedsReview, true);
});

test('late backdated, edited, missing, invalid and conflicting evidence require review', async () => {
  for (const change of ['backdated', 'edit', 'delete', 'invalid', 'conflict', 'new-unreceived-weight', 'feed']) {
    const f = await fixture(); f.confirm(1000);
    if (change === 'backdated') f.source.hubDisposals!.records.push({ ...f.disposal, id: 'LATE', weightKg: 50 });
    if (change === 'edit') f.source.hubDisposals!.records[0].weightKg = 24999;
    if (change === 'delete') f.source.hubDisposals!.records = [];
    if (change === 'invalid') f.source.hubDisposals!.records.push({ ...f.disposal, id: 'INVALID', weightKg: -2, disposedAt: '2026-10-23T01:20:00Z' });
    if (change === 'conflict') f.source.hubDisposals!.records.push({ ...f.disposal, weightKg: 20000 });
    if (change === 'new-unreceived-weight') f.source.measurements.push({ ...f.measurement, id: 'NEW-WEIGHT', timestamp: '2026-10-23T01:30:00Z' });
    if (change === 'feed') f.source.hubDisposals!.available = false;
    assert.equal(f.row().storedKg, null, change); assert.equal(f.row().selectable, false, change);
  }
});

test('stock confirmation preserves reservations, threshold, maintenance and approval restrictions', async () => {
  const f = await fixture(); f.confirm(45000);
  assert.equal(f.row().status, 'Intake paused');
  f.confirm(0, '2026-10-23T01:05:00.000Z');
  f.source.facilities[0].status = 'Maintenance'; assert.equal(f.row().status, 'Maintenance');
  f.source.facilities[0].status = 'Available';
  f.source.users.find(item => item.id === f.hub.id)!.organizationVerified = false;
  assert.equal(f.row().status, 'No approved operator');
});

test('incoming reservations can pause an empty counted Hub and overfilled counts remain visible', async () => {
  const f = await fixture(); f.confirm();
  const batch = { ...f.batch, id: 'PENDING-BATCH', declaredWeightKg: 45000 };
  f.source.allBatches.push(batch);
  f.source.listings.push({ ...f.listing, id: 'PENDING-LISTING', batchId: batch.id, status: 'Open', canonicalStatus: 'available', disposedWeightKg: 0 });
  assert.equal(f.row().storedKg, 0); assert.equal(f.row().reservedKg, 45000); assert.equal(f.row().status, 'Intake paused');
  f.confirm(60000, '2026-10-23T01:30:00.000Z');
  assert.equal(f.row().storedKg, 60000); assert.equal(f.row().utilization, 120); assert.equal(f.row().status, 'Intake paused');
});

test('a fresh count covers intervening disposals and a missing listing measurement does not block subsequent disposal', async () => {
  const f = await fixture(); f.source.measurements = []; f.confirm(1000);
  f.source.hubDisposals!.records.push({ ...f.disposal, id: 'INTERVENING', weightKg: 400, disposedAt: '2026-10-23T01:10:00Z' });
  assert.equal(f.row().storedKg, 600);
  f.confirm(550, '2026-10-23T01:30:00.000Z');
  assert.equal(f.row().storedKg, 550, 'The old and intervening disposals are already covered by the fresh count.');
});

test('a confirmation never resolves ambiguous multi-site attribution', async () => {
  const f = await fixture(); f.confirm();
  f.source.users.find(item => item.id === f.hub.id)!.scope.facilityIds.push('SECOND-SITE');
  assert.equal(f.row().storedKg, null); assert.equal(f.row().selectable, false);
});

test('confirmation history stays append-only and is excluded from regional/de-identified output', async () => {
  const f = await fixture(); const old = f.confirm(1000);
  const next = f.confirm(200, '2026-10-23T01:30:00.000Z');
  assert.notEqual(old.id, next.id); assert.equal(f.source.stockConfirmations!.length, 2); assert.equal(f.row().storedKg, 200);
  for (const role of ['Government', 'Researcher'] as const) {
    const result = buildHubStorageAnalytics(f.source, [f.site], { ...f.admin, role }, later);
    assert.equal(result.rows[0].storedKg, 200);
    for (const secret of [old.id, next.id, 'Actual stock checked', f.site.name, f.site.id]) assert.ok(!JSON.stringify(result).includes(secret));
  }
});

test('stock confirmation API enforces Admin, validation, persistence and concurrent successor uniqueness', async () => {
  const f = await fixture();
  const government = { ...f.admin, id: 'COUNT-GOV', role: 'Government' as const };
  const researcher = { ...f.admin, id: 'COUNT-RES', role: 'Researcher' as const };
  await f.store.insert('users', government); await f.store.insert('users', researcher);
  const app = express(); app.use(express.json()); registerHubStockRoutes(app, f.store);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const tokens = new Map<string, string>();
  for (const actor of [f.admin, government, researcher, f.hub]) {
    const at = new Date().toISOString(), id = `COUNT-SESSION-${actor.id}`;
    await f.store.createSession({ id, userId: actor.id, client: 'api', tokenHash: 'test', usedTokenHashes: [], csrfHash: 'test',
      expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
    tokens.set(actor.id, issueToken(actor.id, actor.role, id));
  }
  const body = { stockKg: 0, countedAt: new Date(Date.now() - 5000).toISOString(), reason: 'Actual store checked empty', confirmed: true, previousConfirmationId: null };
  const post = (patch: Record<string, unknown> = {}, actor = f.admin) => fetch(`http://127.0.0.1:${address.port}/api/facilities/${f.site.id}/stock-confirmations`, {
    method: 'POST', headers: { authorization: `Bearer ${tokens.get(actor.id)}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...patch }) });
  try {
    for (const actor of [government, researcher, f.hub]) assert.equal((await post({}, actor)).status, 403);
    for (const patch of [{ stockKg: -1 }, { stockKg: '0' }, { stockKg: null }, { stockKg: true }, { countedAt: 'not a date' },
      { countedAt: new Date(Date.now() + 60000).toISOString() }, { reason: '' }, { confirmed: false }]) assert.equal((await post(patch)).status, 400);
    assert.equal((await f.store.all('auditRecords')).length, 0);
    const [one, two] = await Promise.all([post(), post()]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409]);
    const result = await (one.status === 201 ? one : two).json();
    assert.equal(result.row.storedKg, 0); assert.equal(result.row.status, 'Available');
    const audit = await f.store.all('auditRecords'); assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, f.admin.id); assert.equal(JSON.parse(audit[0].details).stockKg, 0);
    const reloaded = await loadDashboardAnalyticsSnapshot(f.store);
    assert.equal(buildHubStorageAnalytics(reloaded, [f.site], f.admin).rows[0].storedKg, 0);
    assert.equal((await post()).status, 409);
    assert.equal((await post({ previousConfirmationId: audit[0].id, countedAt: '2026-10-22T00:00:00Z' })).status, 400);
    assert.deepEqual(await f.store.all('measurements'), f.data.measurements);
    assert.equal((await f.store.loadHubDisposals()).records[0].weightKg, 25000);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
