import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import express from 'express';
import postgres from 'postgres';
import { issueToken } from '../server/auth.js';
import { hasPermission } from '../server/access-control.js';
import { decodeRecord } from '../server/database/codecs.js';
import { canonicalMutations, rememberCanonicalRow, type RecordMutation } from '../server/database/mutations.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { registerHubRoutes, buildWeighingMonitoring } from '../server/hubs.js';
import { MemoryStore } from '../server/store.js';
import type { DatabaseShape, UserRecord } from '../server/types.js';

// These fixtures never commit. Do not replace the deliberate rollback with cleanup deletes.
if (!process.argv.includes('--rollback-only')) throw new Error('Use --rollback-only to acknowledge the transaction-only test.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required.');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-hub-rollback-test' } });
const runId = randomUUID();
const accountType = process.argv.includes('--legacy-hub-signup') ? 'hub' : 'recycler';
// The current mobile contract uses Recycler for weighing operators, including legacy Hub signups.
const operatorRole = 'Recycler';
const authIds = ['admin', 'hub', 'owner', 'recipient'].map(() => randomUUID());
const rolledBack = new Error('Intentional integration-test rollback');
const checks: string[] = [];
const stages: Array<Record<string, unknown>> = [];
let report: Record<string, unknown> | undefined;
const emptyData = (): DatabaseShape => ({ users: [], organizations: [], facilities: [], materialBatches: [], measurements: [], listings: [],
  offers: [], transfers: [], recoveryRecords: [], conversations: [], messages: [], walletEntries: [], auditRecords: [], systemInteractions: [], configurations: [] });
type Row = Record<string, any>;
type Tx = postgres.TransactionSql;
const decode = (name: keyof DatabaseShape, row: Row) => rememberCanonicalRow(decodeRecord(name, { ...row, _id: row.id }), { ...row, _id: row.id });

