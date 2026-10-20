import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { recoveryMassBalance } from '../shared/recovery.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildHubDisposalMonitoring } from './hubs.js';
import { buildHubOperations } from './hubOperations.js';
import { registerManagementRoutes } from './management.js';
import { issueToken } from './auth.js';

test('recovery entry and analytics share finite, nonnegative one-gram mass balance rules', () => {
  const weights = { inputWeightKg: 100, outputWeightKg: 80, residualWeightKg: 15, lossWeightKg: 5 };
  assert.equal(recoveryMassBalance(weights), 'Balanced');
  assert.equal(recoveryMassBalance({ ...weights, outputWeightKg: 80.005 }), 'Unbalanced');
  assert.equal(recoveryMassBalance({ ...weights, outputWeightKg: null }), 'Incomplete');
  assert.equal(recoveryMassBalance({ ...weights, outputWeightKg: NaN }), 'Incomplete');
  assert.equal(recoveryMassBalance({ ...weights, inputWeightKg: -1, outputWeightKg: -21 }), 'Unbalanced');
  assert.equal(recoveryMassBalance({ ...weights, residualWeightKg: -1 }), 'Unbalanced');
  assert.equal(recoveryMassBalance({ inputWeightKg: 100, outputWeightKg: 80, residualWeightKg: 20 }), 'Balanced');
});

test('record validation, flagging and reversal reconcile Overview, transfer, Hub and facility metrics without duplicate stage mass', async () => {
  const data = await createSeedData(), admin = data.users[0], now = new Date('2026-10-20T04:00:00Z');
  const receiver = data.users.find(user => user.role === 'Recycler')!;
  const hub = { ...structuredClone(receiver), id: 'RECOVERY-TEST-HUB', role: 'BalikTela Hub' as const,
    organizationVerified: true, scope: { ...receiver.scope, facilityIds: [] } };
  data.users.push(hub);
  const batch = { ...data.materialBatches[0], declaredWeightKg: 100, createdAt: '2026-08-05T01:00:00Z' };
  const listing = { ...data.listings[0], batchId: batch.id, weighingHubId: hub.id, createdAt: batch.createdAt };
  const transfer = { ...data.transfers[0], batchId: batch.id, listingId: listing.id, status: 'Completed' as const,
    receiptWeightKg: 100, verifiedWeightKg: 100, updatedAt: '2026-09-01T01:00:00Z' };
  data.materialBatches = [batch]; data.listings = [listing]; data.transfers = [transfer]; data.measurements = [];
  const base = { ...data.recoveryRecords[0], transferId: transfer.id, batchId: batch.id, facilityId: data.facilities[0].id,
    organizationId: data.facilities[0].organizationId, inputWeightKg: 100, status: 'Validated' as const,
    validatedBy: admin.id, timestamp: '2026-09-02T01:00:00Z', lossWeightKg: 0 };
  data.recoveryRecords = [
    { ...base, id: 'COLLECTION', stage: 'Collection', recordedBy: hub.id, outputWeightKg: 100, residualWeightKg: 0 },
    { ...base, id: 'SORTING', stage: 'Sorting', outputWeightKg: 95, residualWeightKg: 5 },
    { ...base, id: 'PROCESSING', stage: 'Processing', outcome: 'Recycling', outputWeightKg: 80, residualWeightKg: 15, lossWeightKg: 5 },
    { ...base, id: 'FINAL', stage: 'Recovery', outcome: 'Recycling', outputWeightKg: 80, residualWeightKg: 15, lossWeightKg: 5, status: 'Recorded', validatedBy: null },
  ];
  const store = new MemoryStore(data);
  const auditCount = (await store.all('auditRecords')).length;
  const disposals = { available: true, records: [{ id: 'DISPOSAL', listingId: listing.id, operatorId: hub.id,
    listingTitle: listing.title, category: batch.materialCategory, weightKg: 5, reason: 'Separate disposal evidence', disposedAt: '2026-10-18T01:00:00Z' }] };
  const app = express(); app.use(express.json()); registerManagementRoutes(app, store);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const at = new Date().toISOString(), sessionId = 'RECOVERY-LINK-TEST';
  await store.createSession({ id: sessionId, userId: admin.id, client: 'api', tokenHash: 'test', usedTokenHashes: [], csrfHash: 'test',
    expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
  const token = issueToken(admin.id, admin.role, sessionId);
  const update = async (id: string, action: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/recovery-records/${id}`, { method: 'PATCH',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ action, reason: `Integration test: ${action}` }) });
    assert.equal(response.status, 200, await response.text());
  };
  const snapshot = async () => ({ ...await loadDashboardAnalyticsSnapshot(store), hubDisposals: disposals });
  const query = { dateRange: 'Last 3 calendar months' };
  const verify = async (expected: number) => {
    const result = await buildDashboardAnalytics(store, admin, query, await snapshot(), now);
    assert.equal(result.circularFlow.collectedKg, 100);
    assert.equal(result.circularFlow.recycledKg, expected);
    assert.equal(result.facilities.find(item => item.id === base.facilityId)?.processedKg, expected);
    assert.equal(result.circularFlow.sortedKg, 95);
    assert.equal(result.transactions[0].weightKg, 100);
    assert.equal(result.hubDisposal.summary.disposedKg, 5);
    assert.equal(result.hubOperations.collectedKg, 100);
    assert.equal(result.impactMetrics.landfillAvoidedKg, null);
    return result;
  };
  try {
    await verify(80);
    await update('FINAL', 'validate');
    assert.equal((await verify(80)).impactMetrics.diversionRate, 80, 'Processing and final recovery must not be added twice.');
    await update('PROCESSING', 'reverse');
    await update('FINAL', 'flag');
    assert.equal((await verify(0)).impactMetrics.diversionRate, null);
    const source = await snapshot(), disposal = await buildHubDisposalMonitoring(store, admin, query, now, source);
    assert.equal(disposal.summary.disposedKg, buildHubOperations(source, [batch], admin, 'Cohort', now).summary.disposedKg);
    assert.equal((await buildDashboardAnalytics(store, admin, { ...query, textileType: 'No matching textile' }, source, now)).circularFlow.collectedKg, 0);
    assert.deepEqual(await store.all('materialBatches'), data.materialBatches, 'Recovery validation does not overwrite registered material or mobile stock.');
    assert.deepEqual(await store.all('transfers'), data.transfers);
    assert.equal((await store.all('auditRecords')).slice(auditCount).filter(item => item.action.startsWith('recovery.')).length, 3);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
