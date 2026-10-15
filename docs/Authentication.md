# BalikTela Authentication

## Identity model

Supabase Auth is the credential authority. The public `users` table stores the application profile, role, organization, verification state, and access scope. It does not store passwords after an identity is linked.

- `auth.users.id` is stored as `public.users.auth_user_id`.
- Role and access claims are read from `public.users`, never trusted from browser input or Auth user metadata.
- The Supabase secret key is server-only. The browser communicates through `/api`.
- BalikTela application sessions remain revocable, rotating, and auditable.

## Account creation

### Participant registration

1. A participant selects **Create participant account**.
2. The API always assigns the `Consumer` role.
3. Supabase sends an email-confirmation link.
4. After confirmation, the participant signs in.
5. Consumer activity remains in the participant/mobile experience; dashboard permissions are not assigned automatically.

### Institutional invitation

1. An administrator selects **Institutional account** in User Accounts.
2. The administrator assigns the intended role and organization.
3. Supabase sends an invitation; the administrator never creates or sees the password.
4. The recipient opens the link. The callback is displayed even if another user is already signed into that browser.
5. The API verifies the Supabase email credentials and shows **Create your password**, including a confirmation field and the verified recipient email. Creating a password never signs in as, or changes the role of, the administrator who sent the invitation.
6. The recipient chooses a private password and signs in with it. Email confirmation alone does not initialize a password.
7. The profile remains `Pending verification` until an administrator verifies it.
8. Approval activates the centrally defined role and scope. The User Accounts security column distinguishes email verification from password initialization.

Government and Researcher accounts default to aggregate-only access. Administrator creation is restricted to an existing administrator, and the last active administrator cannot be removed.

Callbacks support standard Supabase fragment credentials and token-hash email templates. Credentials are removed from the address bar, kept only in component memory, and verified through the API. A bare `?auth=complete` is not proof of confirmation and displays an incomplete-link message instead of a success message. Expired or already-used invitations can be recovered through **Forgot password** using the invited email; do not delete/recreate the account to resend a password setup link.

`20261015080000_invitation_password_initialization.sql` corrects the shared Auth profile trigger. It keeps the mobile profile ID convention and existing roles, distinguishes provider invitation confirmation from a recipient-selected password, and preserves security records whose IDs differ from the profile ID. Existing still-unconfirmed invitations have their incorrectly initialized password marker cleared. Already-confirmed legacy invitations can finish setup through a fresh recovery email.

## Recovery and sessions

- Password recovery responses do not disclose whether an account exists.
- Recovery and invitation links are handled by the Auth page and expire according to Supabase settings.
- Password changes revoke all BalikTela application sessions.
- Refresh credentials rotate and are stored only as hashes.
- Suspending an application user also bans the linked Supabase Auth identity.

## Required Supabase settings

Configure these in **Authentication > URL Configuration**:

- Site URL for the deployed web application.
- Development redirect: `http://localhost:5173/**`
- Production redirect for the final web domain.

Configure custom SMTP before production. Supabase's built-in mail service is suitable only for limited testing and can be rate-limited.

The **Invite user** email template must link to `{{ .ConfirmationURL }}`, not just `{{ .SiteURL }}`. The confirmation URL verifies the invitation and forwards the recipient to the app with the credentials needed for password setup. The current API redirect remains `/?auth=complete`, so existing redirect allowlists do not need new routes.

## Operational commands

```bash
SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply
SUPABASE_AUTH_MIGRATE=true npm run db:supabase:migrate-auth
SUPABASE_AUTH_TEST=true SYNC_TEST_API_URL=http://127.0.0.1:4000/api npm run db:supabase:test-auth
npm run test:invitation:ui
npm run test:invitation:sql
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_INVITATION_TEST=true npm run test:invitation:supabase
```

The migration and acceptance scripts are intentionally gated to prevent accidental writes.

The invitation UI suite uses mocked APIs, including an existing administrator session, desktop/mobile layouts, signup confirmation, recovery, missing parameters, and expired tokens. The gated Supabase invitation suite generates temporary invitation links without sending emails, verifies private password creation and pending approval, rejects token replay, and removes its own identities and records afterward.
