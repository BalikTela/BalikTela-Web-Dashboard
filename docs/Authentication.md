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
4. The recipient opens the link and creates a password.
5. The profile remains `Pending verification` until an administrator verifies it.
6. Approval activates the centrally defined role and scope.

Government and Researcher accounts default to aggregate-only access. Administrator creation is restricted to an existing administrator, and the last active administrator cannot be removed.

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

## Operational commands

```bash
SUPABASE_SCHEMA_APPLY=true npm run db:supabase:apply
SUPABASE_AUTH_MIGRATE=true npm run db:supabase:migrate-auth
SUPABASE_AUTH_TEST=true SYNC_TEST_API_URL=http://127.0.0.1:4000/api npm run db:supabase:test-auth
```

The migration and acceptance scripts are intentionally gated to prevent accidental writes.
