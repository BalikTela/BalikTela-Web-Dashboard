import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { accessSummary, authorize, hasPermission, resolveWebActor } from './access-control.js';
import { issueToken, requireAuth } from './auth.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { ACCOUNT_GROUPS, accountGroup, isWebDashboardRole } from '../shared/webAccess.js';
import type { UserRole } from './types.js';

test('only three roles have dashboard permissions and Government is always summary-only', async () => {
  const seed = await createSeedData(), admin = seed.users[0];
  for (const role of ['Administrator', 'Government', 'Researcher', 'Producer', 'Consumer', 'Recycler', 'BalikTela Hub', 'Upcycler', 'LGU/Collection Point', 'NGO'] as UserRole[]) {
    const actor = { ...admin, role };
    assert.equal(hasPermission(actor, 'analytics.read'), isWebDashboardRole(role));
    assert.equal(accessSummary(actor).permissions.includes('analytics.read'), isWebDashboardRole(role));
  }
  const government = await resolveWebActor(new MemoryStore(seed), { ...admin, role: 'Government', scope: { ...admin.scope, aggregateOnly: false } });
  assert.equal(government.scope.aggregateOnly, true);
  assert.equal(hasPermission(government, 'transfers.read'), false);
  assert.equal(hasPermission(government, 'users.read'), false);
  assert.equal(hasPermission(government, 'audit.read'), false);
  assert.equal(hasPermission(government, 'governance.read'), true);
  assert.deepEqual(ACCOUNT_GROUPS.map(group => group.label), ['Admin', 'Government', 'Researcher', 'Producer / Consumer', 'Recycler / Hub']);
  for (const user of seed.users) assert.notEqual(accountGroup(user.role), 'Other');
});

test('server authorization rejects old participant tokens for every client while administrator can manage every account group', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed), admin = seed.users[0];
  const nativeHub = { ...seed.users.find(user => user.role === 'Recycler')!, id: 'NATIVE-HUB', role: 'BalikTela Hub' as const, organizationVerified: true };
  seed.users.push(nativeHub);
  const before = JSON.stringify(seed), tokens = new Map<string, string>();
  for (const user of seed.users) for (const client of ['web', 'mobile', 'api'] as const) {
    const id = `${user.id}-${client}`, at = new Date().toISOString();
    await store.createSession({ id, userId: user.id, client, tokenHash: 'test', csrfHash: 'test', usedTokenHashes: [], expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
    tokens.set(id, issueToken(user.id, user.role, id));
  }
  const app = express();
  app.get('/analytics', requireAuth, authorize(store, 'analytics.read'), (_req, res) => res.json({ allowed: true }));
  app.get('/users', requireAuth, authorize(store, 'users.read'), (_req, res) => res.json({ users: seed.users.map(user => ({ id: user.id, role: user.role })) }));
  app.post('/edit', requireAuth, authorize(store, 'batches.manage'), (_req, res) => res.json({ allowed: true }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, token?: string, method = 'GET') => fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    assert.equal((await call('/analytics')).status, 401);
    for (const user of seed.users) for (const client of ['web', 'mobile', 'api']) {
      const token = tokens.get(`${user.id}-${client}`)!;
      const response = await call('/analytics', token);
      assert.equal(response.status, isWebDashboardRole(user.role) ? 200 : 403);
      if (!isWebDashboardRole(user.role)) assert.equal((await response.json()).code, 'WEB_ACCESS_DENIED');
      assert.equal((await call('/edit', token, 'POST')).status, user.role === 'Administrator' ? 200 : 403);
      assert.equal((await call('/users', token)).status, user.role === 'Administrator' ? 200 : 403);
    }
    const users = await (await call('/users', tokens.get(`${admin.id}-web`))).json();
    assert.equal(users.users.length, seed.users.length);
    const research = seed.users.find(user => user.role === 'Researcher')!;
    assert.equal((await call('/analytics?producer=Private%20Person', tokens.get(`${research.id}-web`))).status, 403);
    assert.equal((await call('/analytics?region=Metro%20Manila', tokens.get(`${research.id}-web`))).status, 200);
    assert.equal(JSON.stringify(seed), before);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
