# Web Security

Scope: the BalikTela web dashboard, public homepage, and supporting Express API. Mobile development is owned separately. Shared Supabase policies, functions, Auth configuration and key revocation require coordination with the mobile developer.

## Reporting a suspected incident

Contact the project owner privately. Do not put passwords, keys, personal records or exploit details in public GitHub issues. Preserve relevant Supabase/Render/GitHub audit logs and timestamps, restrict affected access, rotate exposed credentials, and follow the project's incident and privacy obligations. This repository does not provide a monitored vulnerability-reporting inbox.

## Controls

- All protected API operations check the signed access token, stored session, current account status, role permissions and applicable resource scope. Web refresh credentials are HttpOnly/Secure/SameSite cookies; rotating refresh requests require a CSRF token even when the credential is submitted in JSON. Native API refresh behavior is retained.
- Production Helmet headers enforce self-hosted scripts/connections, deny framing and plugins, restrict form targets and base URLs, and omit referrers. Inline styles remain allowed for charts/maps/printing; inline scripts and eval are not. HTTPS is required by runtime configuration. HSTS covers the web hostname, not uncoordinated sibling subdomains.
- API responses are no-store. Exact-origin CORS and mutation-origin checks reject foreign browser submissions. Originless authenticated API clients remain supported; origin checks do not replace authorization.
- Per-process IP limits are 600 API requests/minute and 60 authentication POSTs/15 minutes, excluding refresh/logout from the latter. Health checks are exempt. Persistent account-specific login and email-code limits remain. These are not a distributed DDoS defense. Configure an edge/WAF limit and a shared limiter before horizontal scaling; verify trusted-proxy/IP behavior in Render.
- JSON content type, body size, nesting, list/string sizes, query shape and credential types are bounded. Passwords are capped at 72 UTF-8 bytes to avoid silent bcrypt truncation. Domain validation and optimistic/atomic database writes remain authoritative.
- Aggregate-only analytics omit individual profiles and transaction lifecycles; facility metrics are grouped by region. Raw organization/facility registries are withheld for those accounts. This is not a claim of formal anonymization or protection against inference from small aggregate cohorts.
- Client errors omit parser bodies, filesystem paths, SQL and provider details. Failures use server-generated request IDs; raw request credentials and database exceptions are not logged by the API error handler. Password hashes and provider identity IDs are excluded from user responses.
- Server credentials are prohibited in private-looking VITE_* variables. Builds scan tracked/unignored files and browser artifacts for credential signatures and configured private values. CI checks production dependency advisories; Dependabot opens update PRs. These heuristic scans are not a full secret-detection service.

## Verification

```sh
npm test
npm run typecheck:api
npm run build:render
npm run test:auth
npm run test:security:ui
npm audit --omit=dev
npm run security:audit -- --history
npm run security:audit -- --database
```

The optional database audit uses SUPABASE_DB_URL from the ignored local profile and a read-only transaction. It inspects catalog grants, RLS flags, broad policies, security-definer execution privileges and public bucket metadata, never user/listing contents. It does not execute RPCs or apply migrations. Browser tests use isolated fixtures, not live accounts. Production CSP must be tested using the built app; Vite development mode intentionally does not enforce it.

## Assessment: October 17, 2026

**This review is not a penetration test, compliance certification or proof that no breach has occurred.** Provider audit-log/incident investigation, privileged account MFA and live authenticated mobile policy testing were not performed.

1. **Critical unresolved credential exposure:** a Supabase secret was previously posted in chat. No code change neutralizes this exposure. Supabase secret keys bypass RLS. Create a separate server-only replacement, update Render privately, verify the deployment, and coordinate all consumers before revoking the exposed key. Never include a secret key in a browser/mobile bundle. The review did not rotate keys or alter shared Auth settings.
2. **Verified and corrected locally:** aggregate-only analytics previously returned individual stakeholder/lifecycle details. Raw registry responses also did not honor that privacy flag. Web refresh could bypass CSRF checks by moving its credential into the request body. Missing security headers, incomplete IP throttling, parser/provider error exposure and a source-map-js dependency advisory were addressed. These fixes protect production only after publication and successful deployment.
3. **Read-only shared database assessment:** 37 public tables had RLS enabled. Web security tables had no client read grants; service-only web RPCs were not executable by anon/authenticated. No public storage buckets were found. A follow-up check confirmed anon/authenticated have no effective SELECT/INSERT/UPDATE grants on listings. Broad listing policies (`Basic Select`, `Enable read access for all users`, `Basic Insert`, `Basic Update`) remain dormant behind revoked grants and should be reviewed/removed with the mobile owner before any grants are introduced. Do not apply an indiscriminate REVOKE or policy migration to the shared database.
4. **Mobile-owned boundary:** five authenticated security-definer entrypoints were flagged for review. Their definitions include actor/ownership checks and were not callable by anon in the inspected configuration. This does not establish full mobile authorization correctness. The web task did not modify these functions or the mobile app.
5. **Dependency scope:** the post-patch production audit reported zero advisories. The full audit still reported nine development-tool findings in Tailwind 3's dependency chain and ExcelJS/uuid. No compatible fix was offered for these by npm at review time. Do not blindly use `npm audit fix --force`: it proposes a breaking Tailwind upgrade/ExcelJS downgrade. Keep build inputs trusted and handle their upgrades in a tested maintenance task. Render currently installs development dependencies to build; a clean runtime-only image is additional hardening.
6. **Credential scan:** checked-in history, current local source and the built browser bundle had no matching secret signatures/configured private values in the checks run. This is not proof that secrets were never exposed elsewhere. Local ignored .env files still require private storage and must not be uploaded.

## Production Checklist

- Rotate the exposed Supabase secret; review Auth/DB/storage/audit logs for misuse. Enable MFA on Supabase, GitHub and Render administrator accounts. Application-level administrator MFA still needs implementation/verification; platform-account MFA does not substitute for it.
- Deploy the security update and recheck response headers and authentication on https://baliktelaph.com. Local tests do not prove the deployed service is updated. Keep NODE_ENV=production, AUTH_DEMO_DELIVERY=false and a private random JWT_SECRET. Changing JWT_SECRET invalidates existing application access tokens; plan the rollout.
- Confirm exact CLIENT_ORIGIN=https://baliktelaph.com, correct Supabase invitation/recovery redirects, and no private VITE_* values. Retain only necessary redirect entries; coordinate mobile links separately.
- Review shared RPC/storage policies and backups with the mobile developer. Test cross-user read/write denial with controlled accounts before adding real participants. Never test destructive actions against real user data.
- Set log retention/access restrictions, monitor failed sign-ins/export spikes, establish incident ownership, and perform a backup/restore drill. Enable GitHub secret scanning/push protection where available.
- Review research dataset consent, retention and small-cohort disclosure rules before replacing synthetic records with personal data. Schedule an independent security assessment before production research collection.

References: [Express production security](https://expressjs.com/en/advanced/best-practice-security/), [Helmet](https://helmet.js.org/), [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Supabase securing data](https://supabase.com/docs/guides/database/secure-data).
