# BalikTela Web Platform

Research prototype for circular textile analytics, participant profiles, and traceable barter exchanges.

Development scope: this repository focuses on the web dashboard, its public homepage, and supporting API. A separate developer owns the mobile application. Coordinate shared schema and authentication changes with that developer; mobile implementation is outside this repository's scope.

Database integration baseline: [Supabase Migration and Shared Schema](docs/Supabase_Migration.md)

Current prototype model: [BalikTela ERD](docs/BalikTela_ERD.md)

Deployment: [Render Setup](docs/Render_Deployment.md). The repository includes `render.yaml` for one web service serving the dashboard and API together.

Security controls, assessment limits, unresolved credential exposure and deployment checklist: [Web Security](SECURITY.md).

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

### October Operational Demo

The additive `synthetic-operational-october-2026-v1` scenario covers October 1-16, 2026: 24 explicitly synthetic batches across four regions and six textile categories, with linked measurements, listings, transfers, lifecycle events, recovery balances, demo rewards and aggregate engagement summaries. It represents an illustrative month-to-date scenario, not measured October performance or a full-month projection. The predictive training dataset is unchanged.

Run `npm run db:supabase:seed-october` for a read-only preflight. To intentionally insert it, run `SUPABASE_SYNTHETIC_SEED=true npm run db:supabase:seed-october -- --apply`. The command reads the ignored `.env.supabase` profile, requires existing fictional SYN registry records, inserts only its OCT26 namespace in one transaction, and verifies existing rows are unchanged. It does not create/reactivate accounts, change permissions, rewrite earlier months or alter the shared mobile schema. A complete existing fixture is a no-op; partial fixtures abort for manual review. The legacy full-history seed remains a separate upsert command and must not be used to refresh this shared dataset.

## Reporting periods and exports

- Operational reporting uses `Asia/Manila` calendar dates, not a fixed demo cutoff. Last 30/90 days include today through the generation timestamp. The previous comparison is the immediately preceding equal elapsed duration; year-to-date compares with the previous calendar year through the same local date/time, clamping leap day to February 28. All time has no previous comparison.
- Custom dates are inclusive calendar dates. Today's end is capped at now; future, reversed, malformed and incomplete windows return HTTP 400. Monthly capacity uses actual calendar-month fractions rather than a fixed 30-day assumption. Long windows are limited to ten years.
- Date filters select **batch-registration cohorts**. Outcomes use the latest recorded evidence through generation time, not reconstructed historical states. An old registration cohort can therefore include a later completion. Cohort intake / modeled window capacity is not a claim of historical calendar utilization. Engagement uses interaction timestamps within the selected window and assigned access scope. Monthly-active-user summaries use the final selected calendar month, not the last month that happened to contain data.
- Reports uses the global filters and the same cohort selector, mass aggregation and data-quality rules as analytics. Four report types have distinct content: material flow, quality, organization participation and environmental methodology status. CSV and printable reports include the period, timezone, generation time, role/scope, filters, definitions and units. Exports are regenerated when requested; concurrent operational changes can produce a newer result than a previously loaded preview.
- CSV exports retain up to six decimal places in metric tons, correctly quote delimiters/newlines and neutralize spreadsheet formula prefixes. Aggregate-only reports group organizations and omit names, emails and source identifiers, including identifying filter values. Export permission is rechecked for every request. Unknown report IDs return 404; invalid filters/formats return 400, without creating export audits.
- Preview: `GET /api/reports/:reportId/preview` requires `reports.read`. CSV: `GET /api/reports/:reportId/export`; printable data: the same export route with `format=print`. Both export formats additionally require `reports.export` and create an audit event. Previewing alone does not record an export. Print / PDF prepares the selected report's **complete table** on a dedicated page with print styles and a Save as PDF action, not the report catalog or only the current pagination page. It uses the browser's PDF support, not a server PDF service.
- Existing unfiltered material/transfer/recovery registry API calls retain all-time access within their existing permissions. Dashboard callers pass explicit periods. The predictive PoC remains on its separate fixed synthetic snapshot.
- `npm run test:reports:ui` covers seven viewport sizes, all report types, rolling/custom dates, filters, CSV downloads, printable full data/PDF generation, pagination, invalid/empty periods, and read-only researcher access. Unit/API tests cover Manila/year/leap boundaries, exact report/analytics totals, discrepancy thresholds, aggregate exports and CSV parsing.

