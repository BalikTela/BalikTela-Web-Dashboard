# BalikTela Authentication

## Identity model

Supabase Auth is the credential authority. The public `users` table stores the application profile, role, organization, verification state, and access scope. It does not store passwords after an identity is linked.

- `auth.users.id` is stored as `public.users.auth_user_id`.
- Role and access claims are read from `public.users`, never trusted from browser input or Auth user metadata.
- The Supabase secret key is server-only. The browser communicates through `/api`.
- BalikTela application sessions remain revocable, rotating, and auditable.

## Account creation

### Web dashboard access

Only `Administrator` (displayed as Admin), `Government`, and `Researcher` may sign in to the web dashboard. Login, refresh, and protected API routes enforce this rule regardless of a supplied client type. Previously issued participant tokens cannot access dashboard APIs. Mobile authentication, roles, approvals, and operational history are unchanged.

- Admin has full administration, including all account groups, approvals, Hub assignments, operational changes, settings, and security logs. Self-demotion and removal of the last active administrator remain blocked.
- Government is always summary-only within its assigned regions, regardless of its stored aggregate flag. It cannot read individual material/transfer records, edit operational data, view security logs, or use predictive models. Authorized summary report downloads remain separately controlled.
- Researcher has read-only analytics and research access. Listing, batch, measurement, facility, recovery, and transaction views replace identifiers with researcher-specific coded references and withhold names, contact details, addresses, and free-text notes. Summary-only research accounts remain more restricted. Hub performance and report downloads use regional/de-identified summaries; export permission is separate.
- Named participant, organization, and Hub-ID filters are restricted to Admin. Non-admin report exports use the same privacy boundaries as previews.

User Accounts groups existing accounts as **Admin**, **Government**, **Researcher**, **Producer / Consumer**, and **Recycler / Hub**. The latter two are mobile-only groups, not merged roles. Legacy NGO, Upcycler, and collection-point accounts remain manageable in the appropriate participant group without converting their source roles. Web invitations offer only the three dashboard roles.

### Participant registration

Participants register and sign in through mobile. The dashboard's `/api/auth/register` endpoint rejects participant creation and does not create a user or session. Admin can still manage existing participant accounts in User Accounts.

### Institutional invitation

1. An administrator selects **Dashboard account** in User Accounts.
2. The administrator assigns the intended role and organization.
3. Supabase sends an invitation with a one-time setup code; the administrator never creates or sees the password.
4. The recipient opens the dashboard's `/?auth=setup` page and enters their email and code. This screen is displayed even if another user is already signed into that browser.
5. The API verifies the native Supabase code and issues a single-use password-only authorization valid for 10 minutes. It does not issue a dashboard session or expose provider tokens. **Create your password** includes password confirmation and the verified recipient email. Creating a password never signs in as, or changes the role of, the administrator who sent the invitation.
6. The recipient chooses a private password and signs in with it. Email confirmation alone does not initialize a password.
7. The profile remains `Pending verification` until an administrator verifies it.
8. Approval activates the centrally defined role and scope. The User Accounts security column distinguishes email verification from password initialization.

Government accounts use summary-only access. New Researcher invitations support de-identified records, and Admin can further restrict them to summaries. Administrator creation is restricted to an existing administrator, and the last active administrator cannot be removed.

Existing callbacks still support standard Supabase fragment credentials and token-hash email templates. Credentials are removed from the address bar and verified through the API. For password setup, the server verifies recent native OTP/invite/recovery claims, signs out the provider session, and returns only a single-use setup authorization. Ordinary Supabase password-login sessions cannot authorize password reset, and the same provider session cannot mint another setup authorization. A bare `?auth=complete` is not proof of confirmation. Expired invitations can be recovered through **Request a new code** or **Forgot password** using the invited email; do not delete/recreate the account.

`20261015080000_invitation_password_initialization.sql` corrects the shared Auth profile trigger. It keeps the mobile profile ID convention and existing roles, distinguishes provider invitation confirmation from a recipient-selected password, and preserves security records whose IDs differ from the profile ID. Existing still-unconfirmed invitations have their incorrectly initialized password marker cleared. Already-confirmed legacy invitations can finish setup through a fresh recovery email.

