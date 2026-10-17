import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { accountAccessSignature, reauthenticationCode } from '../shared/sessionPolicy.js';
import { authorize, permissionsFor } from './access-control.js';
import { issueToken, requireAuth } from './auth.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';

test('account access signatures track security changes but ignore profile text and scope ordering', async () => {
  const seed = await createSeedData();
  const user = seed.users[0];
  const signature = accountAccessSignature(user, permissionsFor(user));
  const renamed = { ...user, fullName: 'Changed display name' };
  assert.equal(accountAccessSignature(renamed, [...permissionsFor(user)].reverse()), signature);
  assert.equal(accountAccessSignature({ ...user, emailVerifiedAt: user.emailVerifiedAt?.replace('.000Z', '+00:00') ?? null }, permissionsFor(user)), signature);
  for (const change of [{ role: 'Researcher' as const }, { accountStatus: 'Suspended' as const }, { verification: 'Pending demo review' as const }, { passwordChangedAt: new Date().toISOString() }, { scope: { ...user.scope, canExport: !user.scope.canExport } }]) {
    assert.notEqual(accountAccessSignature({ ...user, ...change }, permissionsFor(user)), signature);
  }
  assert.equal(reauthenticationCode('__proto__'), undefined);
  assert.equal(reauthenticationCode('Invented server message'), undefined);
  assert.equal(reauthenticationCode('ACCOUNT_CHANGED'), 'ACCOUNT_CHANGED');
});

test('protected APIs reject stale roles, revoke the old session and distinguish denial from reauthentication', async () => {
  const seed = await createSeedData();
  const actor = seed.users[0];
  const store = new MemoryStore(seed);
  const sessionId = 'SES-SESSION-POLICY-TEST';
  const at = new Date().toISOString();
  await store.createSession({ id: sessionId, userId: actor.id, client: 'web', tokenHash: 'fixture', usedTokenHashes: [], csrfHash: 'fixture', expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
  const token = issueToken(actor.id, actor.role, sessionId);
  const app = express();
  app.get('/me', requireAuth, authorize(store, 'profile.read'), (_req, res) => res.json({ ok: true }));
  app.get('/manage', requireAuth, authorize(store, 'users.manage'), (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing isolated test address.');
  const request = async (path: string, bearer = token) => {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { headers: { Authorization: `Bearer ${bearer}` } });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal((await request('/manage')).status, 200);
    await store.update('users', actor.id, { role: 'Researcher' });
    assert.equal((await request('/me')).body.code, 'ACCOUNT_CHANGED');
    assert.equal((await request('/manage')).status, 401);
    assert.ok((await store.findSession(sessionId))?.revokedAt, 'A role edited outside the web UI must still invalidate its old session.');
    const nextId = 'SES-SESSION-POLICY-NEXT';
    await store.createSession({ id: nextId, userId: actor.id, client: 'web', tokenHash: 'fixture-next', usedTokenHashes: [], csrfHash: 'fixture', expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
    const nextToken = issueToken(actor.id, 'Researcher', nextId);
    assert.equal((await request('/me', nextToken)).status, 200);
    const denied = await request('/manage', nextToken);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.code, undefined, 'An ordinary permission denial is not a forced logout.');
    await store.revokeUserSessions(actor.id, at);
    assert.equal((await request('/me', nextToken)).body.code, 'SESSION_REVOKED');
    await store.update('users', actor.id, { accountStatus: 'Suspended' });
    assert.equal((await request('/me', nextToken)).body.code, 'ACCOUNT_UNAVAILABLE');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
