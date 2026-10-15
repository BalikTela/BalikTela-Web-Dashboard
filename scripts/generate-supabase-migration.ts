import { mkdir, writeFile } from 'node:fs/promises';
import { DATABASE_COLLECTIONS } from '../server/database/schema.js';

const version = '2.0.0';
const output = new URL('../supabase/migrations/20261007040000_baliktela_schema_v2.sql', import.meta.url);
const statements: string[] = [
  '-- BalikTela canonical PostgreSQL schema for Supabase.',
  '-- Generated from server/database/schema.ts; edit the source contract, then regenerate.',
  'begin;',
];

for (const definition of DATABASE_COLLECTIONS) {
  const schema = definition.validator.$jsonSchema as Record<string, any>;
  const required = new Set<string>(schema.required ?? []);
  const properties = schema.properties as Record<string, any>;
  const columns = Object.entries(properties).map(([name, property]) => {
    const columnName = name === '_id' ? 'id' : name;
    const constraints = [sqlType(property)];
    if (name === '_id') constraints.push('primary key');
    if (required.has(name)) constraints.push('not null');
    if (columnName === 'created_at' || columnName === 'updated_at') constraints.push('default now()');
    const check = enumCheck(columnName, property);
    if (check) constraints.push(check);
    return `  ${quote(columnName)} ${constraints.join(' ')}`;
  });
  if (definition.name === 'users') columns.splice(1, 0, '  "auth_user_id" uuid unique references auth.users(id) on delete set null');
  statements.push(`create table if not exists public.${quote(definition.name)} (\n${columns.join(',\n')}\n);`);
}

for (const definition of DATABASE_COLLECTIONS) {
  const properties = (definition.validator.$jsonSchema as Record<string, any>).properties as Record<string, any>;
  for (const index of definition.indexes) {
    const name = String(index.name);
    if (name.startsWith('ttl_')) continue;
    const keys = Object.entries(index.key as Record<string, unknown>);
    if (!keys.length || keys.some(([field]) => isStructured(properties[field.split('.')[0]]))) continue;
    const columns = keys.map(([field, direction]) => {
      if (field.includes('.')) {
        const [root, child] = field.split('.');
        return `(${quote(root)}->>'${child.replaceAll("'", "''")}')`;
      }
      return `${quote(field === '_id' ? 'id' : field)} ${Number(direction) < 0 ? 'desc' : 'asc'}`;
    });
    const unique = index.unique ? 'unique ' : '';
    const partial = index.partialFilterExpression ? ` where ${renderFilter(index.partialFilterExpression as Record<string, unknown>)}` : '';
    statements.push(`create ${unique}index if not exists ${quote(name)} on public.${quote(definition.name)} (${columns.join(', ')})${partial};`);
  }
}

statements.push(`
create or replace function public.consume_auth_challenge(p_token_hash text, p_type text, p_consumed_at timestamptz)
returns setof public.auth_challenges
language sql
security definer
set search_path = public
as $$
  update public.auth_challenges
     set consumed_at = p_consumed_at, updated_at = p_consumed_at
   where id = (
     select id from public.auth_challenges
      where token_hash = p_token_hash and type = p_type and consumed_at is null and expires_at > now()
      order by created_at desc for update skip locked limit 1
   )
  returning *;
$$;

create or replace function public.rotate_auth_session(
  p_id text, p_presented_hash text, p_next_hash text, p_next_csrf_hash text, p_updated_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare current_session public.sessions%rowtype;
begin
  select * into current_session from public.sessions where id = p_id for update;
  if not found or current_session.revoked_at is not null or current_session.expires_at <= now() then return 'invalid'; end if;
  if p_presented_hash = any(current_session.used_token_hashes) then
    update public.sessions set revoked_at = p_updated_at, updated_at = p_updated_at where id = p_id;
    return 'replayed';
  end if;
  if current_session.token_hash <> p_presented_hash then return 'invalid'; end if;
  update public.sessions
     set token_hash = p_next_hash,
         csrf_hash = p_next_csrf_hash,
         used_token_hashes = (current_session.used_token_hashes || p_presented_hash)[greatest(1, cardinality(current_session.used_token_hashes || p_presented_hash) - 19):],
         updated_at = p_updated_at
   where id = p_id;
  return 'rotated';
end;
$$;

create or replace function public.record_auth_rate_limit_failure(
  p_id text, p_scope text, p_subject_hash text, p_now timestamptz,
  p_window_seconds integer, p_max_attempts integer, p_lock_seconds integer
) returns setof public.auth_rate_limits
language plpgsql
security definer
set search_path = public
as $$
declare current_limit public.auth_rate_limits%rowtype;
begin
  select * into current_limit from public.auth_rate_limits where id = p_id for update;
  if not found then
    insert into public.auth_rate_limits(id, scope, subject_hash, attempts, window_started_at, locked_until, expires_at, updated_at)
    values (p_id, p_scope, p_subject_hash, 1, p_now, case when p_max_attempts <= 1 then p_now + make_interval(secs => p_lock_seconds) else null end,
            p_now + make_interval(secs => greatest(p_window_seconds, p_lock_seconds) * 2), p_now)
    returning * into current_limit;
  else
    if current_limit.window_started_at <= p_now - make_interval(secs => p_window_seconds) then
      current_limit.attempts := 1; current_limit.window_started_at := p_now; current_limit.locked_until := null;
    else
      current_limit.attempts := current_limit.attempts + 1;
    end if;
    if current_limit.attempts >= p_max_attempts and (current_limit.locked_until is null or current_limit.locked_until <= p_now) then
      current_limit.locked_until := p_now + make_interval(secs => p_lock_seconds);
    end if;
    update public.auth_rate_limits
       set scope = p_scope, subject_hash = p_subject_hash, attempts = current_limit.attempts,
           window_started_at = current_limit.window_started_at, locked_until = current_limit.locked_until,
           expires_at = p_now + make_interval(secs => greatest(p_window_seconds, p_lock_seconds) * 2), updated_at = p_now
     where id = p_id returning * into current_limit;
  end if;
  return next current_limit;
end;
$$;
`);

