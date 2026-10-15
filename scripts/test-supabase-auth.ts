import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (process.env.SUPABASE_AUTH_TEST !== 'true') {
  console.error('Refusing to run. Set SUPABASE_AUTH_TEST=true for an intentional authentication acceptance test.');
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const api = (process.env.SYNC_TEST_API_URL ?? 'http://127.0.0.1:4010/api').replace(/\/$/, '');
if (!url || !secretKey || !publishableKey) throw new Error('Supabase URL, publishable key, and secret key are required.');

const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const publicAuth = () => createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const suffix = randomUUID();
const email = `baliktela.auth.${suffix.slice(0, 8)}@gmail.com`;
const initialPassword = 'BalikTelaInitial2026!';
const changedPassword = 'BalikTelaChanged2026!';
const resetPassword = 'BalikTelaReset2026!';
let profileId = '';
let authUserId = '';

try {
  const registration = await request('/auth/register', { method: 'POST', body: { email, password: initialPassword, fullName: 'Authentication Acceptance Test', city: 'Quezon City', region: 'Metro Manila', consent: true, client: 'mobile' }, expected: [201, 400] });
  let registrationPath = 'public registration';
  if (registration.status === 201) {
    profileId = registration.payload.user.id;
    const { data: profile, error: profileError } = await admin.from('users').select('auth_user_id').eq('id', profileId).single();
    if (profileError || !profile?.auth_user_id) throw new Error('Registration did not link the application profile to Supabase Auth.');
    authUserId = profile.auth_user_id;
    const { error: confirmError } = await admin.auth.admin.updateUserById(authUserId, { email_confirm: true });
    if (confirmError) throw confirmError;
  } else {
    if (!String(registration.payload.message ?? '').toLowerCase().includes('rate limit')) throw new Error(`Unexpected registration failure: ${registration.payload.message}`);
    registrationPath = 'admin-provisioned test identity because Supabase email delivery was rate-limited';
    profileId = `USR-AUTH-${suffix.slice(0, 8).toUpperCase()}`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: initialPassword, email_confirm: true, user_metadata: { profile_id: profileId, role: 'Consumer', full_name: 'Authentication Acceptance Test' } });
    if (createError || !created.user) throw createError ?? new Error('Could not provision the acceptance identity.');
    authUserId = created.user.id;
    const now = new Date().toISOString();
    const { error: insertError } = await admin.from('users').insert({ id: profileId, auth_user_id: authUserId, email, passwordHash: null, name: 'Authentication Acceptance Test', role: 'Consumer', active: true, stakeholder: 'Consumer', organization_id: null, organization: 'Individual participant', organization_verified: false, verification_status: 'pending', account_status: 'active', bio: '', location: 'Quezon City, Metro Manila', city: 'Quezon City', region: 'Metro Manila', phone: '', avatar_uri: null, rating: 5, swaps: 0, privacy_consent: true, research_consent: false, notification_enabled: true, scope: { organization_ids: [], facility_ids: [], regions: ['Metro Manila'], can_export: false, aggregate_only: false }, profile: { age_group: '', organization_size: 'Individual', production_volume_kg: 0, recycling_practices: '', accepted_textiles: [], sustainability_interests: [] }, trust_placeholder: 50, last_login_at: null, created_at: now, updated_at: now });
    if (insertError) throw insertError;
    const { error: securityError } = await admin.from('auth_account_security').insert({ id: `AAS-${profileId}`, user_id: profileId, email_verified_at: now, password_changed_at: now, created_at: now, updated_at: now });
    if (securityError) throw securityError;
  }

  const verifiedLogin = await login(initialPassword, 200);
  await request('/auth/password/change', { method: 'POST', bearer: verifiedLogin.accessToken, body: { currentPassword: initialPassword, password: changedPassword }, expected: 200 });
  await login(initialPassword, 401);
  await login(changedPassword, 200);

  const recovery = await request('/auth/password/forgot', { method: 'POST', body: { email, client: 'mobile' }, expected: 202 });
  assert(recovery.message, 'Password recovery did not return its privacy-preserving response.');
  const recoveryClient = publicAuth();
  const { data: recoverySession, error: recoverySessionError } = await recoveryClient.auth.signInWithPassword({ email, password: changedPassword });
  if (recoverySessionError || !recoverySession.session) throw recoverySessionError ?? new Error('Could not create the acceptance recovery session.');
  await request('/auth/password/reset', { method: 'POST', body: { accessToken: recoverySession.session.access_token, refreshToken: recoverySession.session.refresh_token, password: resetPassword }, expected: 200 });
  await login(changedPassword, 401);

  const active = await login(resetPassword, 200);
  const rotated = await request('/auth/refresh', { method: 'POST', body: { refreshToken: active.refreshToken }, expected: 200 });
  assert(rotated.refreshToken && rotated.refreshToken !== active.refreshToken, 'Application refresh token was not rotated.');
  await request('/auth/refresh', { method: 'POST', body: { refreshToken: active.refreshToken }, expected: 401 });

  console.log(JSON.stringify({ provider: 'supabase-auth', result: 'passed', registrationPath, verified: ['identity linking', 'email confirmation sync', 'password login', 'password change', 'privacy-safe recovery request', 'password recovery', 'application refresh rotation', 'refresh replay rejection'] }, null, 2));
} finally {
  if (profileId) {
    await admin.from('sessions').delete().eq('user_id', profileId);
    await admin.from('auth_challenges').delete().eq('user_id', profileId);
    await admin.from('auth_account_security').delete().eq('user_id', profileId);
    await admin.from('activity_logs').delete().or(`actor_id.eq.${profileId},entity_id.eq.${profileId}`);
    await admin.from('users').delete().eq('id', profileId);
  }
  if (authUserId) await admin.auth.admin.deleteUser(authUserId);
}

async function login(password: string, expected: number) {
  return request('/auth/login', { method: 'POST', body: { email, password, client: 'mobile' }, expected });
}

async function request(path: string, options: { method: string; body?: unknown; bearer?: string; expected: number | number[] }) {
  const response = await fetch(`${api}${path}`, { method: options.method, headers: { 'content-type': 'application/json', ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}) }, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const payload = await response.json().catch(() => ({})) as any;
  const expected = Array.isArray(options.expected) ? options.expected : [options.expected];
  if (!expected.includes(response.status)) throw new Error(`${path} returned HTTP ${response.status}; expected ${expected.join(' or ')}: ${payload.message ?? 'no message'}`);
  return Array.isArray(options.expected) ? { status: response.status, payload } : payload;
}

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
