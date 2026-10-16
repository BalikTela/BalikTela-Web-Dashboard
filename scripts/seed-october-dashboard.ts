import { config } from 'dotenv';
import postgres from 'postgres';
import { encodeRecord } from '../server/database/codecs.js';
import { WEB_PERSISTENCE_COLLECTION_MAP } from '../server/database/schema.js';
import { buildOctoberDemo } from '../server/analytics/octoberDemo.js';
import { normalizeDemoRow } from '../server/analytics/operationalDemo.js';
import { manilaDate } from '../shared/reporting.js';

config({ path: '.env.supabase', quiet: true });
config({ quiet: true });
const apply = process.argv.includes('--apply');
if (apply && process.env.SUPABASE_SYNTHETIC_SEED !== 'true') throw new Error('Set SUPABASE_SYNTHETIC_SEED=true to intentionally insert October demo data.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required. Keep it in the ignored local profile.');
const demo = buildOctoberDemo();
if (Date.parse(demo.cutoff) > Date.now()) throw new Error('The demo cutoff is in the future. No records were written.');
const tables: Array<{ table: string; rows: Array<Record<string, unknown> & { id: string }> }> = demo.domainTables.map(([name, records]) => ({ table: WEB_PERSISTENCE_COLLECTION_MAP[name],
  rows: records.map(record => normalizeDemoRow(encodeRecord(name as never, record as never)) as Record<string, unknown> & { id: string }) }));
tables.push({ table: 'flow_events', rows: demo.flowEvents as Array<Record<string, unknown> & { id: string }> });
for (const { rows } of tables) if (rows.some(row => !/^SYN-[A-Z]+-OCT26-/.test(row.id))) throw new Error('Refusing to insert a record outside the October demo namespace.');
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
try {
  const result = await sql.begin(apply ? 'isolation level repeatable read' : 'isolation level repeatable read read only', async tx => {
    await tx`set local statement_timeout = '30000'`;
    if (apply) await tx`select pg_advisory_xact_lock(17102026)`;
    // Check references without reading personal users or changing the shared fictional registry.
    for (const region of ['METRO-MANILA', 'CENTRAL-VISAYAS', 'WESTERN-VISAYAS', 'DAVAO-REGION']) {
      const users = await tx`select id from public.users where id in (${`SYN-USR-PROD-${region}`}, ${`SYN-USR-REC-${region}`})
        and auth_user_id is null and email like '%@synthetic.baliktela.demo'`;
      const facilities = await tx`select id from public.facilities where id=${`SYN-FAC-${region}`} and is_demo=true`;
      const organizations = await tx`select id from public.organizations where id in (${`SYN-ORG-PROD-${region}`}, ${`SYN-ORG-REC-${region}`}) and record_label='demo'`;
      if (users.length !== 2 || facilities.length !== 1 || organizations.length !== 2) throw new Error(`Required fictional registry records are missing or changed for ${region}. No registry records will be created.`);
    }
    const before: Record<string, string> = {};
    let existingCount = 0;
    for (const { table, rows } of tables) {
      const ids = rows.map(row => row.id);
      const existing = await tx`select id from public.${tx(table)} where id=any(${tx.array(ids)}::text[])`;
      existingCount += existing.length;
      const [fingerprint] = await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id),'')) as hash
        from public.${tx(table)} t where not(id=any(${tx.array(ids)}::text[]))`;
      before[table] = fingerprint.hash;
    }
    const totalRows = tables.reduce((sum, item) => sum + item.rows.length, 0);
    if (existingCount !== 0 && existingCount !== totalRows) throw new Error('A partial October demo dataset already exists. Refusing to overwrite or repair records automatically.');
    const inserted: Record<string, number> = {};
    if (apply && existingCount === 0) for (const { table, rows } of tables) {
      const columns = Object.keys(rows[0]);
      await tx`insert into public.${tx(table)} (${tx(columns)})
        select ${tx(columns)} from jsonb_populate_recordset(null::public.${tx(table)}, ${tx.json(rows as never)}::jsonb)`;
      inserted[table] = rows.length;
    }
    for (const { table, rows } of tables) {
      const [fingerprint] = await tx`select md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' order by id),'')) as hash
        from public.${tx(table)} t where not(id=any(${tx.array(rows.map(row => row.id))}::text[]))`;
      if (before[table] !== fingerprint.hash) throw new Error(`Unrelated ${table} records changed inside the seed transaction. Rolling back.`);
    }
    return { action: !apply ? 'dry-run' : existingCount ? 'already-present-no-writes' : 'inserted',
      dataset: demo.dataset, through: manilaDate(new Date(demo.cutoff)), summary: demo.summary,
      plannedRows: Object.fromEntries(tables.map(item => [item.table, item.rows.length])), inserted,
      existingOctoberRows: existingCount, unrelatedRowsPreserved: true };
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Do not print connection credentials, raw provider exceptions or record contents.
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  console.error(JSON.stringify({ result: 'failed', applied: false, message: error instanceof Error && !code ? error.message : 'Database seed transaction failed and was rolled back.', code }));
  process.exitCode = 1;
} finally { await sql.end(); }
