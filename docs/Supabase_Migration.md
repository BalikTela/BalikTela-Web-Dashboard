# BalikTela Supabase Migration

Status: implementation baseline for shared web/mobile development  
Database: Supabase PostgreSQL  
Schema migration: `supabase/migrations/20261007040000_baliktela_schema_v2.sql`

## Architecture

- Web and mobile clients continue to call the BalikTela API for governed operational data.
- The API uses `SUPABASE_URL` and a server-only secret key through the official Supabase JavaScript client.
- The secret key is never exposed through Vite, browser code, mobile code, or API responses.
- Existing string IDs remain authoritative so offline/mobile records do not require an immediate UUID rewrite.
- `users.auth_user_id` is an optional bridge to `auth.users` for a coordinated future Supabase Auth migration.
- Application roles, institutional approval, operational scope, and aggregate-only restrictions remain centralized in the BalikTela API.

## Schema

The migration creates all 36 canonical tables with typed PostgreSQL columns, enum checks, primary keys, indexes, and Row Level Security. Access for `anon` and `authenticated` is revoked because the current clients use the governed backend API. The server secret receives table access and can execute only the required authentication functions.

Atomic PostgreSQL functions protect the concurrency-sensitive authentication operations:

- `rotate_auth_session`
- `consume_auth_challenge`
- `record_auth_rate_limit_failure`

## Required server environment

```dotenv
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_DB_URL=postgresql://...
SUPABASE_SCHEMA_APPLY=false
DATABASE_SEED_DEMO=false
DATABASE_SYNC_TEST=false
```

Legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted during transition, but a current server secret key is preferred. Never prefix the secret with `VITE_`.

## Deployment sequence

1. Apply the checked-in SQL migration with `SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply`.
2. Configure the API server environment.
3. Start the API and confirm `/api/health` reports `supabase`.
4. Seed only an empty project with `DATABASE_SEED_DEMO=true npm run db:supabase:seed`.
5. Run `DATABASE_SYNC_TEST=true npm run db:supabase:test-sync` against the running API.
6. Verify login, refresh rotation, replay rejection, email verification, password recovery, role restrictions, and administrator approval.
7. Give the mobile application the shared API base URL, table contract, enum vocabulary, and synchronization test IDs. Do not give it the server secret.

Run the repeatable authentication acceptance test with `SUPABASE_AUTH_TEST=true npm run db:supabase:test-auth`. It creates an isolated participant account and removes its user, session, challenge, security, and audit records after verification.

## MongoDB transition

MongoDB support is retained temporarily as a rollback and migration source. Supabase takes precedence whenever its URL and secret are configured. Atlas must be treated as read-only after migration begins so records do not diverge across two active databases.
