import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: '.env.supabase', quiet: true });
config({ quiet: true });
const findings: Array<{ severity: string; check: string; resource: string }> = [];
const add = (severity: string, check: string, resource: string) => findings.push({ severity, check, resource });
const secretPattern = /sb_secret_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const privateValues = ['SUPABASE_SECRET_KEY', 'JWT_SECRET', 'BACKUP_ADMIN_PASSWORD', 'SUPABASE_DB_URL'].map(key => process.env[key]).filter((value): value is string => Boolean(value && value.length >= 16));
function scan(path: string) {
  if (!existsSync(path) || statSync(path).size > 5_000_000 || /\.(png|jpe?g|webp|woff2?|pdf|zip|xlsx|docx)$/i.test(path)) return;
  const content = readFileSync(path, 'utf8');
  if (secretPattern.test(content) || privateValues.some(value => content.includes(value))) add('critical', 'credential-in-file', path);
}
for (const file of files) {
  if (/(^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.example')) add('critical', 'tracked-environment-file', file);
  scan(file);
}
function scanDirectory(directory: string) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scanDirectory(path); else scan(path);
  }
}
scanDirectory('dist');
if (process.argv.includes('--history')) {
  const commits = execFileSync('git', ['rev-list', '--all'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    try {
      const matches = execFileSync('git', ['grep', '-l', '-I', '-E', 'sb_secret_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY', commit, '--', '.'], { encoding: 'utf8' });
      for (const match of matches.trim().split('\n').filter(Boolean)) add('critical', 'credential-signature-in-history', match);
    } catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
    if (privateValues.length) {
      try {
        const matches = execFileSync('git', ['grep', '-l', '-I', '-F', '-f', '-', commit, '--', '.'], { encoding: 'utf8', input: privateValues.join('\n') });
        for (const match of matches.trim().split('\n').filter(Boolean)) add('critical', 'configured-private-value-in-history', match);
      } catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
    }
  }
}
if (process.argv.includes('--database')) {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL is required for the optional read-only database audit.');
  const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, ssl: 'require', connect_timeout: 15 });
  try {
    await sql.begin('read only', async tx => {
      await tx`set local statement_timeout = '15000'`;
      const tables = await tx`select c.relname, c.relrowsecurity,
        has_table_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT') as anon_read,
        has_table_privilege('authenticated', c.oid, 'SELECT') or has_any_column_privilege('authenticated', c.oid, 'SELECT') as authenticated_read,
        has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE') or has_any_column_privilege('anon', c.oid, 'INSERT,UPDATE') as anon_write,
        has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE') or has_any_column_privilege('authenticated', c.oid, 'INSERT,UPDATE') as authenticated_write
        from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')`;
      const sensitive = new Set(['auth_account_security','sessions','auth_challenges','auth_rate_limits']);
      for (const table of tables) {
        if (!table.relrowsecurity) add('high', 'rls-disabled', table.relname);
        if (sensitive.has(table.relname) && (table.anon_read || table.authenticated_read || table.anon_write || table.authenticated_write)) add('high', 'security-table-client-grant', table.relname);
      }
      const policies = await tx`select tablename, policyname from pg_policies where schemaname='public' and cmd in ('ALL','SELECT')
        and (qual is null or trim(qual,' ()')='true')`;
      for (const policy of policies) add('review', 'unrestricted-read-policy', `${policy.tablename}:${policy.policyname}`);
      const writePolicies = await tx`select tablename, policyname, cmd from pg_policies where schemaname='public' and cmd in ('ALL','INSERT','UPDATE','DELETE')
        and (qual is null or trim(qual,' ()')='true') and (with_check is null or trim(with_check,' ()')='true')`;
      for (const policy of writePolicies) {
        const table = tables.find(item => item.relname === policy.tablename);
        add(table?.anon_write || table?.authenticated_write ? 'high' : 'review', 'unrestricted-write-policy', `${policy.tablename}:${policy.policyname}`);
      }
      const functions = await tx`select p.proname,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef`;
      const serverOnly = new Set(['get_dashboard_source_snapshot','apply_management_mutations','rotate_auth_session','consume_auth_challenge','record_auth_rate_limit_failure']);
      for (const fn of functions) if (fn.anon_execute || fn.authenticated_execute) add(serverOnly.has(fn.proname) ? 'critical' : 'review', 'client-callable-security-definer', fn.proname);
      const buckets = await tx`select name from storage.buckets where public = true`;
      for (const bucket of buckets) add('review', 'public-storage-bucket', bucket.name);
      console.log(JSON.stringify({ database: 'metadata-only, read-only transaction', tablesChecked: tables.length, securityDefinerFunctionsChecked: functions.length }));
    });
  } catch {
    add('incomplete', 'database-audit-unavailable', 'Connection or metadata query failed; credentials and provider details withheld.');
  } finally { await sql.end(); }
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), root: resolve('.'), findings,
  caveat: 'Not a penetration test or proof of no breach. Review RLS predicates, authenticated mobile RPCs, storage policies, provider audit logs and key exposure separately.' }, null, 2));
if (findings.some(item => ['critical','high','incomplete'].includes(item.severity))) process.exitCode = 1;
