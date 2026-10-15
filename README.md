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
- bcrypt password hashing and database-backed signed JWT sessions

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set a production-quality `JWT_SECRET`.
3. Configure `SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY`. Apply the checked-in migration under `supabase/migrations` before starting the API.
4. Run `npm run dev` to start both the web dashboard and authentication API.

Keep local credentials in `.env` or an ignored `.env.supabase` profile. The secret key must never be placed in frontend variables or shared with a browser/mobile bundle.

Without Supabase or legacy MongoDB credentials, the API intentionally uses an in-memory demo store. This keeps the prototype reviewable, but records reset whenever the API restarts.

## Demo access

Local development only. Production hides these shortcuts and rejects the published default password. Rotate existing shared demo credentials in Supabase Auth before public deployment.

- Email: `admin@baliktela.demo`
- Password: `BalikTelaDemo2026!`

Producer, recycler, and consumer demo accounts use the same password and are listed in `server/seed.ts`.

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

Password recovery and email verification use single-use, hashed challenges in `auth_challenges`; reset credentials default to 30 minutes and verification credentials to 24 hours. Successful password changes and resets revoke every active session. `auth_rate_limits` stores only a server-derived subject hash and enforces configurable login lockouts and challenge-request throttles. Institutional approval requires verified email ownership and replacement of the temporary password. Development can expose challenge tokens through API responses with `AUTH_DEMO_DELIVERY=true`; production must leave that disabled and connect the same challenge issuance flow to an approved email provider.

Environmental impact factors, trust indicators, organization records, and activities remain clearly labeled demonstration data pending research and expert validation.
