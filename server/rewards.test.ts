import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { rewardQuery, rewardsPage, registerRewardRoutes } from './rewards.js';
import { SupabaseStore } from './supabaseStore.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { issueToken } from './auth.js';
import { hasPermission } from './access-control.js';
import { decodeRecord, encodeRecord } from './database/codecs.js';
import type { RewardActivity, RewardEntryType } from '../shared/rewards.js';

const members = [
  { id: 'a', name: 'Zoe', role: 'Consumer', active: true },
  { id: 'b', name: 'Ana', role: 'Consumer', active: true },
  { id: 'c', name: 'Zero', role: 'Consumer', active: true },
  { id: 'd', name: 'Negative', role: 'Consumer', active: true },
  ...['Producer', 'Recycler', 'BalikTela Hub', 'Administrator'].map(role => ({ id: role, name: role, role, active: true })),
  { id: 'inactive', name: 'Inactive', role: 'Consumer', active: false },
];
function entry(id: string, userId: string, points: number, entryType: RewardEntryType = 'earned'): RewardActivity {
  return { id, userId, points, entryType, name: 'Stale name', title: 'Reward activity', createdAt: '2026-10-20T08:00:00Z' };
}
const entries = [entry('a1', 'a', 12), entry('a2', 'a', -2, 'reversal'), entry('a3', 'a', -9, 'redemption'),
  entry('b1', 'b', 7), entry('b2', 'b', 3, 'adjustment'), entry('d1', 'd', -4, 'adjustment'),
  ...members.filter(member => member.role !== 'Consumer' || !member.active).map(member => entry(member.id, member.id, 999))];

test('rewards exactly follows Consumer eligibility, signed scoring, zero scores and competition ties', () => {
  const result = rewardsPage(members, entries, { view: 'leaderboard', page: 1, limit: 20 });
  assert.deepEqual(result.summary, { consumers: 4, consumersWithPoints: 2, accumulatedPoints: 20 });
  assert.deepEqual(result.leaderboard.map(member => [member.id, member.points, member.rank]), [['b', 10, 1], ['a', 10, 1], ['d', 0, 3], ['c', 0, 3]]);
  const second = rewardsPage(members, entries, { view: 'leaderboard', page: 2, limit: 1 });
  assert.deepEqual(second.leaderboard, [result.leaderboard[1]]); assert.equal(second.leaderboard[0].rank, 1);
  assert.equal(second.total, 4); assert.equal(second.pages, 4);
  assert.equal(rewardsPage(members, entries, { view: 'leaderboard', page: 99, limit: 1 }).page, 4);
});

test('activity preserves signed entries, redemptions, current names, deterministic paging and cohort', () => {
  const result = rewardsPage(members, entries, { view: 'activity', page: 1, limit: 2 });
  assert.deepEqual(result.activity.map(row => row.id), ['d1', 'b2']);
  assert.equal(result.activity[0].points, -4); assert.equal(result.activity[1].name, 'Ana');
  assert.equal(result.total, 6); assert.deepEqual(result.leaderboard, []);
  assert.equal(rewardsPage(members, entries, { view: 'activity', page: 2, limit: 2 }).activity[1].entryType, 'redemption');
  assert.deepEqual(rewardsPage([], [], { view: 'activity', page: 9, limit: 20 }), {
    view: 'activity', summary: { consumers: 0, consumersWithPoints: 0, accumulatedPoints: 0 }, leaderboard: [], activity: [], total: 0, page: 1, pages: 1, limit: 20,
  });
});

test('rewards query rejects malformed/unbounded pages, arrays and invalid tabs', () => {
  assert.deepEqual(rewardQuery({}), { view: 'leaderboard', page: 1, limit: 20 });
  for (const query of [{ page: '0' }, { limit: '101' }, { page: ['1'] }, { page: '1.5' }, { page: '99999999999999999999' }, { view: 'wallet' }, { limit: '' }]) assert.throws(() => rewardQuery(query));
});

test('reversal codec preserves its identity and signed points', () => {
  const record = decodeRecord('walletEntries', { _id: 'R', user_id: 'U', entry_type: 'reversal', points: -5, title: 'Reversal', created_at: new Date() });
  assert.equal(record.type, 'Reversal'); assert.equal(encodeRecord('walletEntries', record).entry_type, 'reversal'); assert.equal(record.credits, -5);
});

test('Supabase rewards uses one bounded aggregate RPC, never loads the full dashboard or ledger', async () => {
  let calls = 0;
  const expected = rewardsPage(members, entries, { view: 'activity', page: 2, limit: 2 });
  const store = new SupabaseStore('https://example.supabase.co', 'test-secret', async (input, options) => {
    calls++; assert.match(String(input), /\/rpc\/dashboard_rewards$/); assert.equal(options?.method, 'POST');
    assert.deepEqual(JSON.parse(String(options?.body)), { p_view: 'activity', p_page: 2, p_limit: 2 });
    return Response.json(expected);
  });
  assert.deepEqual(await store.loadRewards({ view: 'activity', page: 2, limit: 2 }), expected); assert.equal(calls, 1);
  const denied = new SupabaseStore('https://example.supabase.co', 'test-secret', async () => Response.json({ code: '42501', message: 'private details' }, { status: 403 }));
  await assert.rejects(denied.loadRewards({ view: 'leaderboard', page: 1, limit: 20 }), /could not read dashboard rewards/);
});

test('rewards API is admin-only, read-only, validates pagination and never writes records', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed), before = structuredClone(seed);
  const app = express(); registerRewardRoutes(app, store);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/rewards`)).status, 401);
    for (const user of seed.users) {
      const now = new Date().toISOString(), sessionId = `REWARDS-${user.id}`;
      await store.createSession({ id: sessionId, userId: user.id, client: 'api', tokenHash: 'test', usedTokenHashes: [], csrfHash: 'test', createdAt: now, updatedAt: now, expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null });
      const headers = { authorization: `Bearer ${issueToken(user.id, user.role, sessionId)}` };
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/api/rewards`, { headers });
      const admin = user.role === 'Administrator';
      assert.equal(hasPermission(user, 'rewards.read'), admin); assert.equal(response.status, admin ? 200 : 403);
      if (admin) {
        assert.match(response.headers.get('cache-control')!, /no-store/);
        const result = await response.json(); assert.ok(result.leaderboard.every((member: { id: string }) => seed.users.find(row => row.id === member.id)?.role === 'Consumer'));
        assert.equal(JSON.stringify(result).includes('@'), false);
        assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/rewards?limit=101`, { headers })).status, 400);
        assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/rewards`, { method: 'POST', headers })).status, 404);
      }
    }
    assert.deepEqual(seed, before);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
