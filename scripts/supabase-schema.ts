import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import postgres from 'postgres';

const databaseUrl = process.env.SUPABASE_DB_URL;
const apply = process.argv.includes('--apply');
const migrationIndex=process.argv.indexOf('--migration');
const selectedMigration=migrationIndex>=0?process.argv[migrationIndex+1]:undefined;
if(migrationIndex>=0 && (!selectedMigration || !/^\d+_[a-z0-9_]+\.sql$/.test(selectedMigration))) throw new Error('Provide a valid migration filename.');
if (!databaseUrl) {
  console.error('SUPABASE_DB_URL is required. Use the direct or session-pooler PostgreSQL connection string from Supabase.');
  process.exit(1);
}
if (apply && process.env.SUPABASE_SCHEMA_APPLY !== 'true') {
  console.error('Refusing to modify Supabase. Set SUPABASE_SCHEMA_APPLY=true for an intentional migration.');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require', connect_timeout: 20 });
try {
  if (apply) {
    const directory = new URL('../supabase/migrations/', import.meta.url);
    const files = (await readdir(directory)).filter((file) => selectedMigration?file===selectedMigration:file.endsWith('.sql')).sort();
    if(!files.length) throw new Error('Migration file not found.');
    for (const file of files) await sql.unsafe(await readFile(new URL(file, directory), 'utf8'));
  }
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `;
  const active = tables.some(({ table_name }) => table_name === 'schema_versions')
    ? await sql<{ version: string; applied_at: string; applied_by: string }[]>`
        select version, applied_at, applied_by from public.schema_versions where status = 'active' order by applied_at desc limit 1
      `
    : [];
  console.log(JSON.stringify({ provider: 'supabase', applied: apply, tableCount: tables.length, tables: tables.map(({ table_name }) => table_name), activeVersion: active[0] ?? null }, null, 2));
} finally {
  await sql.end();
}
