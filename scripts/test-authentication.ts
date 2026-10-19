import 'dotenv/config';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { SupabaseStore } from '../server/supabaseStore.js';
import { createSeedData } from '../server/seed.js';
import { provisionedUserMutation } from '../server/provisioning.js';
import type { UserRecord } from '../server/types.js';

const live = process.argv.includes('--supabase');
if (live && process.env.AUTH_ACCEPTANCE_TEST !== 'true') throw new Error('Set AUTH_ACCEPTANCE_TEST=true to authorize temporary Supabase test identities. No emails are sent.');
const suffix = randomUUID().slice(0, 8);
const password = `Initial-${randomUUID()}!`;
const changedPassword = `Changed-${randomUUID()}!`;
const recoveredPassword = `Recovered-${randomUUID()}!`;
const seed = await createSeedData();
const authIds: string[] = [];
const profileIds: string[] = [];
const emails: string[] = [];
const checks: string[] = [];
const signingSecret = process.env.JWT_SECRET ?? randomUUID() + randomUUID();
const admin = live ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const store = live ? new SupabaseStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!) : null;
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
const address = listener.address();
if (!address || typeof address === 'string') throw new Error('Test port unavailable.');
const port = address.port;
await new Promise<void>(resolve => listener.close(() => resolve()));
const base = `http://127.0.0.1:${port}/api`;
const child = spawn(process.execPath, ['build/server/index.js'], {
  env: { ...process.env, NODE_ENV: live ? 'production' : 'test', PORT: String(port), CLIENT_ORIGIN: live ? 'https://authentication-test.invalid' : `http://127.0.0.1:${port}`, JWT_SECRET: signingSecret, AUTH_DEMO_DELIVERY: live ? 'false' : 'true', DASHBOARD_PREWARM: 'false',
    ...(!live ? { SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', MONGODB_URI: '' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverOutput = '';
child.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });
child.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk).slice(-8000); });

