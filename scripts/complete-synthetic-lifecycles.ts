import { config } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';
import { buildOperationalDemo, normalizeDemoRow } from '../server/analytics/operationalDemo.js';
import { buildOctoberDemo } from '../server/analytics/octoberDemo.js';
import { DEMO_LIFECYCLE_COLUMNS, planDemoLifecycle, verifyDemoDependencies, type DemoRow, type DemoTable } from '../server/analytics/demoLifecyclePlan.js';
import { encodeRecord } from '../server/database/codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from '../server/database/schema.js';
import type { OperationalDemoData } from '../server/analytics/completeDemoLifecycle.js';

config({ path: '.env.supabase', quiet: true });
const apply = process.argv.includes('--apply');
const rollbackOnly = process.argv.includes('--rollback-only');
class RollbackVerification extends Error {
  constructor(readonly result: Record<string, unknown>) { super('Rollback-only verification'); }
}
if (apply && process.env.SUPABASE_SYNTHETIC_SEED !== 'true') throw new Error('Set SUPABASE_SYNTHETIC_SEED=true for the approved demo-only lifecycle repair.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required in the ignored local environment file.');
const tables = (version: 1 | 2): DemoTable[] => {
  const datasets: OperationalDemoData[] = [buildOperationalDemo(undefined, undefined, null, { lifecycleVersion: version }), buildOctoberDemo({ lifecycleVersion: version })];
  const grouped = new Map<string, DemoRow[]>();
  for (const demo of datasets) {
    for (const [name, records] of demo.domainTables) {
      const table = WEB_PERSISTENCE_COLLECTION_MAP[name];
      if (!DEMO_LIFECYCLE_COLUMNS[table] && !['match_requests', 'reward_ledger'].includes(table)) continue;
      grouped.set(table, [...grouped.get(table) ?? [], ...records.map(record => normalizeDemoRow(encodeRecord(name as never, record as never)) as DemoRow)]);
    }
    grouped.set('flow_events', [...grouped.get('flow_events') ?? [], ...demo.flowEvents.map(row => normalizeDemoRow(row) as DemoRow)]);
  }
  return [...grouped].map(([table, rows]) => ({ table, rows }));
};
const legacyTables = tables(1), completedTables = tables(2);
const legacy = legacyTables.filter(item => DEMO_LIFECYCLE_COLUMNS[item.table]);
const completed = completedTables.filter(item => DEMO_LIFECYCLE_COLUMNS[item.table]);
const dependencies = legacyTables.filter(item => !DEMO_LIFECYCLE_COLUMNS[item.table]);
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-demo-lifecycle-v2' } });
let operation = 'connect';
try {
  const result = await sql.begin(apply ? 'isolation level repeatable read' : 'isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '60000'`;
    await tx`set local lock_timeout = '5000'`;
    if (apply) await tx`select pg_advisory_xact_lock(19102026)`;
    const current: DemoTable[] = [];
    for (const item of completed) {
      operation = `inspect ${item.table}`;
      const rows = await tx`select to_jsonb(t) as row from public.${tx(item.table)} t where id=any(${tx.array(item.rows.map(row => row.id))}::text[])`;
      current.push({ table: item.table, rows: rows.map(item => item.row as DemoRow) });
    }
    const mutations = planDemoLifecycle(legacy, completed, current);
    for (const item of dependencies) {
      operation = `inspect dependency ${item.table}`;
      const rows = await tx`select to_jsonb(t) as row from public.${tx(item.table)} t where id=any(${tx.array(item.rows.map(row => row.id))}::text[])`;
      verifyDemoDependencies(rows.map(item => item.row as DemoRow), item.rows);
    }
    // A real/mobile record referencing a demo object prevents rewriting that object's lifecycle.
    operation = 'inspect reference metadata';
    const references = await tx`select c.table_name,c.column_name,exists(select 1 from information_schema.columns i
      where i.table_schema='public' and i.table_name=c.table_name and i.column_name='id') as has_id
      from information_schema.columns c where c.table_schema='public'
      and c.column_name in ('batch_id','listing_id','transfer_id','measurement_id','source_listing_id','remainder_of_id')`;
    const affected: Record<string, string[]> = {};
    for (const table of current) affected[table.table] = table.rows.map(row => row.id);
    for (const reference of references) {
      operation = `inspect reference ${reference.table_name}.${reference.column_name}`;
      const target = reference.column_name.includes('batch') ? 'material_batches' : reference.column_name.includes('listing') || reference.column_name === 'remainder_of_id' ? 'listings' : reference.column_name.includes('measurement') ? 'measurements' : 'transfers';
      const ownIds = completedTables.find(item => item.table === reference.table_name)?.rows.map(row => row.id) ?? [];
      const [foreign] = reference.has_id ? await tx`select count(*)::int as count from public.${tx(reference.table_name)}
        where ${tx(reference.column_name)}::text=any(${tx.array(affected[target] ?? [])}::text[]) and not(id::text=any(${tx.array(ownIds)}::text[]))`
        : await tx`select count(*)::int as count from public.${tx(reference.table_name)} where ${tx(reference.column_name)}::text=any(${tx.array(affected[target] ?? [])}::text[])`;
      if (foreign.count) throw new Error(`External records reference the demo lifecycle in ${reference.table_name}; no changes will be applied.`);
    }
    operation = 'inspect protected table metadata';
    const publicTables = await tx`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
      and exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tables.table_name and c.column_name='id')`;
    const fingerprints = async () => {
      const hashes: Record<string, string> = {};
      for (const { table_name } of publicTables) {
        operation = `fingerprint ${table_name}`;
        const allowedIds = mutations.filter(item => item.table === table_name).map(row => row.id);
        const [row] = await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id), '')) as hash
          from public.${tx(table_name)} t where not(id::text=any(${tx.array(allowedIds)}::text[]))`;
        hashes[table_name] = row.hash;
      }
      return hashes;
    };
    const protectedBefore = await fingerprints();
    let backup: string | null = null;
    if (apply && mutations.length) {
      if (!rollbackOnly) {
        backup = `/tmp/baliktela-demo-lifecycle-backup-${Date.now()}.json`;
        await writeFile(backup, JSON.stringify({ dataset: 'synthetic-lifecycle-v2', createdAt: new Date().toISOString(), mutations }, null, 2), { mode: 0o600 });
      }
      // Existing completion sequences move before inserting the new processing event.
      for (const table of completed) {
        const updates = mutations.filter(item => item.table === table.table && item.before);
        const updateShapes = new Map<string, typeof updates>();
        for (const row of updates) { const key = JSON.stringify(Object.keys(row.patch).sort()); updateShapes.set(key, [...updateShapes.get(key) ?? [], row]); }
        for (const [shape, rows] of updateShapes) {
          operation = `update demo ${table.table}`;
          const columns = JSON.parse(shape) as string[];
          const payload = rows.map(item => ({ id: item.id, before: item.before, patch: item.patch }));
          const result = await tx`update public.${tx(table.table)} t set (${tx(columns)}) =
            (select ${tx(columns)} from jsonb_populate_record(null::public.${tx(table.table)}, p.patch))
            from jsonb_to_recordset(${tx.json(payload as never)}::jsonb) as p(id text, before jsonb, patch jsonb)
            where t.id=p.id and to_jsonb(t)=p.before returning t.id`;
          if (result.length !== rows.length) throw new Error(`Concurrent change in ${table.table}; rolling back the demo repair.`);
        }
        const inserts = mutations.filter(item => item.table === table.table && !item.before).map(item => item.after);
        // Group inserts by column shape rather than dropping optional provenance fields.
        const shapes = new Map<string, DemoRow[]>();
        for (const row of inserts) { const key = JSON.stringify(Object.keys(row).sort()); shapes.set(key, [...shapes.get(key) ?? [], row]); }
        for (const [shape, rows] of shapes) {
          operation = `insert demo ${table.table}`;
          const columns = JSON.parse(shape) as string[];
          await tx`insert into public.${tx(table.table)} (${tx(columns)}) select ${tx(columns)}
            from jsonb_populate_recordset(null::public.${tx(table.table)}, ${tx.json(rows as never)}::jsonb)`;
        }
      }
    }
    const protectedAfter = await fingerprints();
    if (JSON.stringify(protectedBefore) !== JSON.stringify(protectedAfter)) throw new Error('Protected records changed; the demo repair was rolled back.');
    if (apply) {
      const final: DemoTable[] = [];
      for (const item of completed) {
        const rows = await tx`select to_jsonb(t) as row from public.${tx(item.table)} t where id=any(${tx.array(item.rows.map(row => row.id))}::text[])`;
        final.push({ table: item.table, rows: rows.map(item => item.row as DemoRow) });
      }
      if (planDemoLifecycle(legacy, completed, final).length) throw new Error('Demo lifecycle verification failed; rolling back.');
    }
    const report = { action: !apply ? 'dry-run' : mutations.length ? 'completed' : 'already-complete-no-writes', dataset: 'synthetic-lifecycle-v2',
      changes: Object.fromEntries(completed.map(item => [item.table, { updates: mutations.filter(change => change.table === item.table && change.before).length,
        inserts: mutations.filter(change => change.table === item.table && !change.before).length }])),
      protectedTablesVerified: publicTables.length, nonTargetRecordsUnchanged: true, accountsAndRewardsUnchanged: true, backup };
    if (rollbackOnly && apply) throw new RollbackVerification({ ...report, action: 'verified-rolled-back', committed: false });
    return report;
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} catch (error) {
  if (error instanceof RollbackVerification) { process.stdout.write(JSON.stringify(error.result, null, 2) + '\n'); }
  else {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  console.error(JSON.stringify({ action: 'failed-no-commit', message: code ? 'Database operation failed; no lifecycle repair committed.' : error instanceof Error ? error.message : 'Lifecycle repair failed.', operation, code }));
  process.exitCode = 1;
  }
} finally { await sql.end({ timeout: 5 }); }