## Recovery and sessions

- Password recovery responses do not disclose whether an account exists.
- Recovery and invitation links are handled by the Auth page and expire according to Supabase settings.
- Native invitation/recovery codes are accepted by the web API for 10 minutes from the provider's issue timestamp, with email and IP attempt limits. Password setup authorizations are stored as hashes and consumed atomically; no temporary password is emailed.
- Password changes revoke all BalikTela application sessions. The additive `20261015110000_auth_password_session_revocation.sql` trigger also covers changes made directly through shared Supabase Auth/mobile, without relying on the web server's clock. It preserves invitation confirmation semantics and does not change existing passwords when installed.
- Refresh credentials rotate and are stored only as hashes.
- Web refresh cookies are HttpOnly, SameSite=Lax, scoped to `/api/auth`, and Secure in production. Cookie refresh requires the separate CSRF token. Authentication responses use `Cache-Control: no-store`.
- Session expiry/revocation returns the browser to sign-in. A failed network logout warns that server-side revocation could not be confirmed.
- Suspending an application user also bans the linked Supabase Auth identity.

## Required Supabase settings

Configure these in **Authentication > URL Configuration**:

- Keep the shared Site URL and existing mobile redirects. Web flows use an explicit redirect; do not replace the mobile configuration with localhost.
- Development redirect: `http://localhost:5173/**`
- Production redirect for the final web domain.

Configure custom SMTP before production. Supabase's built-in mail service is suitable only for limited testing and can be rate-limited.

Install the **Invite user** and **Reset password** templates from `supabase/templates/` as described in [Invitation_Setup.md](Invitation_Setup.md). Web invitations display `{{ .Token }}` and link directly to `{{ .RedirectTo }}` (`/?auth=setup`), bypassing the mobile confirmation landing. The templates retain native confirmation/recovery links for mobile flows. Existing signup and link-based recovery still use `/?auth=complete`. Hosted templates must be saved in Supabase Dashboard; SQL migrations and Git pushes do not install them.

## Operational commands

```bash
SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply
npm run test:auth
npm run test:auth:ui
npm run test:web-access
DOTENV_CONFIG_PATH=.env.supabase AUTH_ACCEPTANCE_TEST=true npm run test:auth:supabase
npm run test:invitation:ui
npm run test:invitation:sql
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_INVITATION_TEST=true npm run test:invitation:supabase
```

The migration and acceptance scripts are intentionally gated to prevent accidental writes.

`test:auth` starts and stops its own isolated demo API. The gated Supabase variant starts its own production-configured API, creates temporary `example.test` identities, tests cookie/CSRF behavior, refresh replay, logout, password change/recovery, approval, suspension, and RLS/role escalation denial, then removes its own records. It never sends registration or recovery emails to random Gmail addresses. The older `db:supabase:test-auth` command now delegates to this same safe suite; its `SUPABASE_AUTH_TEST=true` gate is retained for compatibility.

`test:auth:ui` checks empty login fields without demo shortcuts, browser reload with cookie refresh, expired-session return to sign-in, and truthful offline logout warnings at desktop/mobile sizes. It uses mocked APIs, while the Supabase API suite tests the real production-mode cookie flags and persistent session behavior.

## Private administrators and emergency access

The primary BalikTela administrator and existing private personal administrator are retained. `Administrator` already has all application permissions; no hidden superadmin role or authentication bypass exists. Login fields are empty in development and production. The six published `@baliktela.demo` identities are deactivated and banned in shared Supabase Auth, their passwords replaced with discarded random values, and their web sessions revoked. Linked sample profiles, materials, transactions, and research history remain intact. Their old credentials no longer work on web or mobile. The old `db:supabase:migrate-auth` command refuses to recreate demo credentials. In-memory test fixtures remain isolated from Supabase.

