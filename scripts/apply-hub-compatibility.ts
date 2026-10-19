import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

if (!process.argv.includes('--apply')) throw new Error('Use --apply to apply the approved Hub compatibility migration.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required.');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-hub-compatibility' } });
const migration = await readFile(new URL('../supabase/migrations/20261018090000_hub_role_compatibility.sql', import.meta.url), 'utf8');
const evidence = process.argv.includes('--evidence') ? await readFile(new URL('../supabase/migrations/20261018091000_dashboard_mobile_evidence.sql', import.meta.url), 'utf8') : '';
const signup = process.argv.includes('--signup') ? await readFile(new URL('../supabase/migrations/20261018092000_hub_signup_alignment.sql', import.meta.url), 'utf8') : '';
try {
  const result = await sql.begin(async tx => {
    await tx.unsafe("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '60s'");
    await tx`select pg_advisory_xact_lock(684219570)`;
    const counts = async () => (await tx`select
      (select count(*) from public.users) users,
      (select count(*) from public.listings) listings,
      (select count(*) from public.measurements) measurements,
      (select count(*) from public.transfers) transfers,
      (select count(*) from public.material_batches) batches,
      (select count(*) from public.reward_ledger) rewards`)[0];
    const before = await counts();
    await tx.unsafe(migration);
    if (evidence) await tx.unsafe(evidence);
    if (signup) await tx.unsafe(signup);
    for (const role of ['Recycler', 'BalikTela Hub', 'Consumer', 'Administrator']) {
      for (const approved of [true, false]) {
        for (const status of ['active', 'suspended', 'deactivated']) {
          const [result] = await tx`select public.mobile_can_weigh(jsonb_populate_record(null::public.users,
            jsonb_build_object('role', ${role}::text, 'organization_verified', ${approved}::boolean,
              'active', ${status === 'active'}::boolean, 'account_status', ${status}::text))) allowed`;
          assert.equal(result.allowed, approved && status === 'active' && ['Recycler', 'BalikTela Hub'].includes(role));
        }
      }
    }
    // A second application must not create rows or lose installed workflow guards.
    await tx.unsafe(migration);
    if (evidence) await tx.unsafe(evidence);
    if (signup) await tx.unsafe(signup);
    const after = await counts();
    assert.deepEqual(after, before, 'Compatibility migration must not change business record counts.');
    const [definition] = await tx`select pg_get_functiondef('public.mobile_mutate(text,text,jsonb,text)'::regprocedure) source`;
    assert.match(definition.source, /public\.mobile_can_weigh\(u\)/);
    assert.match(definition.source, /hub_disposals/);
    assert.match(definition.source, /listing_remainders/);
    if (evidence) {
      const [snapshot] = await tx`select public.get_dashboard_source_snapshot() source`;
      assert.ok(Array.isArray(snapshot.source.transfers));
      assert.ok(snapshot.source.recoveryRecords.every((row: Record<string, unknown>) => Object.hasOwn(row, 'loss_kg')));
      assert.ok(snapshot.source.transfers.every((row: { _flow_events: Record<string, unknown>[] }) => row._flow_events.every(event => Object.hasOwn(event, 'weight_kg'))));
    }
    if (signup) {
      const [trigger] = await tx`select pg_get_functiondef('public.sync_auth_user_profile()'::regprocedure) source`;
      assert.ok(trigger.source.includes("CASE WHEN NEW.raw_user_meta_data->>'account_type'='hub' THEN 'BalikTela Hub'"));
      assert.ok(trigger.source.includes('ON CONFLICT(auth_user_id) DO UPDATE SET email=EXCLUDED.email, updated_at=now()'));
    }
    return { migration: '20261018090000_hub_role_compatibility', permissionCases: 24,
      mobileEvidenceProjection: Boolean(evidence), futureHubSignupAligned: Boolean(signup), idempotencyVerified: true, businessRecordCountsUnchanged: true, records: after };
  });
  console.log(JSON.stringify(result));
} finally { await sql.end({ timeout: 5 }); }
