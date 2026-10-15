# BalikTela Management CRUD

## Dashboard workflows

| Module | Create | Read | Update | Removal and restoration |
| --- | --- | --- | --- | --- |
| Accounts | Institutional invitations; participant registration | User directory and profile | Name, city, region, approval, role, organization, region/facility scope, export permission | Deactivate/suspend; restore after verification checks |
| Organizations | Register institution | Searchable registry | Name, classification, location, contact, materials, service coverage, verification, status | Deactivate/restore; unresolved transfers block deactivation |
| Facilities | Register facility under organization | Facility registry and analytics | Name, type, location, capacity, intake, materials, service coverage, verification, availability | Deactivate/restore; organization changes are blocked after recovery history exists |
| Material batches | Administrative registration with source attribution and initial measurement | Registry and measurement history | Correct uncommitted metadata and append weight evidence | Archive/restore; transfer-linked records are protected |
| Listings | Existing mobile/API workflow | Listing oversight | Administrative title/description correction and availability moderation | Close/reopen; closing declines pending offers |
| Offers | Existing mobile/API workflow | Offers tab in traceability | Revise pending terms, approve, decline | Decline/withdraw; finalized decisions remain historical |
| Transfers | Created automatically when an offer is accepted | Traceability and lifecycle history | Handover, receipt, validation, confirmed completion, dispute resolution | Cancel/reject unfinished transfers; final records remain immutable |
| Recovery | Record an operation | Recovery monitoring | Edit drafts, validate, flag, replace incorrect validated records | Reverse a record; originals and replacements remain visible |
| Configuration | Add reference values in taxonomy fields | Taxonomies and rule controls | Update values, thresholds, rates, matching weights | Remove reference values or reset rules; core configuration remains present |
| Profile | Created with account | My Profile | Personal/institutional profile fields | Account deactivation through user management |

Analytics, reports, engagement summaries, stakeholder performance, governance indicators, and data-quality findings are derived views. They are changed by correcting their source records. Audit entries are retained rather than edited or deleted.

Web controls remain administrative. Participant listing creation, proposal submission, messages, and wallet participation remain in the mobile/shared API workflow.

## Persistence and authorization

- `apply_management_mutations` saves related canonical rows and their audit entry in one PostgreSQL transaction.
- Failed writes roll back the complete batch. Expected source values reject conflicting updates.
- Only `service_role` can execute the function; browsers use the role-checked web API.
- Updates modify changed fields and merge JSON objects so fields maintained by mobile are retained.
- User credentials are excluded from management audit snapshots.
- Government/research aggregate audit responses hide record-level details.
- The last active administrator is protected in both application validation and the database transaction.
- Account deactivation revokes application sessions and bans the linked Supabase Auth identity.
- Account provisioning reuses a profile already created by the shared Supabase Auth trigger instead of inserting a duplicate. Canonical profile IDs and mobile-owned fields are preserved.
- Deactivated accounts also set the shared `active` field to `false`.
- Successful mutations refresh loaded registries, analytics, and quality checks. In-flight pre-write reads cannot repopulate invalidated server caches.
- HTTP `DELETE` maps to deactivation, archival, closure, reversal, or cancellation and uses the same permissions and checks as `PATCH`.

## Deployment

Apply the additive migration using the project's database connection:

```sh
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply -- --migration 20261014090000_management_transactions.sql
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply -- --migration 20261014100000_management_conflict_response.sql
```

The same SQL files can be executed in order in the project's Supabase SQL Editor. Apply both: the follow-up uses `PT409` for business conflicts, avoiding PostgREST retries associated with `40001`. Multi-record writes report that the base migration is required until it is applied. Single-record legacy authentication/profile updates retain a compatibility path during deployment.

## Verification

```sh
npm run build
npm run typecheck:api
npm test
```

An isolated API is used for acceptance tests so shared records and email recipients are not affected:

```sh
SUPABASE_URL= SUPABASE_SECRET_KEY= SUPABASE_PUBLISHABLE_KEY= MONGODB_URI= PORT=4011 npm run dev:api
CRUD_TEST_RUN=true npm run test:crud
API_PROXY_URL=http://127.0.0.1:4011 npm run dev:web -- --port 5180 --strictPort
npm run test:crud:ui
```

SQL verification runs the actual migrations in a temporary PostgreSQL engine. That optional tool is installed outside the repository:

```sh
npm install --prefix /tmp/baliktela-sql-validation --no-audit --no-fund @electric-sql/pglite
npm run test:crud:sql
```

The tests cover transactions, canonical status aliases, mobile-owned fields, role denial, account approval/deactivation, lifecycle ordering, measurement history, recovery replacement/reversal, and responsive form submission.

After the migration is applied, the live Supabase acceptance suite can be run against the local API:

```sh
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_CRUD_TEST=true npm run test:crud:supabase
```

This opt-in suite creates its own temporary demo Auth identities without sending invitations or email. It validates management workflows, session revocation, recovery history, atomic rollback, stale-update protection, and anonymous RPC denial. It removes only its own test records and Auth identities in a `finally` cleanup. Configuration testing writes the existing reward rate without changing shared rules. `CRUD_TEST_API_URL` overrides the default `http://127.0.0.1:4000/api`.
