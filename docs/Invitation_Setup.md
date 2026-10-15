# Web invitation and password setup

## User journey

1. An administrator invites an institutional user in User Accounts.
2. Supabase sends an invitation containing a single-use email code and the web dashboard URL. No reusable password is emailed.
3. The recipient opens `/?auth=setup`, or chooses **Have an invitation or setup code?** on the sign-in screen.
4. The recipient enters their email and code, using **Original invitation** for the original email.
5. The server verifies the native Supabase OTP. It immediately signs out the resulting provider session, never sends that session to the browser, and issues a random password-only authorization valid for 10 minutes. Only its hash is stored in `auth_challenges`. Legacy invitation/recovery links now exchange their verified provider proof for the same single-use authorization; an ordinary password-login session cannot be used instead.
6. The recipient creates and confirms a private password. The authorization is consumed atomically, the password is saved with Supabase Auth, and existing application sessions are revoked. It cannot be reused.
7. The recipient signs in normally. Institutional privileges remain blocked until administrator approval. Email verification alone does not initialize a password or grant a role.

Codes are accepted for 10 minutes from the provider's trusted `invited_at` / `recovery_sent_at` timestamp. The server allows five verification attempts per email per 15 minutes, plus an IP limit. Resend requests have email and IP limits and return the same message for unknown, disabled, and eligible accounts. Requesting a new code sends a **recovery** email, so use **New setup / recovery code** afterward. Never reset another user's password as an administrator to work around delivery problems.

If password saving fails after consuming the authorization, request a fresh code. Refreshing or leaving the password screen discards the browser's in-memory authorization. It is never stored in browser storage or the URL.

## Required hosted Supabase configuration

The emergency backup administrator uses separate, owner-only provisioning with a privately supplied password, not an invitation or an emailed temporary password. See [Authentication.md](Authentication.md#private-administrators-and-emergency-access). Normal institutional users continue to follow the invitation and private password setup journey above.

The repository cannot change hosted email settings using the project publishable/secret keys. These settings must be saved in Supabase Dashboard by a project administrator:

1. Open **Authentication > URL Configuration**. Add `http://localhost:5173/**` for local testing and the exact deployed web origin followed by `/**` for production to **Redirect URLs**. The server's `CLIENT_ORIGIN` must match the correct web origin. Localhost links only work on the machine running the app.
2. Keep the mobile app's existing redirect URLs and shared Site URL. Do not replace them with the web URL.
3. Open **Authentication > Email > Templates** (also labeled **Email Templates** in some dashboard versions).
4. Set **Invite user** subject to `Your BalikTela web dashboard invitation`. Use the contents of `supabase/templates/invite.html` for the body. Its `invitation_channel = web` metadata is only a presentation hint, never authorization; the other branch retains native mobile invitation confirmation links. Coordinate any existing mobile-specific email content with the mobile developer before replacing it.
5. Set **Reset password** subject to `Your BalikTela password setup or recovery code`. Use `supabase/templates/recovery.html` for the body. This retains the native recovery link for existing mobile and web link-based flows while also displaying the code.
6. Keep **Confirm signup** unchanged: consumer signup already asks for a private password. Do not point web invitations to the Google Sites mobile confirmation page or `baliktela://register-callback`.
7. Configure a production SMTP provider under the project's email settings for delivery to real external recipients. Built-in test delivery and provider rate limits may prevent sending to non-project addresses. A generic resend response is not proof of email delivery; check Supabase Auth logs and the actual inbox.

The HTML files are deployment assets, not migrations. Pushing them to GitHub or applying SQL does not install them in hosted Supabase. Old invitation emails will not change. After saving templates, send a fresh invitation; existing invited users can request a new recovery code from the setup page.

## Missing invitation emails

An **Open development invitation link** from older builds means the email send failed and the app generated a link without sending mail. It is not delivery confirmation. This fallback has been removed from Supabase invitation creation: provider rejection now shows an error, and existing identities are never deleted/recreated to conceal a delivery failure.

If custom SMTP is already enabled:

1. Check **Supabase Logs > Auth** at the time of the invitation. Look for `/invite` or `/recover` failures and the underlying SMTP or template error. The database's Auth audit table may be empty; it is not a substitute for service logs.
2. Check the SMTP provider's transactional email logs, sender/domain verification, recipient restrictions, sandbox/test mode, quotas, and bounces. A provider may restrict delivery even when Supabase's custom SMTP toggle is enabled.
3. Confirm that Supabase uses the provider's **SMTP** host, port, username and SMTP password/API credential, not your account login password. Do not post these credentials in chat.
4. Confirm that the configured From address belongs to an authorized sender/domain. Review the saved Invite user and Reset password template syntax if the failure started after updating the templates.
5. Respect Supabase's and the provider's sending limits; repeated invitations and recovery requests can exhaust them.
6. Once corrected, existing invited users should request a new recovery code at `/?auth=setup`. Do not delete/recreate shared mobile identities. Public recovery responses intentionally do not disclose whether delivery succeeded; delivery failures log only a safe provider error code on the API server.

An accepted Supabase request is not proof that the message arrived. Check the recipient's spam folder and the provider's delivery/bounce records. Template/redirect configuration controls content and routing, not SMTP delivery.

## Checks

Run `npm test`, `npm run typecheck:api`, `npm run build:render`, and `npm run test:invitation:ui`.

For an isolated no-email test against the configured development Supabase project:

```sh
DOTENV_CONFIG_PATH=.env.supabase SUPABASE_INVITATION_TEST=true npm run test:invitation:supabase
```

That test creates only temporary `example.test` identities, verifies native invitation/recovery codes and password setup, and removes those identities and their email-specific rate-limit records. Shared IP rate limits are intentionally preserved, so repeated runs can require waiting 15 minutes. It does not validate SMTP delivery or installation of hosted email templates. Before deployment, send a real invitation to a consenting test recipient and verify the inbox, code, private password, pending approval, and administrator approval sequence.
