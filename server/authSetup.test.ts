import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { createPasswordSetupGrant, registerSetupRoutes } from './authSetup.js';
import { hashSessionToken } from './auth.js';
import { hasPermission } from './access-control.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';

async function fixture() {
  const store = new MemoryStore(await createSeedData());
  const userId = 'USR-RESEARCH-01';
  await store.update('users', userId, { authUserId: 'auth-invitee', passwordChangedAt: null, emailVerifiedAt: null, accountStatus: 'Pending verification' });
  let verifications = 0;
  let sends = 0;
  let consumed = false;
  const app = express();
  app.use(express.json());
  registerSetupRoutes(app, { store, enabled: true, identity: {
    requestSetupCode: async () => { sends++; },
    verifySetupCode: async (authUserId, email, code) => {
      verifications++;
      if (code !== '123456' || consumed) { const error = new Error('Provider detail must not leak.'); error.name = 'SupabaseAuthError'; throw error; }
      consumed = true;
      return { authUserId, email, emailConfirmedAt: new Date().toISOString() };
    },
  } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address.');
  return {
    store, userId, counters: () => ({ sends, verifications }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    post: (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${address.port}/api/auth/setup/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  };
}

test('re-resolving the same provider session cannot mint a second grant or invalidate the original', async () => {
  const store = new MemoryStore(await createSeedData());
  const token = await createPasswordSetupGrant(store, 'USR-RESEARCH-01', 'native-invitation-session');
  await assert.rejects(createPasswordSetupGrant(store, 'USR-RESEARCH-01', 'native-invitation-session'));
  assert.ok(await store.consumeAuthChallenge(hashSessionToken(token), 'password_reset', new Date().toISOString()));
  assert.equal(await store.consumeAuthChallenge(hashSessionToken(token), 'password_reset', new Date().toISOString()), null);
});

test('code proof issues only a hashed single-use password grant, not dashboard credentials', async () => {
  const f = await fixture();
  try {
    const response = await f.post('verify', { email: 'RESEARCHER@baliktela.demo ', code: '123456', purpose: 'invite' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ['email', 'expiresInSeconds', 'intent', 'setupToken']);
    assert.equal(result.expiresInSeconds, 600);
    const user = await f.store.findById('users', f.userId);
    assert.ok(user?.emailVerifiedAt);
    assert.equal(user?.passwordChangedAt, null);
    assert.equal(user?.accountStatus, 'Pending verification');
    assert.equal(hasPermission(user!, 'analytics.read'), false);
    const challenge = await f.store.consumeAuthChallenge(hashSessionToken(result.setupToken), 'password_reset', new Date().toISOString());
    assert.ok(challenge);
    assert.notEqual(challenge.tokenHash, result.setupToken);
    assert.equal(Date.parse(challenge.expiresAt) - Date.parse(challenge.createdAt), 600_000);
    assert.equal(await f.store.consumeAuthChallenge(hashSessionToken(result.setupToken), 'password_reset', new Date().toISOString()), null);
    assert.equal((await f.post('verify', { email: result.email, code: '123456', purpose: 'invite' })).status, 400);
  } finally { await f.close(); }
});

test('code guesses are bounded even for unknown accounts, with generic provider errors', async () => {
  const f = await fixture();
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await f.post('verify', { email: 'researcher@baliktela.demo', code: '000000', purpose: 'invite' });
      assert.equal(response.status, 400);
      assert.doesNotMatch((await response.json()).message, /Provider detail/);
    }
    const blocked = await f.post('verify', { email: 'researcher@baliktela.demo', code: '123456', purpose: 'invite' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal(f.counters().verifications, 5);
    assert.equal((await f.post('verify', { email: 'unknown@example.test', code: '123456', purpose: 'invite' })).status, 400);
  } finally { await f.close(); }
});

test('disabled and initialized invitees cannot use original-invitation codes', async () => {
  const f = await fixture();
  try {
    await f.store.update('users', f.userId, { accountStatus: 'Suspended' });
    assert.equal((await f.post('verify', { email: 'researcher@baliktela.demo', code: '123456', purpose: 'invite' })).status, 400);
    await f.store.update('users', f.userId, { accountStatus: 'Active', passwordChangedAt: new Date().toISOString() });
    assert.equal((await f.post('verify', { email: 'researcher@baliktela.demo', code: '123456', purpose: 'invite' })).status, 400);
    assert.equal(f.counters().verifications, 0);
    assert.equal((await f.post('verify', { email: 'researcher@baliktela.demo', code: '123456', purpose: 'recovery' })).status, 200);
  } finally { await f.close(); }
});

test('resend limits delivery requests and invalidates prior password grants without enumerating accounts', async () => {
  const f = await fixture();
  try {
    const verified = await (await f.post('verify', { email: 'researcher@baliktela.demo', code: '123456', purpose: 'invite' })).json();
    const expected = await (await f.post('request', { email: 'unknown@example.test' })).json();
    for (let request = 0; request < 5; request++) {
      const response = await f.post('request', { email: 'researcher@baliktela.demo' });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), expected);
    }
    assert.equal(f.counters().sends, 3);
    assert.equal(await f.store.consumeAuthChallenge(hashSessionToken(verified.setupToken), 'password_reset', new Date().toISOString()), null);
  } finally { await f.close(); }
});
