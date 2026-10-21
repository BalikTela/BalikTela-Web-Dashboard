import type { Express } from 'express';
import { authorize } from './access-control.js';
import { requireAuth } from './auth.js';
import { ManagementError } from './management.js';
import type { Store } from './store.js';
import type { RewardActivity, RewardQuery, RewardsPage } from '../shared/rewards.js';
import { paginationWindow } from '../shared/pagination.js';

export function rewardQuery(query: Record<string, unknown>): RewardQuery {
  const view = query.view ?? 'leaderboard';
  if (view !== 'leaderboard' && view !== 'activity') throw new ManagementError('Select a valid rewards view.');
  const integer = (value: unknown, fallback: number, maximum: number) => {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1 || Number(value) > maximum)
      throw new ManagementError('Select a valid rewards page and page size.');
    return Number(value);
  };
  return { view, page: integer(query.page, 1, 2147483647), limit: integer(query.limit, 20, 100) };
}

// Reference implementation for local stores; Supabase performs aggregation and pagination in SQL.
export function rewardsPage(members: { id: string; name: string; role: string; active: boolean }[], entries: RewardActivity[], query: RewardQuery): RewardsPage {
  const eligible = new Map(members.filter(member => member.active && member.role === 'Consumer').map(member => [member.id, member]));
  const activity = entries.filter(entry => eligible.has(entry.userId)).map(entry => ({ ...entry, name: eligible.get(entry.userId)!.name }))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
  const points = new Map<string, number>();
  for (const entry of activity) if (entry.entryType !== 'redemption') points.set(entry.userId, (points.get(entry.userId) ?? 0) + entry.points);
  const leaderboard = [...eligible.values()].map(member => ({ id: member.id, name: member.name, points: Math.max(0, points.get(member.id) ?? 0), rank: 0 }))
    .sort((a, b) => b.points - a.points || a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id));
  let rank = 0;
  for (let index = 0; index < leaderboard.length; index++) {
    if (!index || leaderboard[index - 1].points !== leaderboard[index].points) rank++;
    leaderboard[index].rank = rank;
  }
  const window = paginationWindow(query.view === 'leaderboard' ? leaderboard.length : activity.length, query.page, query.limit);
  return { view: query.view, summary: { consumers: leaderboard.length, consumersWithPoints: leaderboard.filter(member => member.points > 0).length,
    accumulatedPoints: leaderboard.reduce((sum, member) => sum + member.points, 0) },
    leaderboard: query.view === 'leaderboard' ? leaderboard.slice(window.start, window.end) : [],
    activity: query.view === 'activity' ? activity.slice(window.start, window.end) : [],
    total: window.total, page: window.page, pages: window.pages, limit: query.limit };
}

export async function loadRewards(store: Store, query: RewardQuery): Promise<RewardsPage> {
  if (store.loadRewards) return store.loadRewards(query);
  const members = (await store.all('users')).map(user => ({ id: user.id, name: user.fullName, role: user.role, active: !['Suspended', 'Deactivated'].includes(user.accountStatus) }));
  const entries = (await store.all('walletEntries')).map(entry => ({ id: entry.id, userId: entry.userId, name: '', title: entry.description, points: entry.credits,
    entryType: ({ Earned: 'earned', Redeemed: 'redemption', Reversal: 'reversal', Adjustment: 'adjustment' } as const)[entry.type], createdAt: entry.createdAt }));
  return rewardsPage(members, entries, query);
}

export function registerRewardRoutes(app: Express, store: Store) {
  app.get('/api/rewards', requireAuth, authorize(store, 'rewards.read'), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(await loadRewards(store, rewardQuery(req.query)));
  });
}
