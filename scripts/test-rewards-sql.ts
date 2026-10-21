import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config, parse } from 'dotenv';
import postgres from 'postgres';
import { rewardsPage } from '../server/rewards.js';
import type { RewardActivity, RewardView } from '../shared/rewards.js';

config({ path: '.env.supabase', quiet: true });
assert.equal(process.env.SUPABASE_URL, parse(readFileSync('.env')).SUPABASE_URL, 'Database profile must match the dashboard.');
if (!process.env.SUPABASE_DB_URL) throw new Error('Database profile is required.');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 20 });
const migration = readFileSync('supabase/migrations/20261021040000_dashboard_rewards.sql', 'utf8');
const denseMigration = readFileSync('supabase/migrations/20261022002000_dashboard_rewards_dense_ranking.sql', 'utf8')
  .replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const rollback = new Error('Rewards regression rollback');
const normalize = (value: any) => ({ ...value, activity: value.activity.map((entry: RewardActivity) => ({ ...entry, createdAt: new Date(entry.createdAt).toISOString() })) });
try {
  const originalFunctions = await sql`select oid::text, pg_get_functiondef(oid) definition from pg_proc where oid in (to_regprocedure('public.mobile_award_listing_points()'), to_regprocedure('public.mobile_points_leaderboard(integer,integer)')) order by oid`;
  assert.equal(originalFunctions.length, 2, 'Mobile rewards migration must be installed.');
  try {
    await sql.begin(async tx => {
      await tx.unsafe(migration);
      await tx.unsafe(denseMigration);
      const [permissions] = await tx`select has_function_privilege('anon','public.dashboard_rewards(text,integer,integer)','EXECUTE') anon,
        has_function_privilege('authenticated','public.dashboard_rewards(text,integer,integer)','EXECUTE') authenticated,
        has_function_privilege('service_role','public.dashboard_rewards(text,integer,integer)','EXECUTE') service`;
      assert.deepEqual(permissions, { anon: false, authenticated: false, service: true });
      const [actor] = await tx`select auth_user_id from public.users where active and role='Administrator' and auth_user_id is not null and account_status not in ('suspended','deactivated') limit 1`;
      assert.ok(actor, 'An existing admin profile is required for read-only mobile parity.');
      // Test-only local JWT claims; no login, role changes or production impersonation route.
      await tx`select set_config('request.jwt.claim.sub', ${actor.auth_user_id}, true), set_config('request.jwt.claims', ${JSON.stringify({ sub: actor.auth_user_id, role: 'authenticated' })}, true)`;
      for (const limit of [1, 20, 100]) for (const page of [1, 2, 99]) {
        const [web] = await tx`select public.dashboard_rewards('leaderboard', ${page}, ${limit}) value`;
        const [mobile] = await tx`select public.mobile_points_leaderboard(${web.value.page}, ${limit}) value`;
        assert.equal(web.value.total, mobile.value.total);
        assert.deepEqual(web.value.leaderboard.map(({rank:_rank,...member}:{rank:number})=>member),
          mobile.value.data.map(({role:_role,rank:_rank,...member}:{role:string;rank:number})=>member));
        assert.equal(mobile.value.me, null);
      }
      await tx.unsafe('create temporary table reward_members(id text primary key,name text,role text,active boolean) on commit drop');
      await tx.unsafe('create temporary table reward_entries(id text primary key,user_id text,title text,points integer,entry_type text,created_at timestamptz) on commit drop');
      const [definition] = await tx`select pg_get_functiondef('public.dashboard_rewards(text,integer,integer)'::regprocedure) source`;
      const fixtureFunction = definition.source.replaceAll('public.dashboard_rewards', 'pg_temp.reward_fixture')
        .replaceAll('public.users', 'pg_temp.reward_members').replaceAll('public.reward_ledger', 'pg_temp.reward_entries');
      await tx.unsafe(fixtureFunction);
      const members = [
        { id: 'a', name: 'Zoe', role: 'Consumer', active: true }, { id: 'b', name: 'Ana', role: 'Consumer', active: true },
        { id: 'c', name: 'Zero', role: 'Consumer', active: true }, { id: 'd', name: 'Negative', role: 'Consumer', active: true },
        ...['Producer', 'Recycler', 'BalikTela Hub', 'Administrator'].map(role => ({ id: role, name: role, role, active: true })),
        { id: 'inactive', name: 'Inactive', role: 'Consumer', active: false },
      ];
      const entries: RewardActivity[] = [
        { id: 'a1', userId: 'a', name: '', title: 'Publish direct', points: 5, entryType: 'earned', createdAt: '2026-10-20T08:00:00Z' },
        { id: 'a2', userId: 'a', name: '', title: 'Adjustment', points: 7, entryType: 'adjustment', createdAt: '2026-10-20T08:00:00Z' },
        { id: 'a3', userId: 'a', name: '', title: 'Reversal', points: -2, entryType: 'reversal', createdAt: '2026-10-20T08:00:00Z' },
        { id: 'a4', userId: 'a', name: '', title: 'Redeemed', points: -9, entryType: 'redemption', createdAt: '2026-10-20T08:00:00Z' },
        { id: 'b1', userId: 'b', name: '', title: 'Earned', points: 10, entryType: 'earned', createdAt: '2026-10-20T08:00:00Z' },
        { id: 'd1', userId: 'd', name: '', title: 'Adjustment', points: -4, entryType: 'adjustment', createdAt: '2026-10-20T08:00:00Z' },
        ...members.filter(member => member.role !== 'Consumer' || !member.active).map(member => ({ id: member.id, userId: member.id, name: '', title: 'Excluded', points: 999, entryType: 'earned' as const, createdAt: '2026-10-20T08:00:00Z' })),
      ];
      for (const member of members) await tx`insert into reward_members values(${member.id},${member.name},${member.role},${member.active})`;
      for (const entry of entries) await tx`insert into reward_entries values(${entry.id},${entry.userId},${entry.title},${entry.points},${entry.entryType},${entry.createdAt})`;
      for (const view of ['leaderboard', 'activity'] as RewardView[]) for (const limit of [1, 2, 20]) for (const page of [1, 2, 99]) {
        const [row] = await tx`select pg_temp.reward_fixture(${view},${page},${limit}) value`;
        assert.deepEqual(normalize(row.value), normalize(rewardsPage(members, entries, { view, page, limit })));
      }
      await tx`delete from reward_members`;
      const [empty] = await tx`select pg_temp.reward_fixture('activity',99,20) value`;
      assert.deepEqual(normalize(empty.value), normalize(rewardsPage([], entries, { view: 'activity', page: 99, limit: 20 })));
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
  if (process.argv.includes('--apply')) await sql.begin(async tx => { await tx.unsafe(migration); await tx.unsafe(denseMigration); });
  const afterFunctions = await sql`select oid::text, pg_get_functiondef(oid) definition from pg_proc where oid in (to_regprocedure('public.mobile_award_listing_points()'), to_regprocedure('public.mobile_points_leaderboard(integer,integer)')) order by oid`;
  assert.deepEqual(afterFunctions, originalFunctions);
  console.log(JSON.stringify({ mobileScoresAndOrderingParity: 'passed', denseRankingAndPagination: 'passed', scoringAndPaginationFixtures: 'passed', serviceOnlyAccess: 'passed', mobileFunctionsUnchanged: true,
    permanentAccountOrRewardWrites: 0, readOnlyAdapterApplied: process.argv.includes('--apply') }, null, 2));
} finally { await sql.end(); }
