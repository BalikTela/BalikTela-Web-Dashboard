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
    const metadata = { profile_id: profileId, role, full_name: fullName };
    const administrator = this.admin();
    const { data, error } = await administrator.auth.admin.inviteUserByEmail(email, {
      redirectTo: this.redirectUrl,
      data: metadata,
    });
    if (!error && data.user) return { ...identity(data.user), delivery: 'email' as const, actionLink: null };
    if (process.env.NODE_ENV === 'production' && process.env.AUTH_DEMO_DELIVERY !== 'true') throw authError(error?.message ?? 'Supabase did not create the invitation.');
    const partial = await this.findByEmail(email);
    if (partial) await administrator.auth.admin.deleteUser(partial.id);
    const generated = await administrator.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: this.redirectUrl, data: metadata } });
    if (generated.error || !generated.data.user) throw authError(generated.error?.message ?? error?.message ?? 'Supabase did not create the invitation.');
    return { ...identity(generated.data.user), delivery: 'generated' as const, actionLink: generated.data.properties.action_link };
  }

  async resendVerification(email: string) {
    const { error } = await this.publicClient().auth.resend({ type: 'signup', email, options: { emailRedirectTo: this.redirectUrl } });
    if (error) throw authError(error.message);
  }

  async requestPasswordReset(email: string) {
    const { error } = await this.publicClient().auth.resetPasswordForEmail(email, { redirectTo: this.redirectUrl });
    if (error) throw authError(error.message);
  }

  async setPasswordFromEmailLink(accessToken: string, refreshToken: string, password: string) {
    const { client } = await this.emailLinkSession({ accessToken, refreshToken });
    const { data, error } = await client.auth.updateUser({ password });
    if (error || !data.user) throw authError(error?.message ?? 'Unable to update the password.');
    await client.auth.signOut({ scope: 'global' });
    return identity(data.user);
  }

  async resolveEmailLink(credentials: EmailLinkCredentials) {
    const { user, session } = await this.emailLinkSession(credentials);
    return { ...identity(user), accessToken: session.access_token, refreshToken: session.refresh_token };
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

  async ensureDemoUser(email: string, password: string, profileId: string, role: string, fullName: string) {
    const existing = await this.findByEmail(email);
    if (existing) {
      const { data, error } = await this.admin().auth.admin.updateUserById(existing.id, { password, email_confirm: true, user_metadata: { ...existing.user_metadata, profile_id: profileId, role, full_name: fullName } });
      if (error || !data.user) throw authError(error?.message ?? 'Unable to update the demo identity.');
      return identity(data.user);
    }
    const { data, error } = await this.admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { profile_id: profileId, role, full_name: fullName } });
    if (error || !data.user) throw authError(error?.message ?? 'Unable to create the demo identity.');
    return identity(data.user);
  }

  private async findByEmail(email: string) {
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await this.admin().auth.admin.listUsers({ page, perPage: 100 });
      if (error) throw authError(error.message);
      const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
      if (user) return user;
      if (data.users.length < 100) return null;
    }
    return null;
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

function authError(message: string) {
  const error = new Error(message);
  error.name = 'SupabaseAuthError';
  return error;
}
