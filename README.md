# BalikTela Web Platform

Research prototype for circular textile analytics, participant profiles, and traceable barter exchanges.

Database integration baseline: [Supabase Migration and Shared Schema](docs/Supabase_Migration.md)

Current prototype model: [BalikTela ERD](docs/BalikTela_ERD.md)

Deployment: [Render Setup](docs/Render_Deployment.md). The repository includes `render.yaml` for one web service serving the dashboard and API together.

## Technology

- React and TypeScript for the web interface
- Node.js and Express for API services
- Supabase PostgreSQL for shared persistent platform data
- Chart.js for dashboard visualizations
- Supabase Auth for credentials and database-backed signed JWT application sessions

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set a production-quality `JWT_SECRET`.
3. Configure `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY`. Apply the checked-in migrations under `supabase/migrations` before starting the API.
4. Run `npm run dev` to start both the web dashboard and authentication API.

Keep local credentials in `.env` or an ignored `.env.supabase` profile. The secret key must never be placed in frontend variables or shared with a browser/mobile bundle.

Without Supabase or legacy MongoDB credentials, the API intentionally uses an in-memory demo store. This keeps the prototype reviewable, but records reset whenever the API restarts.

## Public homepage

- `/` introduces the project, textile pathways, community roles, and the two platforms. It never mounts authentication or requests protected dashboard data.
- `/login` opens institutional sign-in; `/dashboard` restores the authorized workspace. The sign-in logo links back to the public homepage.
- Existing invitation, confirmation, and recovery callbacks at the root URL continue to take precedence over the homepage. Keep existing Supabase redirect settings.
- Mobile calls to action open the project-approved app at `https://baliktelaprogressive.vercel.app/` in a new tab. An optional `VITE_MOBILE_APP_URL` HTTPS override is read at build time; rebuild after changing it. This is a public URL, never a place for credentials. No app-store release is implied.
- No new backend routes, database migrations, or public data permissions are required. The existing Render service serves the public page, sign-in, and dashboard.
- `npm run test:home:ui` checks seven viewport sizes, public request isolation, imagery, mobile app links, keyboard navigation, dialogs, FAQs, and sign-in navigation. The default preview URL is `http://127.0.0.1:5174`; override with `HOME_UI_URL` when needed.
- Content follows the finalized blueprint in `../Documents/Balik Tela PH Web and Mobile Blueprint.docx`. Illustrative images and design references are documented in `public/ASSET_SOURCES.md`. No live environmental impact totals or prospective partner endorsements are published.

## Account access

Sign in with your approved private account. Institutional accounts are invited by an administrator and choose their own password through the email setup flow. Login fields are never prefilled with shared credentials.

The six published demo identities have been deactivated and banned in the shared Supabase project; their linked sample history is preserved. Demo login shortcuts and the old identity provisioning command have been removed. Seed accounts remain only as isolated test fixtures, not deployable credentials.

For the owner-only backup administrator command and private password rotation, see [Authentication](docs/Authentication.md#private-administrators-and-emergency-access). There is no hard-coded password or backdoor.

## Verification

- `npm run build` checks and builds the React application.
- `npm run typecheck:api` checks the Express API.
- `npm run build:render` builds the dashboard and compiles the API for deployment.
- `npm start` runs the compiled API and, in production, serves the built dashboard.
- `npm run db:supabase:generate` regenerates the PostgreSQL migration from the canonical schema contract.
- `DATABASE_SEED_DEMO=true npm run db:supabase:seed` seeds an empty Supabase project with explicitly labeled demo records.
- `DATABASE_SYNC_TEST=true npm run db:supabase:test-sync` writes temporary mobile-style records, verifies them through the web API, and removes them.
- Legacy MongoDB schema commands remain available only for controlled data migration and rollback during the transition.

The seed command refuses to run when the target already contains users. Seeding never runs automatically during API startup.

## Access control

`server/access-control.ts` is the authoritative role-permission and operational-scope policy. Every protected API endpoint declares a permission, reloads the current account before authorization, and applies organization, facility, aggregate-only, and export boundaries. Login and session restoration return the effective permission list so the web navigation uses the same policy as the API.

## Authentication sessions

Login and registration create a canonical Supabase PostgreSQL record in `sessions`. Access JWTs are short-lived and held only in web memory. Web refresh credentials rotate through an `HttpOnly`, `SameSite=Lax` cookie and require a matching CSRF header; mobile and API clients receive their rotating refresh credential in JSON for secure device storage. PostgreSQL stores only SHA-256 hashes, retains a bounded history for replay detection, and atomically revokes a session when a used refresh credential is replayed. Users can review active sessions, revoke another session, sign out the current session, or sign out all devices. Administrator changes to account verification, role, status, or scope revoke affected active sessions. `AUTH_ACCESS_TTL_SECONDS` defaults to 15 minutes and `AUTH_REFRESH_TTL_SECONDS` defaults to 30 days.

Supabase sends confirmation and recovery emails through the configured SMTP provider. Institutional invitees verify a native one-time email code and receive a single-use, password-only authorization stored as a hash in `auth_challenges`; no temporary password is emailed. Approval requires verified email ownership and a privately initialized password. Successful password changes revoke every application session, including native password changes made from mobile. `auth_rate_limits` stores only a server-derived subject hash and enforces login lockouts and challenge throttles. Keep `AUTH_DEMO_DELIVERY=false` for shared Supabase and deployment; isolated memory tests use their own fixtures. See [Invitation Setup](docs/Invitation_Setup.md) for hosted email templates and redirects.

Environmental impact factors, trust indicators, organization records, and activities remain clearly labeled demonstration data pending research and expert validation.