The owner-only `auth:provision-backup` command creates a fixed, visible backup administrator using normal Supabase password authentication. It is never run on application startup. `backup-admin@baliktela.internal` is the default login identifier, not a deliverable mailbox. Keep its password in an access-controlled password manager; inbox recovery is unavailable for this identifier. An accessible separate mailbox can be configured instead. This account cannot bypass a Supabase outage, account suspension, or normal authorization.

In the ignored `.env.supabase`, set `PRIMARY_ADMIN_EMAIL` to the verified private administrator, optionally set `BACKUP_ADMIN_EMAIL`, and privately supply `BACKUP_ADMIN_PASSWORD` (at least 20 characters with uppercase, lowercase, a number, and a symbol). Never put the password in source, chat, command-line arguments, or Render's application environment. Provision from a trusted local terminal:

```sh
DOTENV_CONFIG_PATH=.env.supabase BACKUP_ADMIN_PROVISION=true npm run auth:provision-backup
```

The command requires a confirmed, initialized, unbanned primary administrator with a successful sign-in. It assigns the existing full `Administrator` role through the canonical audited management path, not client metadata. It sends no email and never prints the password. Existing accounts are not overwritten. After provisioning, verify a normal dashboard sign-in, store the password securely, and clear `BACKUP_ADMIN_PASSWORD` from the local file.

For intentional owner recovery, privately replace that setting and run the same command with `-- --rotate`. Rotation only accepts an existing identified backup administrator, revokes web sessions and outstanding setup/reset challenges, and does not change any other account. It requires access to the Supabase server credentials on the trusted owner's machine.

Demo retirement is repeatable and limited to the six original published identities. For another environment, review the dry run before applying:

```sh
DOTENV_CONFIG_PATH=.env.supabase npm run auth:retire-demo
DOTENV_CONFIG_PATH=.env.supabase DEMO_ACCOUNTS_RETIRE=true npm run auth:retire-demo -- --apply
```

The retirement command requires `PRIMARY_ADMIN_EMAIL` and preserves every other account. It does not delete operational data or grant Supabase project/database-owner permissions. Neither owner-operation flag belongs in normal runtime configuration.

## Predeployment audit: October 15, 2026

| Check | Result |
| --- | --- |
| Unit/regression suite | 77 passed |
| Isolated API authentication workflows | Passed |
| Production-mode API with temporary Supabase accounts | 12 workflow groups passed, including backup provisioning/rotation, takeover refusal, RLS, role escalation denial, expired sessions, and shared-password session revocation |
| Live invitation links and setup/recovery codes | All four workflows passed; no emails sent |
| Browser authentication/invitation cases | 30 desktop/mobile cases passed |
| Auth trigger SQL checks | Passed; additive session-revocation migration applied to the current project |
| TypeScript and production build | Passed |
| Known server-secret values in tracked sources/client build | No matches found |

**Demo-account retirement:** the six published identities have been deactivated, banned, and given discarded random passwords, with web sessions revoked. The primary and existing personal administrators remain active. On October 15, 2026, `backup-admin@baliktela.internal` was provisioned using an owner-supplied private password. Normal web sign-in, all 33 administrator permissions, the authenticated profile, user directory, session listing, and logout revocation were verified; the verification session was signed out. No password or authentication bypass was added to source. Store the private backup password securely and clear `BACKUP_ADMIN_PASSWORD` from the ignored local environment after secure storage. **Remaining deployment requirement:** rotate server secrets previously shared in chat and complete the deployed-origin checks below.

The live suites use temporary identities and remove their own records; SMTP delivery is not exercised by those automated suites. Account creation and SMTP delivery were confirmed separately during the preceding manual setup. After deploying, verify one real invitation/recovery email, HTTPS callback, refresh after browser reload, and sign-out using the deployed origin. Preserve the mobile Site URL/redirects and add the web HTTPS origin to the allowlist.

The invitation UI suite uses mocked APIs, including an existing administrator session, desktop/mobile layouts, signup confirmation, recovery, missing parameters, and expired tokens. The gated Supabase invitation suite generates temporary invitation links without sending emails, verifies private password creation and pending approval, rejects token replay, and removes its own identities and records afterward.
