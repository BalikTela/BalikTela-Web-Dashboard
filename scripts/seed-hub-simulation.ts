import { config } from 'dotenv';
import { isDeepStrictEqual } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { buildHubSimulation, HUB_SIMULATION_AT } from '../server/analytics/hubSimulation.js';
import { encodeRecord, decodeRecord } from '../server/database/codecs.js';
import { normalizeDemoRow } from '../server/analytics/operationalDemo.js';
import { HUB_SIMULATION_PREFIX as P } from '../shared/hubStorage.js';
import type { FacilityRecord } from '../server/types.js';

config({ path: '.env.supabase', quiet: true });
const apply = process.argv.includes('--apply'), rollback = process.argv.includes('--rollback-only');
if (apply && process.env.SUPABASE_SYNTHETIC_SEED !== 'true') throw new Error('Explicit SUPABASE_SYNTHETIC_SEED=true is required to apply the approved simulation.');
if (!process.env.SUPABASE_DB_URL) throw new Error('Configure the ignored Supabase connection profile.');
if (Date.parse(HUB_SIMULATION_AT) > Date.now()) throw new Error('Refusing future-dated simulation evidence.');
type Row = Record<string, unknown> & { id: string };
class VerifiedRollback extends Error { constructor(readonly report: unknown) { super('Verified simulation rolled back'); } }
const canonical = (value: unknown, key = ''): unknown => {
  if (Array.isArray(value)) return value.map(item => canonical(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([name, item]) => [name, canonical(item, name)]));
  if (typeof value === 'string' && /_at$/.test(key) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return value;
};
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-labeled-hub-simulation-v1' } });
let operation = 'connect';
try {
  const report = await sql.begin(apply ? 'isolation level repeatable read' : 'isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '45000'`; await tx`set local lock_timeout = '5000'`;
    if (apply) {
      const [lock] = await tx`select pg_try_advisory_xact_lock(21102026) as available`;
      if (!lock.available) throw new Error('Another simulation operation is running.');
    }
    const rawFacilities = await tx`select to_jsonb(f) as row from public.facilities f order by id`;
    const facilities = rawFacilities.map(({ row }) => decodeRecord('facilities', { ...row, _id: row.id }) as FacilityRecord);
    const demo = buildHubSimulation(facilities);
    const encode = (name: 'users' | 'materialBatches' | 'listings' | 'measurements', records: unknown[]) => records.map(record => {
      const row = normalizeDemoRow(encodeRecord(name, record as never)) as Row;
      if ('updated_at' in row) row.updated_at = HUB_SIMULATION_AT;
      return row;
    });
    const tables: Array<{ table: string; rows: Row[] }> = [
      { table: 'users', rows: encode('users', demo.users) },
      { table: 'auth_account_security', rows: demo.users.map(user => ({ id: `${P}SEC-${user.id.slice(P.length)}`, user_id: user.id,
        email_verified_at: null, password_changed_at: null, created_at: HUB_SIMULATION_AT, updated_at: HUB_SIMULATION_AT })) },
      { table: 'facility_assignments', rows: demo.users.filter(user => user.stakeholder === 'BalikTela Hub').map(user => ({
        id: `${P}ASSIGN-${user.scope.facilityIds[0]}`, user_id: user.id, facility_id: user.scope.facilityIds[0], role: 'collector',
        active: false, assigned_by: user.id, created_at: HUB_SIMULATION_AT, updated_at: HUB_SIMULATION_AT })) },
      { table: 'material_batches', rows: encode('materialBatches', demo.materialBatches) },
      { table: 'listings', rows: encode('listings', demo.listings).map((row, index) => ({ ...row,
        disposed_weight_kg: demo.listings[index].disposedWeightKg ?? 0, disposed_at: demo.listings[index].disposedAt ?? null })) },
      { table: 'measurements', rows: encode('measurements', demo.measurements) },
      { table: 'hub_disposals', rows: demo.disposals.map(item => ({ id: item.id, listing_id: item.listingId, operator_id: item.operatorId,
        listing_title: item.listingTitle, category: item.category, owner_name: item.ownerName, weight_kg: item.weightKg,
        reason: item.reason, disposed_at: item.disposedAt, request_key: item.requestKey, fingerprint: item.fingerprint })) },
    ];
    for (const { rows } of tables) if (rows.some(row => !row.id.startsWith(P))) throw new Error('Record outside the simulation namespace.');
    const metadata = await tx`select table_name from information_schema.tables t where table_schema='public' and table_type='BASE TABLE'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=t.table_name and c.column_name='id') order by table_name`;
    const fingerprints = async () => {
      const result: Record<string, string> = {};
      for (const { table_name } of metadata) {
        operation = `protect ${table_name}`;
        const ids = tables.find(item => item.table === table_name)?.rows.map(row => row.id) ?? [];
        const [row] = await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by id),'')) as hash
          from public.${tx(table_name)} t where not(id::text=any(${tx.array(ids)}::text[]))`;
        result[table_name] = row.hash;
      }
      const [auth] = await tx`select count(*)::int as count from auth.users`;
      result.authUserCount = String(auth.count);
      return result;
    };
    const before = await fingerprints();
    let present = 0;
    const verify = async () => {
      let count = 0;
      for (const { table, rows } of tables) {
        operation = `verify ${table}`;
        const current = await tx`select to_jsonb(t) as row from public.${tx(table)} t where id=any(${tx.array(rows.map(row => row.id))}::text[])`;
        count += current.length;
        for (const { row } of current) {
          const expected = rows.find(item => item.id === row.id)!;
          const actual = Object.fromEntries(Object.keys(expected).map(key => [key, row[key]]));
          if (!isDeepStrictEqual(canonical(actual), canonical(expected))) throw new Error(`Simulation collision or edited fixture in ${table}. No existing record will be overwritten.`);
        }
      }
      return count;
    };
    present = await verify();
    const total = tables.reduce((sum, item) => sum + item.rows.length, 0);
    if (present !== 0 && present !== total) throw new Error('Partial simulation exists. Refusing automatic repair or duplicate inserts.');
    if (apply && !present) for (const { table, rows } of tables) {
      operation = `insert ${table}`;
      const shapes = new Map<string, Row[]>();
      for (const row of rows) { const shape = JSON.stringify(Object.keys(row).sort()); shapes.set(shape, [...shapes.get(shape) ?? [], row]); }
      for (const [shape, records] of shapes) {
        const columns = JSON.parse(shape) as string[];
        await tx`insert into public.${tx(table)} (${tx(columns)}) select ${tx(columns)}
          from jsonb_populate_recordset(null::public.${tx(table)}, ${tx.json(records as never)}::jsonb)`;
      }
    }
    if (apply && await verify() !== total) throw new Error('Incomplete dataset; rolling back.');
    if (!isDeepStrictEqual(before, await fingerprints())) throw new Error('Non-simulation records changed. Rolling back.');
    const result = { action: !apply ? 'dry-run' : present ? 'already-present-no-writes' : rollback ? 'verified-rolled-back' : 'inserted',
      dataset: P, profilesAreDisabledAndCannotLogin: true, publicStockKg: 0, newAuthAccounts: 0, newHubs: 0,
      tables: Object.fromEntries(tables.map(item => [item.table, item.rows.length])), inserted: apply && !present ? total : 0,
      existingRowsPreserved: true, protectedTables: metadata.length, scenarios: demo.scenarios };
    if (apply && rollback) throw new VerifiedRollback(result);
    return result;
  });
  await mkdir('test-results/hub-simulation', { recursive: true });
  await writeFile(`test-results/hub-simulation/${apply ? 'applied' : 'preview'}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error instanceof VerifiedRollback) console.log(JSON.stringify(error.report, null, 2));
  else {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    console.error(JSON.stringify({ action: 'failed-no-commit', operation, code,
      message: code ? 'Database transaction failed; nothing committed.' : error instanceof Error ? error.message : 'Simulation failed.' }));
    process.exitCode = 1;
  }
} finally { await sql.end({ timeout: 5 }); }
