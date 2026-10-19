import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { SupabaseStore } from '../server/supabaseStore.js';

if (!process.env.SUPABASE_DB_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error('Configure the private Supabase database URL, project URL and backend secret key.');
}
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-mobile-web-readonly-audit' } });
try {
  const database = await sql.begin('READ ONLY', async tx => {
    await tx.unsafe("SET LOCAL statement_timeout='15s'");
    const [integrity] = await tx`select
      (select count(*)::int from (select auth_user_id from public.users where auth_user_id is not null group by auth_user_id having count(*)>1) d) duplicate_auth_profiles,
      (select count(*)::int from (select match_request_id from public.transfers where match_request_id is not null group by match_request_id having count(*)>1) d) duplicate_request_transfers,
      (select count(*)::int from public.listings l left join public.material_batches b on b.id=l.batch_id where b.id is null) orphan_listing_batches,
      (select count(*)::int from public.listings l left join public.users u on u.id=l.weighing_hub_id where l.weighing_hub_id is not null and u.id is null) orphan_hub_assignments,
      (select count(*)::int from public.measurements m left join public.material_batches b on b.id=m.batch_id where b.id is null) orphan_measurement_batches,
      (select count(*)::int from public.transfers t left join public.listings l on l.id=t.listing_id where l.id is null) orphan_transfer_listings,
      (select count(*)::int from public.flow_events f left join public.transfers t on t.id=f.transfer_id where f.transfer_id is not null and t.id is null) orphan_flow_transfers,
      (select count(*)::int from public.listings where available_weight_kg<0 or reserved_kg<0 or reserved_kg>available_weight_kg) invalid_stock_balances,
      (select count(*)::int from public.measurements where measured_at is null) missing_measurement_timestamps,
      (select count(*)::int from (select transfer_id,sequence from public.flow_events where transfer_id is not null group by transfer_id,sequence having count(*)>1) d) duplicate_flow_sequences,
      (select count(*)::int from public.recovery_records where round(input_kg-output_kg-coalesce(rejected_kg,0)-coalesce(loss_kg,0),3)<>0) unbalanced_recovery_records,
      (select count(*)::int from auth.users where email like 'hub-check-%@example.invalid') leftover_test_identities`;
    const roles = await tx`select role,organization_verified,account_status,count(*)::int records from public.users
      where role in ('BalikTela Hub','Recycler') group by role,organization_verified,account_status order by role,organization_verified,account_status`;
    const [normalization] = await tx`select position('NEW.role=''BalikTela Hub''' in pg_get_functiondef('public.normalize_recycler_role()'::regprocedure))>0 rewrites_native_hub`;
    return { integrity, hubRoles: roles, normalization };
  });
  const store = new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const snapshot = await store.loadDashboardSnapshot();
  assert.ok(snapshot, 'The web snapshot REST RPC must be available.');
  const statuses = <T extends { canonicalStatus?: string }>(rows: T[]) => rows.reduce<Record<string, number>>((counts, row) => {
    const key = row.canonicalStatus ?? 'not_recorded'; counts[key] = (counts[key] ?? 0) + 1; return counts;
  }, {});
  const issues = Object.entries(database.integrity).filter(([, count]) => Number(count) > 0).map(([name, count]) => ({ name, count }));
  const result = { checkedAt: new Date().toISOString(), timezone: 'Asia/Manila', mode: 'read-only SQL audit + backend Supabase REST adapter',
    result: issues.length ? 'review-required' : 'passed', integrity: database.integrity, issues, hubRoles: database.hubRoles,
    nativeHubNormalizedToRecycler: database.normalization.rewrites_native_hub,
    webProjection: { batches: snapshot.allBatches.length, listings: snapshot.listings.length, measurements: snapshot.measurements.length,
      transfers: snapshot.allTransfers.length, offers: snapshot.offers.length,
      listingStatuses: statuses(snapshot.listings), transferStatuses: statuses(snapshot.allTransfers), offerStatuses: statuses(snapshot.offers),
      missingBatchGeography: snapshot.allBatches.filter(row => !row.city || !row.region).length,
      completedWithoutVerifiedWeight: snapshot.allTransfers.filter(row => ['Completed','Processed'].includes(row.status) && row.verifiedWeightKg === null).length },
    committedChanges: 0, caveat: 'This audit does not certify deployed PWA behavior or grant access to the mobile repository.' };
  await mkdir('/tmp/baliktela-hub-integration', { recursive: true });
  await writeFile('/tmp/baliktela-hub-integration/audit.json', `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally { await sql.end({ timeout: 5 }); }
