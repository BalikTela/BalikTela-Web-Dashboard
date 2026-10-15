# Deploy BalikTela to Render

The repository root contains the contents of `BalikTela Dev`, not the parent workspace or its research documents. One Node web service serves the compiled React dashboard and the existing Express API on the same origin. Supabase remains the shared database and identity provider.

## Before deployment

- Never upload `.env`, `.env.supabase`, `.env.atlas`, database passwords, or private keys. They are ignored by Git.
- Rotate any Supabase secret or database password previously shared in chat or screenshots. Put replacement credentials only in local ignored files and Render's environment settings.
- The six published demo identities in the current project have been retired in shared Supabase Auth. Preserve that state; do not rerun demo identity/data provisioning against the shared database. For a different environment, use the gated retirement command in `docs/Authentication.md` after verifying a private administrator.
- Keep sample data labeled as demo. The build does not seed, migrate, or modify the database.
- The checked-in Supabase migrations must already be applied. Coordinate schema changes with the mobile developer; do not reseed the shared database.

## Deploy with the Blueprint

1. Sign in to Render and connect the GitHub account with access to `BalikTela/BalikTela-Web-Dashboard`.
2. Choose **New > Blueprint**, select the repository, and use `main` and the root `render.yaml`.
3. Fill in `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_PUBLISHABLE_KEY` from the current project's credentials. Enter values in Render, not GitHub source code.
4. Review the service and create the deployment. The Blueprint selects the Free plan and generates a private `JWT_SECRET`. Review Render's current plan limits before relying on it for presentations or production.
5. Wait for the build and health check to complete. Open the service's assigned HTTPS URL.

The Blueprint uses:

| Setting | Value |
| --- | --- |
| Runtime | Node.js 24 |
| Branch | `main` |
| Root directory | Leave blank |
| Build command | `npm ci --include=dev && npm run build:render` |
| Start command | `npm start` |
| Health check | `/api/health` |
| `NODE_ENV` | `production` |
| `AUTH_DEMO_DELIVERY` | `false` |

Render supplies `PORT` and `RENDER_EXTERNAL_URL`. The API listens on `0.0.0.0:$PORT`. Its CORS origin and email callback URL use `CLIENT_ORIGIN` if explicitly set, otherwise the assigned Render URL. For a custom domain, set `CLIENT_ORIGIN=https://your-domain` and redeploy.

For manual deployment, choose **New > Web Service**, connect the same GitHub repository, and enter the settings above. Also set the three Supabase variables and a randomly generated `JWT_SECRET` of at least 32 characters. Do not set a MongoDB URI, migration flags, seeding flags, or demo-delivery flags.

No frontend Supabase environment variables or direct PostgreSQL password are required. Server-only secrets are not bundled into the web assets.

## Supabase authentication settings

1. In Supabase Authentication URL Configuration, preserve the shared Site URL and existing mobile redirects. Add `https://YOUR-SERVICE.onrender.com/**` to the Redirect URLs allowlist so both `/?auth=complete` and `/?auth=setup` work, including recovery parameters.
2. Keep localhost redirects only while local development needs them. Add the equivalent HTTPS origin if using a custom domain. Never deploy with `CLIENT_ORIGIN=http://localhost:5173`.
3. Configure production SMTP for invitations, email confirmation, and recovery. Production does not return development invitation links or challenge tokens.
4. Sign in using an approved account with a private password. Verify refresh after reload, logout, and role-specific navigation. Do not create a new shared-password administrator for the deployment.
5. Apply `20261015110000_auth_password_session_revocation.sql` after the existing authentication migrations. This additive trigger revokes old web sessions when the shared Supabase password changes, including from mobile; installing it does not change existing credentials.

On October 15, 2026, the six published demo identities were deactivated, their Supabase identities banned and passwords randomized, and web sessions revoked. The primary and existing private personal administrators were preserved. This also retires those demo logins on mobile without deleting sample history. The optional fixed backup uses normal Supabase authentication, a privately supplied password, and the owner-only command documented in `docs/Authentication.md`; never add a hard-coded password or bypass. Do not set backup provisioning/password or demo-retirement variables on Render. Rotate server secrets previously posted in chat as well; do not commit replacement values.

## Verification and maintenance

- `/` must load the login page with empty credentials and no demo selector.
- `/api/health` must return `status: "ok"` and `storage: "supabase"`. This endpoint is a process health check, not a full database connectivity test; verify an approved sign-in and dashboard read as well.
- Confirm loaded data matches the existing Supabase dataset. Mutations use the same API and permissions as local development.
- Confirm unknown `/api/...` endpoints return JSON 404 errors, not dashboard HTML.
- GitHub Actions checks the API types, backend tests, and production builds without database secrets.
- Deployments from the linked GitHub branch can be configured to update automatically. A Render deployment is separate from pushing code to GitHub.

References: [Render Node/Express deployment](https://render.com/docs/deploy-node-express-app), [Blueprint specification](https://render.com/docs/blueprint-spec), [Node version selection](https://render.com/docs/node-version), [Web service port binding](https://render.com/docs/web-services#port-binding).
