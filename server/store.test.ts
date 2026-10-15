import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import type { AuthSessionRecord } from './types.js';

function session(id: string, userId = 'USR-ADMIN-01', tokenHash = `hash-${id}`): AuthSessionRecord {
  return {
    id,
    userId,
    client: 'web',
    tokenHash,
    usedTokenHashes: [],
    csrfHash: `csrf-${id}`,
    expiresAt: '2099-10-08T00:00:00.000Z',
    revokedAt: null,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  };
}

test('logout revokes only a session owned by the authenticated user', async () => {
  const store = new MemoryStore(await createSeedData());
  await store.createSession(session('SES-ONE'));
  await store.createSession(session('SES-TWO'));

  assert.equal(await store.revokeSession('SES-ONE', 'USR-CONS-01', '2026-10-07T01:00:00.000Z'), false);
  assert.equal((await store.findSession('SES-ONE'))?.revokedAt, null);
  assert.equal(await store.revokeSession('SES-ONE', 'USR-ADMIN-01', '2026-10-07T01:00:00.000Z'), true);
  assert.equal((await store.findSession('SES-ONE'))?.revokedAt, '2026-10-07T01:00:00.000Z');
  assert.equal((await store.findSession('SES-TWO'))?.revokedAt, null);
});

test('refresh rotation replaces the current hash and replay revokes the session', async () => {
  const store = new MemoryStore(await createSeedData());
  await store.createSession(session('SES-ROTATE'));

  assert.equal(await store.rotateSessionToken('SES-ROTATE', 'hash-SES-ROTATE', 'hash-next', 'csrf-next', '2026-10-07T01:00:00.000Z'), 'rotated');
  const rotated = await store.findSession('SES-ROTATE');
  assert.equal(rotated?.tokenHash, 'hash-next');
  assert.equal(rotated?.csrfHash, 'csrf-next');
  assert.deepEqual(rotated?.usedTokenHashes, ['hash-SES-ROTATE']);

  assert.equal(await store.rotateSessionToken('SES-ROTATE', 'hash-SES-ROTATE', 'unused', 'unused', '2026-10-07T01:01:00.000Z'), 'replayed');
  assert.equal((await store.findSession('SES-ROTATE'))?.revokedAt, '2026-10-07T01:01:00.000Z');
});

test('access changes can revoke every active session for one user', async () => {
  const store = new MemoryStore(await createSeedData());
  await store.createSession(session('SES-ADMIN-ONE'));
  await store.createSession(session('SES-ADMIN-TWO'));
  await store.createSession(session('SES-CONSUMER', 'USR-CONS-01'));

  assert.equal(await store.revokeUserSessions('USR-ADMIN-01', '2026-10-07T02:00:00.000Z'), 2);
  assert.equal((await store.findSession('SES-ADMIN-ONE'))?.revokedAt, '2026-10-07T02:00:00.000Z');
  assert.equal((await store.findSession('SES-ADMIN-TWO'))?.revokedAt, '2026-10-07T02:00:00.000Z');
  assert.equal((await store.findSession('SES-CONSUMER'))?.revokedAt, null);
  assert.equal(await store.revokeUserSessions('USR-ADMIN-01', '2026-10-07T03:00:00.000Z'), 0);
});

test('authentication challenges are single use and newer challenges invalidate older ones', async () => {
  const store = new MemoryStore(await createSeedData());
  const base = { userId: 'USR-ADMIN-01', type: 'password_reset' as const, client: 'web' as const, expiresAt: '2099-10-08T00:00:00.000Z', consumedAt: null, createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' };
  await store.createAuthChallenge({ ...base, id: 'ACH-ONE', tokenHash: 'hash-one' });
  assert.equal(await store.invalidateAuthChallenges('USR-ADMIN-01', 'password_reset', '2026-10-07T01:00:00.000Z'), 1);
  await store.createAuthChallenge({ ...base, id: 'ACH-TWO', tokenHash: 'hash-two', createdAt: '2026-10-07T01:00:00.000Z', updatedAt: '2026-10-07T01:00:00.000Z' });
  assert.equal(await store.consumeAuthChallenge('hash-one', 'password_reset', '2026-10-07T02:00:00.000Z'), null);
  assert.equal((await store.consumeAuthChallenge('hash-two', 'password_reset', '2026-10-07T02:00:00.000Z'))?.id, 'ACH-TWO');
  assert.equal(await store.consumeAuthChallenge('hash-two', 'password_reset', '2026-10-07T02:01:00.000Z'), null);
});

test('authentication failures produce a temporary lock and can be cleared', async () => {
  const store = new MemoryStore(await createSeedData());
  let record;
  for (let attempt = 0; attempt < 5; attempt += 1) record = await store.recordRateLimitFailure('ARL-login-test', 'login', 'subject-hash', `2026-10-07T00:0${attempt}:00.000Z`, 900, 5, 900);
  assert.equal(record?.attempts, 5);
  assert.ok(record?.lockedUntil);
  await store.clearRateLimit('ARL-login-test');
  assert.equal(await store.findRateLimit('ARL-login-test'), null);
});