## Synthetic predictive analytics PoC

Advanced Analytics > Predictive provides four-week weekly collection forecasts, projected platform-declared textile waste, and category-conditioned recycler offer-selection tendencies. All outputs are conspicuously synthetic and non-production. The dashboard includes diagnostic and predictive views only; prescriptive analytics is outside its current scope. No new Supabase tables or live operational writes are used.

- Bundled artifacts: `data/predictive/v1/observations.csv` (9,600 linked event records), `manifest.json`, `evaluation.json`, and `data-dictionary.json`. Regenerate deterministically with `npm run analytics:poc:generate` (seed 20261016). The canonical JSON observation checksum is in the manifest.
- Coverage: 120 complete Monday-Sunday UTC weeks, 24 June 2024 through 11 October 2026. Four forecast weeks begin 12 October 2026. This is a fixed demonstration snapshot, not a continuously updating live prediction.
- Chronological split: 6,720 training records / 84 weeks; 1,440 validation / 18 weeks; 1,440 test / 18 weeks (70/15/15). Events aggregate to 120 weekly time points, not 9,600 independent weekly samples.
- Volume models compare last-value, trailing 8-week mean, trailing 26-week OLS trend, and 52-week seasonal naive baselines. Validation MAE selects each method before testing. Both held-out blocks use 15 rolling origins with four horizons, giving 60 overlapping forecast errors. Previously observed test history may enter subsequent origins; future outcomes cannot. Final forecasts refit the selected methods on all available past history.
- Weekly ranges are nominal 80% empirical validation-error quantiles, not guaranteed coverage. The interface reports actual test coverage, MAE in tons, and WAPE (sum absolute errors / sum observed mass). Collection cannot exceed declared mass. The four-week sum has no claimed confidence interval.
- Recycler tendencies use Beta(1,1)-smoothed binary selection rates by offered category, not market shares or individual recycler recommendations. A validation-selected recency window is tested with log loss and Brier score against a category-blind pooled baseline. Actual selected shares have a separate denominator and label.
- Every scope requires at least 600 observations and 104 active weeks. These are PoC sufficiency heuristics, not approved research thresholds. Sparse region/category combinations intentionally show no prediction. Region/material filters affect all model outputs; the historical-view selector changes chart history only. Operational cohort filters are hidden in this mode because this dataset is separate.
- `GET /api/analytics/predictive` requires `analytics.predictive.read`, assigned centrally to Administrator, Government, and Researcher. Current sessions and account status are checked on every request. Government/research region limits are enforced. The dataset-export endpoint additionally requires `reports.export` and exports only the selected permitted synthetic scope. Raw fixture records never enter the frontend bundle.
- `npm test` checks data reproducibility, chronological partitions, mass accounting, percentage denominators, sparse gates, API authorization and region-restricted exports. `npm run test:predictive:ui` checks all three views, filter effects, error/retry, download, cache reuse, chart pixels and seven viewport sizes against the actual model builder using isolated browser fixtures.

