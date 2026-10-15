import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { clientOrigin } from './runtimeConfig.js';

export interface IdentityResult {
  authUserId: string;
  email: string;
  emailConfirmedAt: string | null;
}
export interface EmailLinkCredentials {
  accessToken?: string;
  refreshToken?: string;
  tokenHash?: string;
  type?: string;
}

export class SupabaseIdentity {
  readonly enabled: boolean;
  private readonly url: string;
  private readonly publishableKey: string;
  private readonly secretKey: string;
  private readonly redirectUrl: string;

  constructor() {
    this.url = process.env.SUPABASE_URL ?? '';
    this.publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
    this.secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    this.redirectUrl = `${clientOrigin()}/?auth=complete`;
    this.enabled = Boolean(this.url && this.publishableKey && this.secretKey);
  }

  async signIn(email: string, password: string) {
    const client = this.publicClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.user) return null;
    return identity(data.user);
  }

  async registerConsumer(email: string, password: string, profileId: string, fullName: string) {
    const { data, error } = await this.publicClient().auth.signUp({
      email,
      password,
      options: { emailRedirectTo: this.redirectUrl, data: { profile_id: profileId, role: 'Consumer', full_name: fullName } },
    });
    if (error || !data.user || data.user.identities?.length === 0) throw authError(error?.message ?? 'An account already exists for this email address.');
    return identity(data.user);
  }

  async inviteInstitutionalUser(email: string, profileId: string, role: string, fullName: string) {
    const metadata = { profile_id: profileId, role, full_name: fullName, invitation_channel: 'web' };
    const administrator = this.admin();
    const { data, error } = await administrator.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${clientOrigin()}/?auth=setup`,
      data: metadata,
    });
    if (error || !data.user) throw emailDeliveryError(error);
    return identity(data.user);
  }

  async resendVerification(email: string) {
    const { error } = await this.publicClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: this.redirectUrl } });
    if (error) throw authError(error.message);
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.publicClient().auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl });
    if (error) throw authError(error.message);
  }

  async requestSetupCode(email: string) {
    const { error } = await this.publicClient().auth.resetPasswordForEmail(email, { redirectTo: `${clientOrigin()}/?auth=setup&purpose=recovery` });
    if (error) throw emailDeliveryError(error);
  }

  async verifySetupCode(authUserId: string, email: string, code: string, purpose: 'invite' | 'recovery') {
    const invalid = () => authError('The code is invalid, expired, or already used. Request a new code.');
    const { data: current, error: lookupError } = await this.admin().auth.admin.getUserById(authUserId);
    const sentAt = purpose === 'invite' ? current.user?.invited_at : current.user?.recovery_sent_at;
    const issued = Date.parse(sentAt ?? '');
    if (lookupError || !Number.isFinite(issued) || issued > Date.now() || Date.now() - issued > 10 * 60 * 1000) throw invalid();
    const client = this.publicClient();
    const { data, error } = await client.auth.verifyOtp({ email, token: code, type: purpose });
    if (error || !data.user || !data.session) throw invalid();
    // Never expose the provider session: this proof authorizes password setup only.
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError || data.user.id !== authUserId || !data.user.email_confirmed_at) throw invalid();
    return identity(data.user);
  }

  async setPasswordAfterCode(authUserId: string, password: string) {
    const { data, error } = await this.admin().auth.admin.updateUserById(authUserId, { password });
    if (error || !data.user) throw authError('Unable to save the password. Request a new code and try again.');
    return identity(data.user);
  }

  async resolveEmailLink(credentials: EmailLinkCredentials) {
    const { client, user, session } = await this.emailLinkSession(credentials);
    const { data, error } = await client.auth.getClaims(session.access_token);
    if (error || !data) throw authError('This email link cannot be verified. Request a new setup code.');
    const passwordProofSessionId = recentPasswordEmailProof(data.claims);
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    if (signOutError) throw authError('This email link cannot be completed. Request a new setup code.');
    return { ...identity(user), passwordProofSessionId };
  }

  private async emailLinkSession(credentials: EmailLinkCredentials) {
    const client = this.publicClient();
    const tokenHash = String(credentials.tokenHash ?? '');
    const type = String(credentials.type ?? '');
    if (tokenHash && !['invite', 'recovery', 'signup', 'email'].includes(type)) throw authError('This email link has an unsupported verification type.');
    if (!tokenHash && (!credentials.accessToken || !credentials.refreshToken)) throw authError('The authentication link is incomplete. Request a new link.');
    const { data, error } = tokenHash
      ? await client.auth.verifyOtp({ token_hash: tokenHash, type: type as 'invite' | 'recovery' | 'signup' | 'email' })
      : await client.auth.setSession({ access_token: String(credentials.accessToken), refresh_token: String(credentials.refreshToken) });
    if (error || !data.user || !data.session) throw authError('This email link is invalid, expired, or already used. Request a new link.');
    return { client, user: data.user, session: data.session };
  }

  async changePassword(email: string, currentPassword: string, nextPassword: string) {
    const signedIn = await this.signIn(email, currentPassword);
    if (!signedIn) return null;
    const { data, error } = await this.admin().auth.admin.updateUserById(signedIn.authUserId, { password: nextPassword });
    if (error || !data.user) throw authError(error?.message ?? 'Unable to update the password.');
    return identity(data.user);
  }

  async setSuspended(authUserId: string, suspended: boolean) {
    const { error } = await this.admin().auth.admin.updateUserById(authUserId, { ban_duration: suspended ? '876000h' : 'none' });
    if (error) throw authError(error.message);
  }

  async deleteUser(authUserId: string) {
    const { error } = await this.admin().auth.admin.deleteUser(authUserId);
    if (error) throw authError(error.message);
  }

  private publicClient() {
    if (!this.enabled) throw new Error('Supabase Auth is not configured.');
    return createClient(this.url, this.publishableKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  }

  private admin(): SupabaseClient {
    if (!this.enabled) throw new Error('Supabase Auth is not configured.');
    return createClient(this.url, this.secretKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  }
}

function identity(user: User): IdentityResult {
  return { authUserId: user.id, email: user.email?.toLowerCase() ?? '', emailConfirmedAt: user.email_confirmed_at ?? null };
}

export function recentPasswordEmailProof(claims: { session_id?: unknown; amr?: unknown }, now = Date.now()) {
  if (typeof claims.session_id !== 'string' || !claims.session_id || !Array.isArray(claims.amr)) return null;
  return claims.amr.some(entry => entry && ['invite', 'recovery', 'otp'].includes(entry.method)
    && typeof entry.timestamp === 'number' && entry.timestamp * 1000 <= now
    && now - entry.timestamp * 1000 <= 30 * 60 * 1000) ? claims.session_id : null;
}

function authError(message: string) {
  const error = new Error(message);
  error.name = 'SupabaseAuthError';
  return error;
}

function emailDeliveryError(provider: { code?: string; status?: number } | null) {
  const code = provider?.code ?? (provider?.status ? `http_${provider.status}` : 'unknown');
  const rateLimited = ['over_email_send_rate_limit', 'over_request_rate_limit'].includes(code) || provider?.status === 429;
  const timedOut = code === 'request_timeout' || provider?.status === 504 || provider?.status === 408;
  const messages: Record<string, string> = {
    email_address_not_authorized: 'Supabase refused this recipient. Check that custom SMTP is enabled and the email provider permits sending to this address. Without custom SMTP, only Supabase organization member addresses are allowed.',
    email_address_invalid: 'Supabase rejected this email address. Use a valid recipient address supported by your email provider.',
    email_exists: 'This email already has a Supabase identity. Use account setup to request a recovery code; do not delete the existing identity.',
    user_already_exists: 'This email already has a Supabase identity. Use account setup to request a recovery code; do not delete the existing identity.',
    email_provider_disabled: 'Email authentication is disabled in Supabase. Check Authentication provider settings.',
  };
  const message = timedOut ? 'The Supabase email request timed out. Check the SMTP hostname, port, provider availability, and Auth logs. Delivery is not confirmed; check provider logs before retrying.'
    : rateLimited ? 'Supabase or the email provider has rate-limited this email request. Wait before retrying and check Auth rate limits.'
    : messages[code] ?? 'Supabase could not send the email. Check Supabase Auth logs and your SMTP provider logs for sender verification, SMTP credentials, and email-template errors. No email delivery was confirmed.';
  return Object.assign(authError(message), { code, status: timedOut ? 504 : rateLimited ? 429 : ['email_exists', 'user_already_exists'].includes(code) ? 409 : 400 });
}