async function call(path: string, body?: Record<string, unknown>, bearer?: string, expected: number | number[] = 200, method = body ? 'POST' : 'GET', headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: HTTP ${response.status}: ${data.message ?? ''}`);
  if (path.startsWith('/auth/')) assert.equal(response.headers.get('cache-control'), 'no-store');
  return { data, response };
}
const signIn = async (email: string, secret: string, client = 'api', expected = 200) => (await call('/auth/login', { email, password: secret, client }, undefined, expected)).data;
async function provision(role: UserRecord['role'], pending = false) {
  const email = `baliktela.auth-audit.${role.toLowerCase()}.${suffix}@example.test`;
  emails.push(email);
  const { data, error } = await admin!.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { role: 'Administrator', name: 'Authentication audit (demo)' } });
  if (error || !data.user) throw new Error('Could not create a temporary audit identity.');
  authIds.push(data.user.id);
  const canonical = await store!.findOne('users', record => record.authUserId === data.user!.id);
  assert.equal(canonical?.role, 'Consumer', 'Auth metadata must never assign an institutional role.');
  const template = seed.users.find(record => record.role === role)!;
  const mutation = await provisionedUserMutation(store!, { ...template, id: `USR-AUDIT-${randomUUID()}`, authUserId: data.user.id, email, fullName: 'Temporary authentication audit (demo)', organizationId: null, organization: 'Isolated authentication audit (demo)', passwordHash: null, emailVerifiedAt: data.user.email_confirmed_at!, passwordChangedAt: canonical!.passwordChangedAt, accountStatus: pending ? 'Pending verification' : 'Active', verification: pending ? 'Pending demo review' : 'Demo verified' });
  profileIds.push(mutation.record.id);
  await store!.commit([mutation]);
  return mutation.record;
}

try {
  for (let attempt = 0; ; attempt++) {
    try { const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) }); if (health.ok) break; } catch { /* Wait for our isolated API only. */ }
    if (child.exitCode !== null || attempt > 80) throw new Error('Isolated authentication API did not start.');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const administrator = live ? await provision('Administrator') : seed.users.find(user => user.role === 'Administrator')!;
  const researcher = live ? await provision('Researcher', true) : seed.users.find(user => user.role === 'Researcher')!;
  const consumer = live ? await provision('Consumer') : seed.users.find(user => user.role === 'Consumer')!;
  const initial = live ? password : 'BalikTelaDemo2026!';
  const adminLogin = await signIn(administrator.email, initial);
  assert.equal(adminLogin.user.passwordHash, undefined);
  assert.ok(adminLogin.access.permissions.includes('users.manage'));
  if (!live) {
    const traceability = (await call('/transfers', undefined, adminLogin.accessToken)).data;
    assert.ok(traceability.transfers.length);
    for (const transfer of traceability.transfers) {
      assert.equal(transfer.requesterName, seed.users.find(user => user.id === transfer.recipientId)?.fullName.trim() || null);
    }
    checks.push('scoped transfer rows identify requesters using the linked recipient account');
    const dashboard = (await call('/analytics/dashboard', undefined, adminLogin.accessToken)).data;
    const operations = (await call('/analytics/operations', undefined, adminLogin.accessToken)).data;
    const report = (await call('/reports/material-flow/preview', undefined, adminLogin.accessToken)).data;
    const total = report.rows.at(-1);
    assert.equal(Number(total[3]), dashboard.circularFlow.generatedKg / 1000);
    assert.equal(operations.metrics.declaredKg, dashboard.operations.metrics.declaredKg);
    assert.equal(report.period.timeZone, 'Asia/Manila');
    await call('/reports/missing/preview', undefined, adminLogin.accessToken, 404);
    await call('/analytics/dashboard?dateRange=Custom%20range', undefined, adminLogin.accessToken, 400);
    checks.push('shared live reporting periods, report/dashboard/operations reconciliation, invalid period and report rejection');
    const recycler = seed.users.find(user => user.role === 'Recycler')!;
    const hubLogin = await signIn(recycler.email, initial);
    const ownHubDirectory = (await call('/hubs', undefined, hubLogin.accessToken)).data;
    assert.deepEqual(ownHubDirectory.hubs.map((hub: { id: string }) => hub.id), [recycler.id]);
    await call('/weighing?dateRange=All%20time', undefined, adminLogin.accessToken);
    await call(`/hubs/${recycler.id}`, { action: 'approve', reason: 'Isolated Hub approval acceptance.' }, adminLogin.accessToken, 200, 'PATCH');
    await call('/auth/me', undefined, hubLogin.accessToken, 401);
    const approvedHub = await signIn(recycler.email, initial);
    assert.equal(approvedHub.user.organizationVerified, true);
    await call(`/hubs/${recycler.id}`, { action: 'revoke', reason: 'Isolated Hub revocation acceptance.' }, adminLogin.accessToken, 200, 'PATCH');
    await call('/auth/me', undefined, approvedHub.accessToken, 401);
    const edited = await call(`/users/${recycler.id}`, { fullName: recycler.fullName, accountStatus: 'Active', approve: true, reason: 'Profile edit must not restore weighing.' }, adminLogin.accessToken, 200, 'PATCH');
    assert.equal(edited.data.user.organizationVerified, false);
    assert.equal(edited.data.user.accountStatus, 'Active');
    const nativeHub = await call(`/users/${recycler.id}`, { role: 'BalikTela Hub', reason: 'Explicit Hub assignment requires new approval.' }, adminLogin.accessToken, 200, 'PATCH');
    assert.equal(nativeHub.data.user.organizationVerified, false);
    await call(`/hubs/${recycler.id}`, { action: 'approve', reason: 'Restore isolated fixture approval.' }, adminLogin.accessToken, 200, 'PATCH');
    const nativeHubLogin = await signIn(recycler.email, initial);
    assert.equal(nativeHubLogin.user.role, 'BalikTela Hub');
    assert.ok(nativeHubLogin.access.permissions.includes('weighing.read'));
    assert.ok(!nativeHubLogin.access.permissions.includes('users.manage'));
    checks.push('Hub authority, approval/revocation, stale-session denial, role preservation and scoped native Hub access');
  }
  if (live) {
    const backupEmail = `baliktela.backup-audit.${suffix}@example.test`;
    emails.push(backupEmail);
    const runBackupCommand = async (email: string, secret: string, rotate = false) => {
      const command = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/provision-backup-admin.ts', ...(rotate ? ['--rotate'] : [])], {
        env: { ...process.env, PRIMARY_ADMIN_EMAIL: administrator.email, BACKUP_ADMIN_EMAIL: email, BACKUP_ADMIN_PASSWORD: secret, BACKUP_ADMIN_PROVISION: 'true' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      command.stdout.on('data', chunk => { output += chunk; });
      command.stderr.on('data', chunk => { output += chunk; });
      const [code] = await once(command, 'exit');
      assert.ok(!output.includes(secret), 'The owner command must not print its supplied password.');
      return code;
    };
    try {
      assert.equal(await runBackupCommand(backupEmail, password), 0, 'Owner provisioning should create a normal backup administrator.');
    } finally {
      const profile = await store!.findOne('users', user => user.email === backupEmail);
      if (profile?.authUserId) { authIds.push(profile.authUserId); profileIds.push(profile.id); }
    }
    const backupLogin = await signIn(backupEmail, password);
    assert.deepEqual(backupLogin.access.permissions, adminLogin.access.permissions);
    assert.equal(backupLogin.user.role, 'Administrator');
    assert.notEqual(await runBackupCommand(backupEmail, changedPassword), 0, 'Existing credentials must not be overwritten without --rotate.');
    assert.notEqual(await runBackupCommand(researcher.email, changedPassword, true), 0, 'The command must not take over an existing institutional account.');
    assert.equal(await runBackupCommand(backupEmail, changedPassword, true), 0);
    await call('/auth/me', undefined, backupLogin.accessToken, 401);
    const oldPasswordLogin = await admin!.auth.signInWithPassword({ email: backupEmail, password });
    assert.ok(oldPasswordLogin.error, 'Rotation must invalidate the previous Supabase password.');
    assert.equal((await signIn(backupEmail, changedPassword)).user.role, 'Administrator');
    checks.push('private backup owner provisioning, normal Supabase sign-in, full administrator permissions, takeover refusal, rotation and session revocation');
  }
  await call('/auth/me', undefined, undefined, 401);
  await call('/auth/me', undefined, 'invalid-jwt', 401);
  const expiredJwt = jwt.sign({ userId: administrator.id, role: 'Administrator', sessionId: adminLogin.session.id, tokenType: 'access' }, signingSecret, { issuer: 'baliktela-api', expiresIn: -1 });
  await call('/auth/me', undefined, expiredJwt, 401);
  await call('/auth/login', { email: administrator.email, password: 'BalikTelaDemo2026!' }, undefined, live ? 401 : 200);
  checks.push(`administrator sign-in, secret stripping, invalid/missing/expired JWT rejection${live ? ', production demo password disabled' : ''}`);

  await call('/auth/register', { email: `no-send-${suffix}@example.test`, password: 'weak', fullName: 'No-send test', consent: true }, undefined, 400);
  await call('/auth/register', { email: `no-send-${suffix}@example.test`, password, fullName: 'No-send test', consent: false }, undefined, 400);
  if (!live) {
    const registered = (await call('/auth/register', { email: `signup-${suffix}@example.test`, password, fullName: 'Participant audit (demo)', role: 'Administrator', consent: true }, undefined, 201)).data;
    assert.equal(registered.user.role, 'Consumer');
    await call('/users', undefined, registered.accessToken, 403);
    await call('/auth/email/verify', { token: registered.demoEmailVerificationToken });
    await call('/auth/email/verify', { token: registered.demoEmailVerificationToken }, undefined, 400);
  }
  const member = await signIn(consumer.email, initial);
  await call('/users', undefined, member.accessToken, 403);
  await call('/users/me', { role: 'Administrator', accountStatus: 'Active' }, member.accessToken, 200, 'PATCH');
  assert.equal((await call('/auth/me', undefined, member.accessToken)).data.user.role, 'Consumer');
  checks.push('registration policy/consent, participant role enforcement, profile mass-assignment protection');

  if (!live) await call(`/users/${researcher.id}`, { accountStatus: 'Pending verification', reason: 'Audit pending access' }, adminLogin.accessToken, 200, 'PATCH');
  let research = await signIn(researcher.email, initial);
  await call('/auth/me', undefined, research.accessToken);
  await call('/analytics/dashboard', undefined, research.accessToken, 403);
  await call(`/users/${researcher.id}/verification`, { verification: 'Demo verified' }, member.accessToken, 403, 'PATCH');
  await call(`/users/${researcher.id}/verification`, { verification: 'Demo verified' }, adminLogin.accessToken, 200, 'PATCH');
  await call('/auth/me', undefined, research.accessToken, 401);
  research = await signIn(researcher.email, initial);
  assert.ok(research.access.permissions.includes('analytics.read'));
  await call('/users', undefined, research.accessToken, 403);
  if (research.user.scope.aggregateOnly) {
    const aggregate = (await call('/analytics/dashboard', undefined, research.accessToken)).data;
    assert.deepEqual(aggregate.transactions, []);
    assert.deepEqual(aggregate.stakeholders, []);
    assert.deepEqual((await call('/organizations', undefined, research.accessToken)).data.organizations, []);
    assert.deepEqual((await call('/facilities', undefined, research.accessToken)).data.facilities, []);
  }
  checks.push('pending institutional restriction, administrator-only approval, approval revocation, researcher permission boundary');

  if (!live) {
    await call(`/users/${researcher.id}`, { role: 'Government', reason: 'Verify role-change reauthentication' }, adminLogin.accessToken, 200, 'PATCH');
    assert.equal((await call('/auth/me', undefined, research.accessToken, 401)).data.code, 'ACCOUNT_CHANGED');
    await call('/auth/refresh', { refreshToken: research.refreshToken }, undefined, 401);
    const changedRole = await signIn(researcher.email, initial);
    assert.equal(changedRole.user.role, 'Government');
    await call(`/users/${researcher.id}`, { role: 'Researcher', reason: 'Restore isolated audit role' }, adminLogin.accessToken, 200, 'PATCH');
    assert.equal((await call('/auth/me', undefined, changedRole.accessToken, 401)).data.code, 'ACCOUNT_CHANGED');
    research = await signIn(researcher.email, initial);
    checks.push('administrator role edits revoke existing access and refresh credentials; next login receives the new role');
  }

  const web = await call('/auth/login', { email: researcher.email, password: initial, client: 'web' });
  const cookie = web.response.headers.getSetCookie().find(value => value.startsWith('baliktela_refresh='))!;
  assert.ok(cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax') && cookie.includes('Path=/api/auth'));
  assert.equal(cookie.includes('Secure'), live);
  assert.equal(web.data.refreshToken, undefined);
  const cookieValue = cookie.split(';')[0];
  await call('/auth/refresh', {}, undefined, 401, 'POST', { Cookie: 'baliktela_refresh=%ZZ' });
  const bodyRefresh = decodeURIComponent(cookieValue.slice(cookieValue.indexOf('=') + 1));
  await call('/auth/refresh', { refreshToken: bodyRefresh }, undefined, 403);
  await call('/auth/refresh', {}, undefined, 403, 'POST', { Cookie: cookieValue });
  const rotated = await call('/auth/refresh', {}, undefined, 200, 'POST', { Cookie: cookieValue, 'X-CSRF-Token': web.data.csrfToken });
  assert.equal(rotated.data.refreshToken, undefined);
  assert.notEqual(rotated.data.csrfToken, web.data.csrfToken);
  await call('/auth/me', undefined, rotated.data.accessToken);
  await call('/auth/refresh', {}, undefined, 401, 'POST', { Cookie: cookieValue, 'X-CSRF-Token': web.data.csrfToken });
  await call('/auth/me', undefined, rotated.data.accessToken, 401);
  checks.push('HttpOnly/SameSite/Secure cookie flags, cookie CSRF rejection, refresh rotation, replay revokes session');

  const first = await signIn(researcher.email, initial);
  const second = await signIn(researcher.email, initial);
  await call(`/auth/sessions/${second.session.id}`, undefined, member.accessToken, 404, 'DELETE');
  await call(`/auth/sessions/${second.session.id}`, undefined, first.accessToken, 204, 'DELETE');
  await call('/auth/me', undefined, second.accessToken, 401);
  await call('/auth/me', undefined, first.accessToken);
  const logout = await call('/auth/logout', {}, first.accessToken, 204);
  assert.ok(logout.response.headers.getSetCookie().some(value => value.includes('baliktela_refresh=;')));
  await call('/auth/me', undefined, first.accessToken, 401);
  const allOne = await signIn(researcher.email, initial);
  const allTwo = await signIn(researcher.email, initial);
  await call('/auth/logout-all', {}, allOne.accessToken);
  await call('/auth/me', undefined, allTwo.accessToken, 401);
  await call('/auth/refresh', { refreshToken: allTwo.refreshToken }, undefined, 401);
  checks.push('owner-only session revocation, current logout clears cookie, logout-all revokes every application session');

  const beforeChange = await signIn(researcher.email, initial);
  await call('/auth/password/change', { currentPassword: 'wrong', password: changedPassword }, beforeChange.accessToken, 400);
  await call('/auth/password/change', { currentPassword: initial, password: 'weak' }, beforeChange.accessToken, 400);
  await call('/auth/password/change', { currentPassword: initial, password: changedPassword }, beforeChange.accessToken);
  await call('/auth/me', undefined, beforeChange.accessToken, 401);
  await signIn(researcher.email, initial, 'api', 401);
  const afterChange = await signIn(researcher.email, changedPassword);
  checks.push('current password and strength validation, password change, old credentials/session invalidation');

  let setupToken: string | undefined;
  let token: string | undefined;
  if (live) {
    const native = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await native.auth.signInWithPassword({ email: researcher.email, password: changedPassword });
    assert.ok(signed.data.session);
    const credentials = { accessToken: signed.data.session.access_token, refreshToken: signed.data.session.refresh_token };
    await call('/auth/password/reset', { ...credentials, password: recoveredPassword }, undefined, 400);
    await call('/auth/link/resolve', { ...credentials, type: 'recovery' }, undefined, 400);
    const generated = await admin!.auth.admin.generateLink({ type: 'recovery', email: researcher.email });
    if (generated.error) throw new Error('Could not generate isolated recovery proof.');
    const resolved = await call('/auth/link/resolve', { tokenHash: generated.data.properties.hashed_token, type: 'recovery' });
    setupToken = resolved.data.setupToken;
    assert.ok(setupToken);
    assert.equal(resolved.data.accessToken, undefined);
    assert.equal(resolved.data.refreshToken, undefined);
  } else token = (await call('/auth/password/forgot', { email: researcher.email }, undefined, 202)).data.demoResetToken;
  await call('/auth/password/reset', { setupToken, token, password: recoveredPassword });
  await call('/auth/password/reset', { setupToken, token, password: recoveredPassword }, undefined, 400);
  await call('/auth/me', undefined, afterChange.accessToken, 401);
  await signIn(researcher.email, changedPassword, 'api', 401);
  const recovered = await signIn(researcher.email, recoveredPassword);
  checks.push(`password recovery proof, single-use completion, old session invalidation${live ? ', ordinary provider login cannot authorize reset' : ''}`);

  if (live) {
    const externalPassword = `External-${randomUUID()}!`;
    const result = await admin!.auth.admin.updateUserById(researcher.authUserId!, { password: externalPassword });
    if (result.error) throw new Error('Could not simulate password change through shared Supabase Auth.');
    await call('/auth/me', undefined, recovered.accessToken, 401);
    await call('/auth/refresh', { refreshToken: recovered.refreshToken }, undefined, 401);
    await signIn(researcher.email, externalPassword);
    checks.push('shared/mobile Supabase password change invalidates existing web access and refresh sessions');
    const nativeConsumer = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedConsumer = await nativeConsumer.auth.signInWithPassword({ email: consumer.email, password });
    assert.ok(signedConsumer.data.session);
    for (const table of ['sessions', 'auth_account_security', 'auth_challenges', 'auth_rate_limits']) assert.ok((await nativeConsumer.from(table).select('id')).error, `${table} must not be readable with a public authenticated key.`);
    assert.ok((await nativeConsumer.from('users').update({ role: 'Administrator' }).eq('id', consumer.id)).error, 'Direct profile role escalation must be denied.');
    assert.ok((await nativeConsumer.rpc('mobile_mutate', { p_method: 'PATCH', p_resource: 'users/me', p_body: { role: 'Administrator' }, p_key: `auth-audit-${suffix}` })).error, 'Mobile RPC role escalation must be denied.');
    assert.equal((await store!.findById('users', consumer.id))?.role, 'Consumer');
    await nativeConsumer.auth.signOut();
    checks.push('live RLS protects credential/session tables and both direct/mobile-RPC role escalation are denied');
    const expires = await signIn(consumer.email, password);
    const expired = await admin!.from('sessions').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', expires.session.id).eq('user_id', consumer.id);
    if (expired.error) throw new Error('Could not expire the isolated test session.');
    await call('/auth/me', undefined, expires.accessToken, 401);
    await call('/auth/refresh', { refreshToken: expires.refreshToken }, undefined, 401);
    checks.push('expired database sessions reject both access and refresh credentials');
  }
  await call(`/users/${researcher.id}`, { accountStatus: 'Suspended', reason: 'Isolated authentication suspension test' }, adminLogin.accessToken, 200, 'PATCH');
  await call('/auth/me', undefined, recovered.accessToken, 401);
  const inactive = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: researcher.email, password: recoveredPassword }) });
  assert.ok([401, 403].includes(inactive.status));
  await call(`/users/${researcher.id}`, { accountStatus: 'Deactivated', reason: 'Isolated authentication deactivation test' }, adminLogin.accessToken, 200, 'PATCH');
  const unknown = `unknown-${suffix}@example.test`;
  emails.push(unknown);
  for (let attempt = 0; attempt < 5; attempt++) await signIn(unknown, 'wrong', 'api', attempt === 4 ? 429 : 401);
  const locked = await call('/auth/login', { email: unknown, password: 'wrong' }, undefined, 429);
  assert.ok(Number(locked.response.headers.get('retry-after')) > 0);
  const knownRecovery = await call('/auth/password/forgot', { email: researcher.email }, undefined, 202);
  const unknownRecovery = await call('/auth/password/forgot', { email: unknown }, undefined, 202);
  assert.equal(knownRecovery.data.message, unknownRecovery.data.message);
  checks.push('suspension/deactivation, privacy-safe recovery response, persistent login attempt limit and Retry-After');
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  if (admin) {
    if (authIds.length) {
      const { data, error } = await admin.from('users').select('id').in('auth_user_id', authIds);
      if (error) throw new Error('Could not locate temporary profiles for cleanup.');
      for (const row of data ?? []) if (!profileIds.includes(row.id)) profileIds.push(row.id);
    }
    for (const profileId of profileIds) {
      for (const table of ['sessions', 'auth_challenges', 'auth_account_security']) {
        const { error } = await admin.from(table).delete().eq('user_id', profileId);
        if (error) throw new Error(`Could not remove temporary ${table} records.`);
      }
      const audit = await admin.from('activity_logs').delete().or(`actor_id.eq.${profileId},entity_id.eq.${profileId}`);
      if (audit.error) throw new Error('Could not remove temporary audit records.');
      const profile = await admin.from('users').delete().eq('id', profileId);
      if (profile.error) throw new Error('Could not remove temporary profile.');
    }
    for (const authId of authIds) if ((await admin.auth.admin.deleteUser(authId)).error) throw new Error('Could not remove temporary identity.');
    const limits = emails.flatMap(email => ['login', 'password_reset', 'email_verification'].map(scope => `ARL-${scope}-${createHmac('sha256', signingSecret).update(email.trim().toLowerCase()).digest('hex')}`));
    if (limits.length && (await admin.from('auth_rate_limits').delete().in('id', limits)).error) throw new Error('Could not remove temporary rate-limit records.');
  }
  if (process.exitCode) console.error('Authentication acceptance failed. Check the isolated API and Supabase Auth logs; credentials are not printed.');
}
console.log(JSON.stringify({ result: 'passed', storage: live ? 'supabase' : 'memory-demo', checks, emailsSent: 0, cleanup: live ? 'Temporary identities and records removed.' : 'Isolated API stopped.' }, null, 2));