The generator deliberately contains seasonality, regional mass scales and category selection patterns. Good synthetic test scores demonstrate the pipeline only, not real-world accuracy. Production use still requires real mobile-to-web data quality checks, approved target definitions, methodology ownership, acceptance thresholds, external validation and monitoring. Method references: [Simple Statistics](https://simple-statistics.github.io/docs/) and [Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html).

## Dashboard motion

Workspace transitions preserve mounted pages, filters, pagination and API caches. Shared viewport observers reveal panels, flow stages, sparklines and percentage bars once as they become visible; stagger delays are capped at 140 ms. Numbers remain immediately available, without simulated count-ups. Page fades take 200 ms, content feedback 160 ms, section entrances 280 ms, charts 360 ms and sparkline strokes 540 ms. No decorative looping animations or additional animation dependency are used.

`src/lib/motion.tsx` owns page activity, reactive system reduced-motion preferences and content transitions. `src/hooks/useChartMotion.ts` coordinates Chart.js entrances and data updates, settles inactive/offscreen charts, and stops drawing in background tabs. Reduced motion cancels programmatic entrances and renders chart values immediately, including when the preference changes while the dashboard is open. The native record editor, existing drawers, filters and mobile navigation use short CSS transitions with the same reduced-motion fallback.

Design references: [shadcn/ui sheets](https://ui.shadcn.com/docs/components/sheet), [Motion accessibility](https://motion.dev/docs/react-accessibility), [Chart.js animations](https://www.chartjs.org/docs/latest/configuration/animations.html), and [design-motion-principles](https://github.com/kylezantos/design-motion-principles). Patterns are adapted to the existing dashboard rather than copied or installed as external skills.

`npm run test:motion:ui` uses isolated browser fixtures at seven widths from 320 to 2560 px in normal and reduced-motion modes. It checks chart frames and final pixels, viewport reveals, cache preservation, filters, pagination focus, drawers, record editors, configuration, profile, predictive charts, runtime preference changes, idle rendering and overflow. It is also included in `npm run test:security:ui` against production CSP headers. No Supabase writes or email sends are needed.

## Centralized permissions

`server/access-control.ts` is the authoritative role-permission and operational-scope policy. Every protected API endpoint declares a permission, reloads the current account before authorization, and applies organization, facility, aggregate-only, and export boundaries. Login and session restoration return the effective permission list so the web navigation uses the same policy as the API.

## Authentication sessions

Login and registration create a canonical Supabase PostgreSQL record in `sessions`. Access JWTs are short-lived and held only in web memory. Web refresh credentials rotate through an `HttpOnly`, `SameSite=Lax` cookie and require a matching CSRF header; mobile and API clients receive their rotating refresh credential in JSON for secure device storage. PostgreSQL stores only SHA-256 hashes, retains a bounded history for replay detection, and atomically revokes a session when a used refresh credential is replayed. Users can review active sessions, revoke another session, sign out the current session, or sign out all devices. Administrator changes to account verification, role, status, or scope revoke affected active sessions. `AUTH_ACCESS_TTL_SECONDS` defaults to 15 minutes and `AUTH_REFRESH_TTL_SECONDS` defaults to 30 days.

The web dashboard checks its session every 15 seconds while visible and immediately on focus, returning online, or returning to a hidden tab (with a two-second event debounce and an eight-second request timeout). Current API authorization remains immediate; this check removes stale cached UI even when the user is idle. Role changes return `ACCOUNT_CHANGED`; unavailable accounts and revoked/expired sessions have separate codes. Security-relevant role, scope, permission, verification and account changes require a new login; profile text edits, ordinary permission denials, network failures and temporary 503 responses do not. Hidden tabs check when brought forward. This is bounded polling, not a real-time push guarantee.

Forced sign-out removes mounted private pages, clears session-scoped analytics/model caches and in-memory credentials, and displays a fixed explanation on `/login`. Only a non-secret reason code is retained in tab session storage so reloading cannot silently restore the session before manual sign-in. A new login clears the notice and loads fresh access. Late responses from a previous authentication epoch cannot replace current credentials or refill caches. Best-effort old-session revocation uses a bearer-only, cookie-free logout request so its response cannot clear a newly issued login cookie. No shared database schema or mobile UI changes are needed. `npm run test:session:ui` covers idle/focus sign-out, explanation persistence, changed-role navigation, same-role cache clearing, outage resilience, normal token refresh, ordinary 403s, old-response races and mobile notice layout with isolated browser fixtures.

Supabase sends confirmation and recovery emails through the configured SMTP provider. Institutional invitees verify a native one-time email code and receive a single-use, password-only authorization stored as a hash in `auth_challenges`; no temporary password is emailed. Approval requires verified email ownership and a privately initialized password. Successful password changes revoke every application session, including native password changes made from mobile. `auth_rate_limits` stores only a server-derived subject hash and enforces login lockouts and challenge throttles. Keep `AUTH_DEMO_DELIVERY=false` for shared Supabase and deployment; isolated memory tests use their own fixtures. See [Invitation Setup](docs/Invitation_Setup.md) for hosted email templates and redirects.

Environmental impact factors, trust indicators, organization records, and activities remain clearly labeled demonstration data pending research and expert validation.
