import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { issueToken } from './auth.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { registerPredictiveRoutes } from './analytics/routes.js';
import type { UserRole } from './types.js';

test('predictive API enforces sessions, role/export permissions and region scopes without changing operational data', async () => {
  const seed = await createSeedData();
  for (const user of seed.users) { user.scope.regions = []; user.scope.canExport = false; }
  const government = seed.users.find(user => user.role === 'Government')!;
  const researcher = seed.users.find(user => user.role === 'Researcher')!;
  researcher.scope.regions = ['Central Visayas'];
  const store = new MemoryStore(seed);
  const before = JSON.stringify({ batches: seed.materialBatches, listings: seed.listings, transfers: seed.transfers });
  const tokens = new Map<UserRole, string>();
  const at = new Date().toISOString();
  for (const user of seed.users) {
    const id = `PRED-${user.id}`;
    await store.createSession({ id, userId: user.id, client: 'api', tokenHash: 'isolated-test', usedTokenHashes: [], csrfHash: 'test', expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
    tokens.set(user.role, issueToken(user.id, user.role, id));
  }
  const app = express(); registerPredictiveRoutes(app, store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address.');
  const get = async (path = '', role?: UserRole) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analytics/predictive${path}`, { headers: role ? { Authorization: `Bearer ${tokens.get(role)}` } : {} });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  try {
    assert.equal((await get()).status, 401);
    for (const role of ['Consumer', 'Producer', 'Recycler'] as UserRole[]) assert.equal((await get('', role)).status, 403);
    const admin = await get('', 'Administrator');
    assert.equal(admin.status, 200); assert.equal(admin.body.mode, 'synthetic-poc'); assert.equal(admin.body.scope.records, 9600);
    assert.equal(admin.cache, 'private, no-store');
    assert.deepEqual((await get('', 'Administrator')).body, admin.body);
    const shortHistory = await get('?historyWeeks=13', 'Administrator');
    assert.equal(shortHistory.body.history.length, 13);
    assert.deepEqual(shortHistory.body.models, admin.body.models);
    assert.deepEqual(shortHistory.body.forecast, admin.body.forecast);
    assert.equal((await get('', 'Government')).status, 403);
    const restricted = await get('', 'Researcher');
    assert.equal(restricted.status, 200); assert.equal(restricted.body.scope.records, 2400);
    assert.deepEqual(restricted.body.regions, ['Central Visayas']);
    assert.equal((await get('?region=Metro%20Manila', 'Researcher')).status, 403);
    assert.equal((await get('/dataset', 'Researcher')).status, 403);
    government.scope.canExport = true;
    assert.equal((await get('/dataset', 'Government')).status, 403);
    researcher.scope.canExport = true;
    const exported = await get('/dataset', 'Researcher');
    assert.equal(exported.status, 200); assert.equal(exported.body.records, 2400);
    assert.equal(exported.body.csv.trim().split('\n').length, 2401);
    assert.ok(!exported.body.csv.includes('Metro Manila'));
    assert.equal((await get('?region=Invented', 'Administrator')).status, 400);
    assert.equal((await get('?historyWeeks=12', 'Administrator')).status, 400);
    assert.equal((await get('?dateRange=90', 'Administrator')).status, 400);
    assert.equal((await get('?region=Metro%20Manila&region=Davao%20Region', 'Administrator')).status, 400);
    const fullCsv = await get('/dataset', 'Administrator');
    assert.equal(fullCsv.body.records, 9600);
    assert.equal(fullCsv.body.isSynthetic, true);
    researcher.accountStatus = 'Pending verification';
    assert.equal((await get('', 'Researcher')).status, 403);
    researcher.accountStatus = 'Active'; researcher.passwordChangedAt = null;
    assert.equal((await get('', 'Researcher')).status, 403);
    researcher.passwordChangedAt = at; researcher.accountStatus = 'Suspended';
    assert.equal((await get('', 'Researcher')).status, 403);
    await store.revokeSession(`PRED-${government.id}`, government.id, at);
    assert.equal((await get('', 'Government')).status, 401);
    assert.equal(JSON.stringify({ batches: seed.materialBatches, listings: seed.listings, transfers: seed.transfers }), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
