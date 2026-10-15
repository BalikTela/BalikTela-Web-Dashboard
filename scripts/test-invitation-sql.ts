import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

interface SqlEngine {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
}
const enginePath = process.env.CRUD_SQL_ENGINE ?? '/tmp/baliktela-sql-validation/node_modules/@electric-sql/pglite/dist/index.js';
const { PGlite } = await import(enginePath) as { PGlite: new () => SqlEngine };
const db = new PGlite();
const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';
try {
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key,email text,encrypted_password text,invited_at timestamptz,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
    create table public.users(id text primary key,auth_user_id uuid unique,email text,name text,username text,role text,active boolean,stakeholder text,organization_verified boolean,account_status text,privacy_consent boolean,research_consent boolean,notification_enabled boolean,scope jsonb,bio text,location text,phone text,avatar_uri text,updated_at timestamptz);
    create table public.auth_account_security(id text primary key,user_id text unique,email_verified_at timestamptz,password_changed_at timestamptz,updated_at timestamptz);
    create table public.sessions(id text primary key,user_id text,revoked_at timestamptz,updated_at timestamptz);
    create role anon;
    create role authenticated;
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20261015080000_invitation_password_initialization.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/20261015110000_auth_password_session_revocation.sql', import.meta.url), 'utf8'));
  const security = async (authId: string) => (await db.query<{ password_changed_at: string | null; email_verified_at: string | null }>('select security.* from public.auth_account_security security join public.users profile on profile.id=security.user_id where profile.auth_user_id=$1', [authId])).rows[0];
  await db.query("insert into auth.users(id,email,invited_at,encrypted_password) values($1,'invite@example.test',now(),'')", [first]);
  assert.equal((await security(first)).password_changed_at, null);
  await db.query("insert into public.sessions(id,user_id) select 'before-confirmation',id from public.users where auth_user_id=$1", [first]);
  await db.query('update auth.users set email_confirmed_at=now(),encrypted_password=$2 where id=$1', [first, 'provider-generated-value']);
  assert.ok((await security(first)).email_verified_at);
  assert.equal((await security(first)).password_changed_at, null);
  assert.equal((await db.query<{revoked_at:string|null}>("select revoked_at from public.sessions where id='before-confirmation'")).rows[0].revoked_at, null);
  await db.query('update auth.users set encrypted_password=$2 where id=$1', [first, 'user-chosen-password-hash']);
  assert.ok((await security(first)).password_changed_at);
  assert.ok((await db.query<{revoked_at:string|null}>("select revoked_at from public.sessions where id='before-confirmation'")).rows[0].revoked_at);
  await db.query("update public.users set role='Researcher' where auth_user_id=$1", [first]);
  await db.query("update public.auth_account_security set id='custom-web-security-id' where user_id=(select id from public.users where auth_user_id=$1)", [first]);
  await db.query('update auth.users set email=$2 where id=$1', [first, 'updated@example.test']);
  assert.ok((await security(first)).password_changed_at);
  assert.equal((await db.query<{role:string}>('select role from public.users where auth_user_id=$1', [first])).rows[0].role, 'Researcher');
  await db.query("insert into auth.users(id,email,encrypted_password) values($1,'signup@example.test','chosen-at-signup')", [second]);
  assert.ok((await security(second)).password_changed_at);
  console.log(JSON.stringify({ result: 'passed', checks: ['invitation has no initialized password', 'provider confirmation is not password creation or session revocation', 'recipient password creation initializes security marker and revokes sessions', 'canonical role and custom security ID preserved', 'participant signup password retained'] }, null, 2));
} finally { await db.close(); }
