import { config } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { SupabaseStore } from '../server/supabaseStore.js';
import { MemoryStore } from '../server/store.js';
import { createSeedData } from '../server/seed.js';
import { planImport } from '../server/imports.js';
import { canonicalMutations, type CanonicalMutation } from '../server/database/mutations.js';
import { IMPORT_DELETE_ORDER, ImportRemovalSafetyError, planImportRemoval, removalAuditActor, type ImportRow } from './lib/import-removal.js';

config({ path: '.env.supabase', quiet: true });
const apply = process.argv.includes('--apply'), rollbackOnly = process.argv.includes('--rollback-only');
if (process.argv.slice(2).some(arg => !['--apply', '--rollback-only'].includes(arg))) throw new Error('Unsupported cleanup argument.');
if (rollbackOnly && !apply) throw new Error('Rollback verification requires --apply.');
if (!process.env.SUPABASE_DB_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error('Private database configuration is required.');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15,
  connection: { application_name: 'baliktela-two-bulk-test-removal' } });
const run = new Date().toISOString().replace(/[:.]/g, '-'), directory = resolve('test-results/import-removal', run);
const auditId = `AUD-BULK-REMOVAL-${randomUUID()}`;
class RollbackCheck extends Error { constructor(readonly result: unknown) { super('Verified rollback'); } }
let operation = 'read import manifests';
try {
  const live = new SupabaseStore(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const users = await live.all('users'), facilities = await live.all('facilities'); await live.close();
  const seed = await createSeedData(), actor = seed.users[0];
  for (const key of Object.keys(seed) as Array<keyof typeof seed>) (seed[key] as unknown[]) = [];
  seed.users = users; seed.facilities = facilities;
  const memory = new MemoryStore(seed), expected: CanonicalMutation[] = [], files: string[] = [];
  for (const part of [1, 2]) {
    const file = `baliktela-demo-part-${part}-500-rows.csv`;
    const csv = await readFile(resolve('test-results/demo-imports/20261019-v1', file), 'utf8');
    const plan = await planImport(memory, actor, csv);
    if (!plan.preview.valid || plan.preview.totalRows !== 500 || plan.preview.rows.some(row => !new RegExp(`^DEMO-IMPORT-20261019-V1-P${part}-[0-9]{4}$`).test(row.externalId)))
      throw new ImportRemovalSafetyError('The two original 500-row CSV manifests are required unchanged.');
    expected.push(...canonicalMutations(plan.groups.flat())); files.push(file);
  }
  const result = await sql.begin(apply ? 'isolation level serializable' : 'isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '60000'`; await tx`set local lock_timeout = '5000'`;
    if (apply) {
      await tx`select pg_advisory_xact_lock(19102027)`;
      for (const table of IMPORT_DELETE_ORDER) await tx`lock table public.${tx(table)} in share row exclusive mode`;
    }
    const current: Record<string, ImportRow[]> = {};
    for (const table of IMPORT_DELETE_ORDER) {
      operation = `verify imported ${table}`;
      const ids = expected.filter(item => item.table === table).map(item => item.id);
      const rows = await tx`select to_jsonb(t) as row from public.${tx(table)} t where id::text=any(${tx.array(ids)}::text[]) order by id`;
      current[table] = rows.map(item => item.row as ImportRow);
    }
    operation = 'validate original importer fields';
    const plan = planImportRemoval(expected, current);
    const ids = Object.values(plan).flat().map(item => item.id);
    operation = 'verify original import audit principal';
    const importLogs = await tx`select actor_id,details from public.activity_logs where action='dataset.demo.imported'`;
    const auditActor = ids.length ? removalAuditActor(importLogs as unknown as Parameters<typeof removalAuditActor>[0], new Set(plan.material_batches.map(item => item.id)), users) : null;
    operation = 'inspect external references';
    const columns = await tx`select c.table_name,c.column_name,exists(select 1 from information_schema.columns i
      where i.table_schema='public' and i.table_name=c.table_name and i.column_name='id') as has_id
      from information_schema.columns c where c.table_schema='public' and c.column_name ~ '_id$'
      and c.data_type in ('text','character varying') and c.table_name<>'activity_logs'
      and exists(select 1 from information_schema.tables t where t.table_schema='public' and t.table_name=c.table_name and t.table_type='BASE TABLE')`;
    for (const column of columns) {
      operation = `check references in ${column.table_name}.${column.column_name}`;
      const own = (plan[column.table_name] ?? []).map(row => row.id);
      const [foreign] = column.has_id ? await tx`select count(*)::int as count from public.${tx(column.table_name)}
        where ${tx(column.column_name)}::text=any(${tx.array(ids)}::text[]) and not(id::text=any(${tx.array(own)}::text[]))`
        : await tx`select count(*)::int as count from public.${tx(column.table_name)} where ${tx(column.column_name)}::text=any(${tx.array(ids)}::text[])`;
      if (foreign.count) throw new ImportRemovalSafetyError(`Outside records reference these imports in ${column.table_name}; no data removed.`);
    }
    operation = 'fingerprint protected records';
    const tables = await tx`select table_name,exists(select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=t.table_name and c.column_name='id') as has_id
      from information_schema.tables t where table_schema='public' and table_type='BASE TABLE' order by table_name`;
    const fingerprint = async () => {
      const hashes: Record<string, string> = {};
      for (const { table_name: table, has_id } of tables) {
        const own = table === 'activity_logs' ? [auditId] : (plan[table] ?? []).map(row => row.id);
        const [row] = has_id ? await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id), '')) as hash
          from public.${tx(table)} t where not(id::text=any(${tx.array(own)}::text[]))`
          : await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by to_jsonb(t)::text), '')) as hash from public.${tx(table)} t`;
        hashes[table] = row.hash;
      }
      return hashes;
    };
    const before = await fingerprint();
    const counts = Object.fromEntries(Object.entries(plan).map(([table, rows]) => [table, rows.length]));
    let backup: string | null = null;
    if (apply && ids.length) {
      operation = 'write private recovery backup';
      await mkdir(directory, { recursive: true, mode: 0o700 }); backup = resolve(directory, 'backup.json');
      await writeFile(backup, JSON.stringify({ createdAt: new Date().toISOString(), files, tables: plan, protectedFingerprints: before }, null, 2), { mode: 0o600, flag: 'wx' });
      for (const table of IMPORT_DELETE_ORDER) {
        operation = `remove test ${table}`;
        const own = plan[table].map(row => row.id);
        const removed = await tx`delete from public.${tx(table)} where id::text=any(${tx.array(own)}::text[]) returning id`;
        if (removed.length !== own.length) throw new ImportRemovalSafetyError('Concurrent changes detected; removal is rolled back.');
      }
    }
    if (apply && ids.length) {
      operation = 'record authorized test cleanup audit';
      await tx`insert into public.activity_logs (id,actor_id,action,entity_type,entity_id,details,ip_hash,occurred_at)
        values (${auditId},${auditActor},'dataset.demo.removed','Dataset','DEMO-IMPORT-20261019-V1-P1-P2',
          ${tx.json({ summary: JSON.stringify({ reason: 'User requested removal of the two bulk test imports to reduce dashboard load.',
            execution: 'Authorized maintenance command; audit principal is the original importing administrator, not a new web login.', files, counts }) })},null,now())`;
    }
    operation = 'verify protected records';
    if (JSON.stringify(before) !== JSON.stringify(await fingerprint())) throw new ImportRemovalSafetyError('Records outside the two imports changed; rolling back.');
    for (const table of IMPORT_DELETE_ORDER) if (apply) {
      const own = plan[table].map(row => row.id);
      const [remaining] = await tx`select count(*)::int as count from public.${tx(table)} where id::text=any(${tx.array(own)}::text[])`;
      if (remaining.count) throw new ImportRemovalSafetyError('Import removal did not reconcile; rolling back.');
    }
    const report = { mode: !apply ? 'read-only preview' : rollbackOnly ? 'rollback verified' : 'removed', files, counts,
      totalLinkedRecords: ids.length, protectedTablesUnchanged: tables.length, backup, auditId: apply && ids.length ? auditId : null };
    if (rollbackOnly) throw new RollbackCheck(report);
    return report;
  });
  if (apply) { await mkdir(directory, { recursive: true, mode: 0o700 }); await writeFile(resolve(directory, 'report.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (error instanceof RollbackCheck) console.log(JSON.stringify(error.result, null, 2));
  else {
    console.error(JSON.stringify({ failed: true, operation, reason: error instanceof ImportRemovalSafetyError ? error.message : 'Database operation failed; no private details logged.',
      code: (error as { code?: string }).code ?? 'unavailable' }, null, 2)); process.exitCode = 1;
  }
} finally { await sql.end({ timeout: 5 }); }