for (const definition of DATABASE_COLLECTIONS) {
  statements.push(`alter table public.${quote(definition.name)} enable row level security;`);
  statements.push(`revoke all on table public.${quote(definition.name)} from anon, authenticated;`);
  statements.push(`grant all on table public.${quote(definition.name)} to service_role;`);
}

statements.push(
  'revoke all on function public.consume_auth_challenge(text, text, timestamptz) from public, anon, authenticated;',
  'revoke all on function public.rotate_auth_session(text, text, text, text, timestamptz) from public, anon, authenticated;',
  'revoke all on function public.record_auth_rate_limit_failure(text, text, text, timestamptz, integer, integer, integer) from public, anon, authenticated;',
  'grant execute on function public.consume_auth_challenge(text, text, timestamptz) to service_role;',
  'grant execute on function public.rotate_auth_session(text, text, text, text, timestamptz) to service_role;',
  'grant execute on function public.record_auth_rate_limit_failure(text, text, text, timestamptz, integer, integer, integer) to service_role;',
  `insert into public.schema_versions(id, version, status, applied_at, applied_by, notes)
   values ('${version}', '${version}', 'active', now(), 'supabase-migration', 'BalikTela Supabase/PostgreSQL canonical contract.')
   on conflict (id) do update set status = excluded.status, applied_at = excluded.applied_at, applied_by = excluded.applied_by, notes = excluded.notes;`,
  `update public.schema_versions set status = 'superseded' where id <> '${version}' and status = 'active';`,
  'commit;',
  '',
);

await mkdir(new URL('../supabase/migrations/', import.meta.url), { recursive: true });
await writeFile(output, statements.join('\n\n'), 'utf8');
console.log(`Generated ${output.pathname}`);

function sqlType(property: Record<string, any>) {
  const values = Array.isArray(property.bsonType) ? property.bsonType : [property.bsonType];
  const type = values.find((value) => value !== 'null');
  if (type === 'date') return 'timestamptz';
  if (type === 'bool') return 'boolean';
  if (type === 'int' || type === 'long') return 'bigint';
  if (type === 'double' || type === 'decimal') return 'numeric';
  if (type === 'array') return property.items?.bsonType === 'string' ? 'text[]' : 'jsonb';
  if (type === 'object') return 'jsonb';
  return 'text';
}

function enumCheck(column: string, property: Record<string, any>) {
  if (!Array.isArray(property.enum)) return '';
  const values = property.enum.filter((value: unknown) => value !== null).map((value: unknown) => `'${String(value).replaceAll("'", "''")}'`);
  return values.length ? `check (${quote(column)} in (${values.join(', ')}))` : '';
}

function isStructured(property: Record<string, any> | undefined) {
  const values = Array.isArray(property?.bsonType) ? property.bsonType : [property?.bsonType];
  return values.includes('array') || values.includes('object');
}

function renderFilter(filter: Record<string, unknown>) {
  return Object.entries(filter).map(([field, condition]) => {
    if (condition && typeof condition === 'object' && '$in' in condition) {
      const values = (condition as { $in: unknown[] }).$in.map((value) => `'${String(value).replaceAll("'", "''")}'`);
      return `${quote(field)} in (${values.join(', ')})`;
    }
    if (condition && typeof condition === 'object' && '$type' in condition) return `${quote(field)} is not null`;
    return `${quote(field)} = '${String(condition).replaceAll("'", "''")}'`;
  }).join(' and ');
}

function quote(identifier: string) { return `"${identifier.replaceAll('"', '""')}"`; }
