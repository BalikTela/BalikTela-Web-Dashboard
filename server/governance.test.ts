import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { buildGovernanceDashboard, registerGovernanceRoutes } from './governance.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from './dashboardAnalytics.js';
import { buildOperationalDemo } from './analytics/operationalDemo.js';
import { buildOctoberDemo } from './analytics/octoberDemo.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { issueToken } from './auth.js';
import { commitImport, planImport } from './imports.js';
import { IMPORT_COLUMNS } from '../shared/imports.js';
import type { DatabaseShape } from './types.js';

const now = new Date('2026-10-19T04:00:00Z');
async function fixture() {
  const seed = await createSeedData();
  for (const data of [buildOperationalDemo(), buildOctoberDemo()]) {
    for (const [name, rows] of data.domainTables) (seed[name] as DatabaseShape[keyof DatabaseShape]).push(...rows as never[]);
  }
  return seed;
}

test('policy summary, regional and producer evidence reconcile with the shared Overview formulas under filters', async () => {
  const seed = await fixture(), store = new MemoryStore(seed), actor = seed.users[0];
  const snapshot = await loadDashboardAnalyticsSnapshot(store);
  for (const filters of [{}, { region: 'Central Visayas' }, { textileType: 'Cotton' }, { dateRange: 'Custom range', startDate: '2026-09-01', endDate: '2026-09-30' }, { transactionStatus: 'Completed' }, { facilityId: 'SYN-FAC-METRO-MANILA' }]) {
    const policy = (await buildGovernanceDashboard(store, actor, filters, snapshot, now)).monitoring;
    const overview = await buildDashboardAnalytics(store, actor, filters, snapshot, now);
    assert.equal(policy.summary.batches, overview.operations.metrics.batchCount);
    assert.equal(policy.summary.collectedKg ?? 0, overview.circularFlow.collectedKg);
    assert.equal(policy.summary.reusedKg ?? 0, overview.circularFlow.reusedKg);
    assert.equal(policy.summary.recycledKg ?? 0, overview.circularFlow.recycledKg);
    assert.equal(policy.summary.recoveryShare, overview.impactMetrics.diversionRate);
    assert.equal(policy.summary.completedTransfers, overview.sharedActivity.completedTransfers);
    assert.equal(policy.summary.missingIntake, overview.materialEvidence.missingCollectionBatches);
    assert.equal(policy.summary.matchedRecoveryKg, overview.materialEvidence.matchedDiversionKg);
    assert.ok(Math.abs(policy.regions.reduce((total, row) => total + (row.collectedKg ?? 0), 0) - (policy.summary.collectedKg ?? 0)) < 0.001);
    const producerIds = new Set(snapshot.users.filter(user => user.role === 'Producer').map(user => user.id));
    const expectedDeclared = selectAnalyticsCohort(snapshot, actor, filters, now).currentBatches.filter(batch => producerIds.has(batch.sourceUserId)).reduce((total, batch) => total + (batch.declaredWeightKg ?? 0), 0);
    assert.ok(Math.abs(policy.producers.reduce((total, row) => total + row.declaredKg, 0) - expectedDeclared) < 0.001);
    assert.ok(policy.producers.every(row => row.collectedKg === null || row.recyclableCollectedKg! <= row.collectedKg));
  }
});

test('government and aggregate-only policy responses withhold identifiers, organization names and account details', async () => {
  const seed = await fixture(), store = new MemoryStore(seed);
  for (const role of ['Government', 'Researcher'] as const) {
    const actor = seed.users.find(user => user.role === role)!;
    actor.scope.regions = ['Metro Manila'];
    actor.scope.aggregateOnly = role === 'Researcher';
    actor.scope.canExport = false;
    const result = await buildGovernanceDashboard(store, actor, {}, undefined, now);
    assert.equal(result.monitoring.producerNamesRestricted, true);
    assert.equal(result.privacy.exportAllowed, false);
    assert.ok(result.monitoring.producers.every(row => row.name === 'Producer regional aggregate' && row.region === 'Metro Manila'));
    assert.ok(result.monitoring.regions.every(row => row.region === 'Metro Manila'));
    const text = JSON.stringify(result);
    for (const user of seed.users) { assert.ok(!text.includes(user.id)); assert.ok(!text.includes(user.email)); assert.ok(!text.includes(user.fullName)); }
    for (const organization of seed.organizations) { assert.ok(!text.includes(organization.id)); assert.ok(!text.includes(organization.name)); }
    const outside = await buildGovernanceDashboard(store, actor, { region: 'Davao Region' }, undefined, now);
    assert.equal(outside.monitoring.summary.batches, 0);
    assert.deepEqual(outside.monitoring.producers, []);
  }
});