try {
  try {
    await sql.begin(async tx => {
      await tx.unsafe("SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='60s'");
      // Refuse a busy workflow rather than waiting behind an active mobile operation.
      const [lock] = await tx`select pg_try_advisory_xact_lock(684219570) available`;
      assert.equal(lock.available, true, 'Mobile workflow is busy; rerun the test later.');
      const [before] = await tx`select count(*)::int n from public.users where auth_user_id in ${tx(authIds)}`;
      assert.equal(before.n, 0);
      for (const [index, label] of ['admin', 'hub', 'owner', 'recipient'].entries()) {
        await tx`insert into auth.users(id,email,role,aud,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
          values(${authIds[index]},${`hub-check-${runId}-${label}@example.invalid`},'authenticated','authenticated',
            ${tx.json({ name: `Hub integration ${label} (test)`, account_type: label === 'hub' ? accountType : 'consumer',
              role: 'Administrator', organization_verified: true, location: 'Test location; no physical facility' })},'{}',now(),now())`;
      }
      const profiles = await tx`select id,auth_user_id,role,organization_verified from public.users where auth_user_id in ${tx(authIds)}`;
      assert.equal(profiles.length, 4);
      const profile = (index: number) => profiles.find(row => row.auth_user_id === authIds[index])!;
      assert.equal(profile(1).role, operatorRole);
      assert.equal(profile(1).organization_verified, false);
      assert.equal(profile(2).role, 'Consumer', 'Signup metadata must not self-assign administrator access.');
      await tx`update public.users set role='Administrator',verification_status='verified' where id=${profile(0).id}`;
      await tx`update auth.users set email_confirmed_at=now() where id in ${tx([authIds[0], authIds[2], authIds[3]])}`;

      const data = emptyData();
      const refresh = async () => {
        const [result] = await tx`select public.get_dashboard_source_snapshot() snapshot`;
        const snapshot = result.snapshot as Row;
        const userIds = new Set(profiles.map(row => row.id));
        const batchIds = new Set(snapshot.materialBatches.filter((row: Row) => userIds.has(row.source_user_id)).map((row: Row) => row.id));
        const mapping = { materialBatches: 'materialBatches', listings: 'listings', offers: 'offers', transfers: 'transfers',
          measurements: 'measurements', recoveryRecords: 'recoveryRecords', walletEntries: 'walletEntries', systemInteractions: 'systemInteractions' } as const;
        for (const [name, key] of Object.entries(mapping)) {
          const rows = (snapshot[key] ?? []).filter((row: Row) => batchIds.has(name === 'materialBatches' ? row.id : row.batch_id)
            || (name === 'walletEntries' && userIds.has(row.user_id)) || (name === 'systemInteractions' && userIds.has(row.actor_id)));
          (data[name as keyof DatabaseShape] as unknown[]) = rows.map((row: Row) => decode(name as keyof DatabaseShape, row));
        }
        const users = await tx`select to_jsonb(u)||jsonb_build_object('_security',to_jsonb(s)) row
          from public.users u left join public.auth_account_security s on s.user_id=u.id where u.auth_user_id in ${tx(authIds)}`;
        data.users = users.map(({ row }) => decode('users', row) as UserRecord);
      };
      await refresh();
      class TransactionStore extends MemoryStore {
        override async commit(mutations: RecordMutation[]) {
          assert.ok(mutations.every(mutation => mutation.name === 'auditRecords' || (mutation.name === 'users' && profiles.some(row => row.id === mutation.record.id))),
            'The web test may change only its own fixture users and audit records.');
          await tx`select public.apply_management_mutations(${tx.json(canonicalMutations(mutations) as any)})`;
          await refresh();
        }
      }
      const store = new TransactionStore(data);
      const user = (index: number) => data.users.find(row => row.id === profile(index).id)!;
      const app = express(); app.use(express.json()); registerHubRoutes(app, store);
      app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(error.status ?? 500).json({ message: error.message });
      });
      const server = app.listen(0, '127.0.0.1');
      await new Promise<void>(resolve => server.once('listening', resolve));
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const token = async (account: UserRecord, suffix: string) => {
        const at = new Date().toISOString(); const id = `SES-${runId}-${suffix}`;
        await store.createSession({ id, userId: account.id, client: 'api', tokenHash: 'isolated-test', usedTokenHashes: [], csrfHash: 'isolated-test',
          expiresAt: new Date(Date.now() + 300_000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
        return issueToken(account.id, account.role, id);
      };
      const adminToken = await token(user(0), 'ADMIN');
      const pendingHubToken = await token(user(1), 'PENDING');
      const web = async (path: string, bearer = adminToken, body?: Row) => {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/${path}`, { method: body ? 'PATCH' : 'GET',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
        return { status: response.status, body: await response.json() as Row };
      };
      const asMobile = async (index: number, operation: (connection: Tx) => Promise<any>) => {
        await tx`select set_config('request.jwt.claim.sub',${authIds[index]},true),
          set_config('request.jwt.claims',${JSON.stringify({ sub: authIds[index], role: 'authenticated' })},true)`;
        await tx.unsafe('SET LOCAL ROLE authenticated');
        const result = await operation(tx);
        await tx.unsafe('RESET ROLE');
        return result;
      };
      const mutate = async (index: number, resource: string, body: Row = {}, key = randomUUID(), method = 'POST') => asMobile(index, async connection => {
        const [row] = await connection`select public.mobile_mutate(${method},${resource},${connection.json(body)},${`${runId}:${key}`}) result`;
        return row.result.data as Row;
      });
      const read = async (index: number, resource: string) => asMobile(index, async connection => {
        const [row] = await connection`select public.mobile_read(${resource},'{}'::jsonb) result`;
        return row.result.data as Row;
      });
      const denied = async (operation: () => Promise<any>, pattern: RegExp) => {
        // The SQL savepoint also restores the role after an expected RPC error.
        await assert.rejects(tx.savepoint(async () => operation()), pattern);
      };
      const reconcile = async (name: string, expectedStatus?: string) => {
        await refresh();
        const monitoring = await buildWeighingMonitoring(store, user(0), { dateRange: 'All time' });
        const analytics = await buildDashboardAnalytics(store, user(0), { dateRange: 'All time' });
        if (expectedStatus) assert.equal(data.transfers[0].canonicalStatus, expectedStatus);
        assert.equal(analytics.circularFlow.recycledKg + analytics.circularFlow.reusedKg, 0,
          'Hub weighing and estimated transfer completion must not invent verified diversion.');
        stages.push({ name, status: expectedStatus ?? null, awaiting: monitoring.summary.awaiting,
          latestWeighedKg: monitoring.summary.latestWeighedKg, measurements: monitoring.summary.measurements,
          verifiedDiversionKg: analytics.circularFlow.recycledKg + analytics.circularFlow.reusedKg });
        return { monitoring, analytics };
      };
      try {
        assert.equal((await web('weighing', pendingHubToken)).status, 403, 'Unconfirmed accounts cannot read monitoring.');
        assert.equal((await web(`hubs/${profile(1).id}`, pendingHubToken, { action: 'approve', reason: 'Self promotion test' })).status, 403);
        assert.equal((await web(`hubs/${profile(1).id}`, adminToken, { action: 'approve', reason: 'Unconfirmed email test' })).status, 409);
        await denied(() => mutate(1, 'users/me', { role: 'Administrator', organization_verified: true }, randomUUID(), 'PATCH'), /Profile field cannot be changed/);
        await tx`update auth.users set email_confirmed_at=now() where id=${authIds[1]}`;
        await refresh();
        assert.equal((await tx`select count(*)::int n from public.users where auth_user_id=${authIds[1]}`)[0].n, 1);
        assert.equal(user(1).role, operatorRole);
        const approval = await web(`hubs/${profile(1).id}`, adminToken, { action: 'approve', reason: 'Rollback-only integration review; synthetic operator' });
        assert.equal(approval.status, 200, JSON.stringify(approval.body));
        assert.equal(user(1).organizationVerified, true);
        assert.equal((await web('weighing', pendingHubToken)).status, 401, 'Approval must invalidate the previous web session.');
        assert.equal((await read(1, 'auth/me')).organization_verified, true);
        assert.equal(hasPermission(user(1), 'hubs.manage'), false);
        checks.push('Signup trigger, no metadata self-promotion, confirmation idempotency, real web approval route, approval session revocation');

        const listingKey = randomUUID();
        const payload = { title: 'Hub integration cotton (test; rolled back)', description: 'Synthetic test; no physical textiles.',
          category: 'Cotton', condition: 'Good', waste_source: 'Pre-consumer', waste_form: 'Offcuts', pathway: 'Reuse',
          location: 'Test city, Test region', media: [], delivery_route: 'via_hub', weighing_hub_id: profile(1).id };
        const listing = await mutate(2, 'listings', payload, listingKey);
        assert.equal((await mutate(2, 'listings', payload, listingKey)).id, listing.id);
        assert.equal(listing.available_weight_kg, null);
        assert.equal((await reconcile('Awaiting Hub weighing')).monitoring.summary.awaiting, 1);
        await denied(() => mutate(3, 'match-requests', { listing_id: listing.id, requested_kg: 125.5 }), /unavailable|availability/);
        await denied(() => mutate(2, `listings/${listing.id}/weigh`, { weight_kg: 125.5, weight_status: 'Verified', note: 'Unauthorized synthetic weighing' }), /Only verified|Only the owner|approved|assigned to another/);
        const weighKey = randomUUID();
        const weighing = { weight_kg: 125.5, weight_status: 'Verified', note: 'Synthetic scale S-TEST; rollback-only, no physical measurement' };
        await mutate(1, `listings/${listing.id}/weigh`, weighing, weighKey);
        await mutate(1, `listings/${listing.id}/weigh`, weighing, weighKey);
        const weighed = await reconcile('Hub weighed');
        assert.equal(weighed.monitoring.summary.latestWeighedKg, 125.5);
        assert.equal(weighed.monitoring.summary.measurements, 1);
        const evidence = weighed.monitoring.history[0];
        assert.equal(evidence.operatorId, profile(1).id); assert.equal(evidence.batchId, listing.batch_id);
        assert.equal(evidence.listingId, listing.id); assert.equal(evidence.facilityId, null);
        assert.equal(evidence.stage, 'listing'); assert.equal(evidence.weightStatus, 'Verified');
        assert.ok(Number.isFinite(Date.parse(evidence.measuredAt)));
        const hubToken = await token(user(1), 'APPROVED');
        assert.equal((await web('weighing', hubToken)).body.history[0].id, evidence.id);
        checks.push('Mobile listing and weighing RPCs, unknown mass, matching IDs/timestamps/operator, exact stock, duplicate-submit idempotency');

        const request = await mutate(3, 'match-requests', { listing_id: listing.id, requested_kg: 125.5, terms: 'Synthetic integration transfer' });
        await mutate(2, `match-requests/${request.id}/accepted`);
        await reconcile('Accepted reservation', 'reserved');
        assert.equal(Number((await read(2, `listings/${listing.id}`)).reserved_kg), 125.5);
        await denied(() => mutate(1, `listings/${listing.id}/weigh`, weighing), /transfer|edited/);
        await denied(() => mutate(3, `match-requests/${request.id}/handover`), /Owner handover/);
        await mutate(2, `match-requests/${request.id}/handover`, { note: 'Synthetic provider handover; agreed quantity only' });
        await reconcile('Provider handover', 'handed_over');
        await mutate(3, `match-requests/${request.id}/receipt`, { note: 'Synthetic recipient receipt; agreed quantity only' });
        await reconcile('Recipient receipt', 'received');
        const completeKey = randomUUID();
        await mutate(2, `match-requests/${request.id}/complete`, {}, completeKey);
        await mutate(2, `match-requests/${request.id}/complete`, {}, completeKey);
        const completed = await reconcile('Completed transfer', 'completed');
        const transfer = await read(2, `transfers/${request.id}`);
        assert.equal(transfer.id, data.transfers[0].id); assert.equal(transfer.batch_id, listing.batch_id);
        assert.equal(data.transfers[0].verifiedWeightKg, null);
        assert.equal(data.transfers[0].receiptWeightKg, 125.5);
        assert.equal(completed.analytics.sharedActivity.completionAwaitingVerification, 1);
        assert.equal(completed.analytics.barterMetrics.rewardCredits, 0);
        assert.equal(data.measurements.length, 1, 'Estimated handover/receipt must not manufacture scale measurements.');
        const stock = await read(2, `listings/${listing.id}`);
        assert.equal(Number(stock.available_weight_kg), 0); assert.equal(Number(stock.reserved_kg), 0);
        assert.deepEqual(data.transfers[0].events.map(event => event.canonicalStage), ['reserved', 'handover', 'receipt', 'completion']);
        assert.equal(new Set(data.transfers[0].events.map(event => event.id)).size, 4);
        checks.push('Accepted → handed over → received → completed, role boundaries, stock conservation, no duplicate flow events or rewards');

        const revoked = await web(`hubs/${profile(1).id}`, adminToken, { action: 'revoke', reason: 'Rollback-only revocation test' });
        assert.equal(revoked.status, 200);
        assert.equal((await web('weighing', hubToken)).status, 401);
        assert.equal((await read(1, 'auth/me')).organization_verified, false);
        // The internal permission helper is deliberately not granted to authenticated clients.
        const [permission] = await tx`select public.mobile_can_weigh(u) allowed from public.users u where u.id=${profile(1).id}`;
        assert.equal(permission.allowed, false);
        checks.push('Revocation visible to mobile, stale web session denied, no verified diversion from a Hub scale alone');
        report = { result: 'passed', runId, operatorRole, accountType, mode: 'live-installed-functions / rollback-only',
          scope: 'Actual SQL signup trigger/mobile RPCs and web approval route; not email delivery or a deployed mobile browser test',
          checks, stages, fixture: { users: 4, batches: data.materialBatches.length, listings: data.listings.length,
            transfers: data.transfers.length, hubMeasurements: data.measurements.length, weightKg: 125.5, weightTonnes: 0.1255,
            rewardCredits: completed.analytics.barterMetrics.rewardCredits },
          committedBusinessChanges: 0, emailMessagesSent: 0 };
        report.sharedFunctionChanges = 0;
      } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
      throw rolledBack;
    });
  } catch (error) { if (error !== rolledBack) throw error; }
  assert.ok(report);
  const [remaining] = await sql`select
    (select count(*) from auth.users where id in ${sql(authIds)})::int identities,
    (select count(*) from public.users where auth_user_id in ${sql(authIds)})::int profiles,
    (select count(*) from public.mobile_sync_receipts where auth_user_id in ${sql(authIds)})::int receipts`;
  assert.deepEqual({ ...remaining }, { identities: 0, profiles: 0, receipts: 0 });
  report.rollbackVerified = true;
  await mkdir('/tmp/baliktela-hub-integration', { recursive: true });
  const reportName = accountType === 'recycler' ? 'result-recycler.json' : 'result-legacy-hub.json';
  await writeFile(`/tmp/baliktela-hub-integration/${reportName}`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await sql.end({ timeout: 5 }); }