test('producer policy evidence cannot expose unrelated organizations even when filters request them', async () => {
  const seed = await fixture(), store = new MemoryStore(seed), actor = seed.users.find(user => user.id === 'USR-PROD-01')!;
  const result = await buildGovernanceDashboard(store, actor, {}, undefined, now);
  assert.ok(result.monitoring.producers.every(row => row.name === actor.organization));
  assert.equal(result.monitoring.summary.batches, 2);
  const other = await buildGovernanceDashboard(store, actor, { organizationId: 'SYN-ORG-PROD-DAVAO-REGION' }, undefined, now);
  assert.equal(other.monitoring.summary.batches, 0);
  assert.deepEqual(other.monitoring.producers, []);
});

test('empty and missing collection evidence stays unavailable, and comparisons do not invent zero baselines', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed);
  const result = (await buildGovernanceDashboard(store, seed.users[0], {}, undefined, now)).monitoring;
  assert.equal(result.summary.collectedKg, null);
  assert.equal(result.summary.recyclableCollectedKg, null);
  assert.equal(result.summary.recoveryShare, null);
  assert.equal(result.summary.intakeCoverage, 0);
  assert.ok(result.regions.every(row => row.collectionChangePercent === null));
  const empty = (await buildGovernanceDashboard(store, seed.users[0], { textileType: 'No matching material' }, undefined, now)).monitoring;
  assert.equal(empty.summary.intakeCoverage, null);
  assert.equal(empty.summary.collectedKg, null);
  assert.deepEqual(empty.regions, []);
  assert.equal(empty.hubDisposals.available, false);
  assert.equal(empty.hubDisposals.disposedKg, null);
});

test('regional collection change uses validated intake and an actual positive prior denominator', async () => {
  const seed = await createSeedData(), template = seed.materialBatches[0];
  seed.materialBatches = [{ ...template, id: 'CURRENT', createdAt: '2026-09-01T01:00:00Z' }, { ...template, id: 'PRIOR', createdAt: '2026-06-01T01:00:00Z' }];
  seed.measurements = []; seed.transfers = [];
  seed.recoveryRecords = seed.materialBatches.map((batch, index) => ({ ...seed.recoveryRecords[0], id: `COLLECTION-${index}`, batchId: batch.id,
    stage: 'Collection', inputWeightKg: 150, outputWeightKg: index ? 100 : 120, residualWeightKg: index ? 50 : 30,
    lossWeightKg: 0, status: 'Validated', validatedBy: 'Verifier', timestamp: batch.createdAt, outcome: null }));
  const result = (await buildGovernanceDashboard(new MemoryStore(seed), seed.users[0], {}, undefined, now)).monitoring;
  assert.equal(result.summary.collectedKg, 120);
  assert.equal(result.previous.collectedKg, 100);
  assert.equal(result.regions[0].collectionChangePercent, 20);
  assert.equal(result.summary.recoveryShare, null, 'A collection increase is not evidence of recovery.');
});

test('regional Hub participation counts identified approved operators, not every approved Recycler', async () => {
  const seed = await createSeedData(), recycler = seed.users.find(user => user.role === 'Recycler')!;
  recycler.organizationVerified = true;
  seed.users.push({ ...recycler, id: 'HUB-OPERATOR', role: 'BalikTela Hub', fullName: 'Assigned Hub', email: 'hub@policy.invalid' });
  seed.listings[0].weighingHubId = 'HUB-OPERATOR';
  seed.measurements.push({ ...seed.measurements[0], id: 'HUB-READING', batchId: seed.listings[0].batchId, transferId: null,
    canonicalStage: 'listing', status: 'Measured', weightKg: 120, recordedBy: 'HUB-OPERATOR', timestamp: '2026-09-21T03:00:00Z' });
  const result = (await buildGovernanceDashboard(new MemoryStore(seed), seed.users[0], {}, undefined, now)).monitoring;
  assert.equal(result.regions[0].approvedHubs, 1);
  assert.equal(result.regions[0].hubWeighedBatches, 1);
  assert.equal(result.summary.collectedKg, null, 'Listing-scale weighing alone is not collection evidence.');
});

test('bulk imports update policy evidence exactly once without governance reads mutating records', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed), actor = seed.users[0];
  const csv = [IMPORT_COLUMNS.join(','), 'policy-import,2026-08-05T01:00:00Z,USR-PROD-01,USR-REC-01,FAC-001,Cotton,100,90,80,Recycling,70'].join('\n');
  const before = (await buildGovernanceDashboard(store, actor, {}, undefined, now)).monitoring;
  const preview = await planImport(store, actor, csv, now);
  await commitImport(store, actor, csv, preview.preview.previewHash, 'Policy fixture', now);
  const snapshot = structuredClone(await loadDashboardAnalyticsSnapshot(store));
  const after = (await buildGovernanceDashboard(store, actor, {}, undefined, now)).monitoring;
  assert.equal(after.summary.collectedKg, (before.summary.collectedKg ?? 0) + 90);
  assert.equal(after.summary.recyclableCollectedKg, 90);
  assert.equal(after.summary.recycledKg, (before.summary.recycledKg ?? 0) + 70);
  assert.equal(after.summary.completedTransfers, before.summary.completedTransfers + 1);
  assert.deepEqual(await loadDashboardAnalyticsSnapshot(store), snapshot);
  const retry = await planImport(store, actor, csv, now);
  await commitImport(store, actor, csv, retry.preview.previewHash, 'Retry policy fixture', now);
  assert.deepEqual((await buildGovernanceDashboard(store, actor, {}, undefined, now)).monitoring.summary, after.summary);
});

test('Hub disposal is a separate scoped ledger including archive history, never a recovery or diversion proxy', async () => {
  const seed = await createSeedData(), batch = seed.materialBatches[0];
  batch.currentStatus = 'Archived';
  const row = { id: 'DISPOSAL', listingId: seed.listings[0].id, operatorId: 'USR-REC-01', listingTitle: 'Disposal fixture', category: 'Cotton', weightKg: 5, reason: 'Damaged material', disposedAt: '2026-10-18T04:00:00Z' };
  class DisposalStore extends MemoryStore {
    async loadHubDisposals() { return { available: true, records: [row, row, { ...row, id: 'INVALID', weightKg: -1 }, { ...row, id: 'FUTURE', disposedAt: '2027-01-01T00:00:00Z' }] }; }
  }
  const store = new DisposalStore(seed), result = await buildGovernanceDashboard(store, seed.users[0], {}, undefined, now);
  assert.equal(result.monitoring.hubDisposals.disposedKg, 5);
  assert.equal(result.monitoring.hubDisposals.records, 1);
  assert.equal(result.monitoring.hubDisposals.invalidRecords, 1);
  assert.equal(result.monitoring.summary.collectedKg, null);
  assert.equal(result.monitoring.summary.recoveryShare, null);
  assert.equal((await buildGovernanceDashboard(store, seed.users[0], { region: 'Davao Region' }, undefined, now)).monitoring.hubDisposals.records, 0);
  assert.ok(!JSON.stringify(result).includes('DISPOSAL'));
});

test('governance API checks authentication, current role, filters and private caching without database writes', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed), tokens = new Map<string, string>();
  for (const actor of seed.users) {
    const id = `POLICY-${actor.id}`, at = new Date().toISOString();
    await store.createSession({ id, userId: actor.id, client: 'api', tokenHash: 'test', csrfHash: 'test', usedTokenHashes: [], expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
    tokens.set(actor.role, issueToken(actor.id, actor.role, id));
  }
  const app = express(); registerGovernanceRoutes(app, store, undefined, () => now);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const get = (query = '', role?: string) => fetch(`http://127.0.0.1:${address.port}/api/governance${query}`, { headers: role ? { Authorization: `Bearer ${tokens.get(role)}` } : {} });
  try {
    const before = structuredClone(await store.all('auditRecords'));
    assert.equal((await get()).status, 401);
    assert.equal((await get('', 'Consumer')).status, 403);
    const response = await get('', 'Government'); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.json()).monitoring.producerNamesRestricted, true);
    assert.equal((await get('?region=x&region=y', 'Administrator')).status, 400);
    assert.equal((await get('?invented=1', 'Administrator')).status, 400);
    assert.equal((await get('?dateRange=Custom%20range&startDate=2026-02-30&endDate=2026-03-01', 'Administrator')).status, 400);
    seed.users[0].role = 'Producer';
    assert.equal((await get('', 'Administrator')).status, 401);
    assert.deepEqual(await store.all('auditRecords'), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
