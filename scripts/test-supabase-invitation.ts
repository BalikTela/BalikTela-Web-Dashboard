import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';
import { SupabaseStore } from '../server/supabaseStore.js';
import { provisionedUserMutation } from '../server/provisioning.js';
import type { UserRecord } from '../server/types.js';

if (process.env.SUPABASE_INVITATION_TEST !== 'true') throw new Error('Set SUPABASE_INVITATION_TEST=true to authorize isolated invitation test identities. No emails are sent.');
const url = process.env.SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY!;
if (!url || !key) throw new Error('Supabase credentials are required.');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const store = new SupabaseStore(url, key);
const base = process.env.INVITATION_UI_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const authIds: string[] = [];
const profileIds: string[] = [];
const checks: string[] = [];
try {
  for (const format of ['fragment', 'token-hash']) {
    const suffix = randomUUID().slice(0, 8);
    const email = `baliktela.invitation.${suffix}@example.test`;
    const { data, error } = await client.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${base}/?auth=complete` } });
    if (error || !data.user) throw new Error(`Could not generate isolated invitation: ${error?.message ?? 'no identity'}`);
    authIds.push(data.user.id);
    const now = new Date().toISOString();
    const draft: UserRecord = {
      id: `USR-INVITATION-${suffix}`, authUserId: data.user.id, email, passwordHash: null,
      fullName: 'Invitation Flow Researcher (demo)', role: 'Researcher', organizationId: null,
      organization: 'Temporary invitation test (demo)', city: 'Manila', region: 'Metro Manila',
      joinedAt: now, consentAt: now, emailVerifiedAt: null, passwordChangedAt: null,
      verification: 'Pending demo review', accountStatus: 'Pending verification', trustPlaceholder: 50,
      scope: { organizationIds: [], facilityIds: [], regions: [], canExport: false, aggregateOnly: true },
      profile: { ageGroup: '', organizationSize: 'Demo', productionVolumeKg: 0, recyclingPractices: '', acceptedTextiles: [], sustainabilityInterests: [] },
    };
    const mutation = await provisionedUserMutation(store, draft);
    profileIds.push(mutation.record.id);
    await store.commit([mutation]);
    let callback: string;
    if (format === 'fragment') {
      const response = await fetch(data.properties.action_link, { redirect: 'manual' }).catch(() => { throw new Error('Invitation verification request failed (credentials redacted).'); });
      const redirect = response.headers.get('location');
      assert.ok(redirect, 'Expected the real Supabase invitation verification redirect.');
      const target = new URL(redirect);
      assert.ok(new URLSearchParams(target.hash.slice(1)).get('access_token'), 'Verification must issue invitation credentials.');
      callback = `${base}/${target.search}${target.hash}`;
    } else callback = `${base}/?auth=complete&type=invite&token_hash=${encodeURIComponent(data.properties.hashed_token)}`;

    const context = await browser.newContext({ viewport: { width: format === 'fragment' ? 1440 : 375, height: 900 } });
    const page = await context.newPage();
    // Simulate the administrator's already-open browser session without creating another live account.
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { id: 'EXISTING-ADMIN', fullName: 'Existing administrator', role: 'Administrator', scope: { aggregateOnly: false } }, access: { permissions: ['analytics.read'] }, storage: 'supabase' } }));
    await page.goto(callback).catch(() => { throw new Error('Could not open the invitation callback (credentials redacted).'); });
    await page.getByRole('heading', { name: 'Create your password', exact: true }).waitFor({ timeout: 60_000 });
    assert.equal((await store.findById('users', mutation.record.id))?.passwordChangedAt, null, 'Confirming email must not mark a password as initialized.');
    const password = `Invitation-${randomUUID()}!`;
    await page.getByLabel('Create password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create password', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ timeout: 60_000 });
    const saved = await store.findById('users', mutation.record.id);
    assert.ok(saved?.passwordChangedAt);
    assert.ok(saved?.emailVerifiedAt);
    assert.equal(saved?.accountStatus, 'Pending verification');
    assert.equal(saved?.verification, 'Pending demo review');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Account approval is pending', exact: true }).waitFor({ timeout: 60_000 });
    assert.equal(new URL(page.url()).hash, '');
    const replay = await context.request.post(`${base}/api/auth/link/resolve`, { data: { tokenHash: data.properties.hashed_token, type: 'invite' } });
    assert.equal(replay.status(), 400, 'Consumed invitation tokens must not be accepted twice.');
    await context.close();
    checks.push(`${format}: real invitation verification, private password creation, restricted sign-in, and replay rejection`);
  }
} finally {
  await browser.close();
  if (authIds.length) {
    const { data: profiles, error } = await client.from('users').select('id').in('auth_user_id', authIds);
    if (error) throw error;
    for (const profile of profiles ?? []) if (!profileIds.includes(profile.id)) profileIds.push(profile.id);
  }
  for (const profileId of profileIds) {
    for (const table of ['sessions', 'auth_challenges', 'auth_account_security']) {
      const { error } = await client.from(table).delete().eq('user_id', profileId);
      if (error) throw error;
    }
    const { error: auditError } = await client.from('activity_logs').delete().eq('actor_id', profileId);
    if (auditError) throw auditError;
    const { error: profileError } = await client.from('users').delete().eq('id', profileId);
    if (profileError) throw profileError;
  }
  for (const authId of authIds) {
    const { error } = await client.auth.admin.deleteUser(authId);
    if (error) throw error;
  }
}
console.log(JSON.stringify({ result: 'passed', checks, temporaryRecords: 'removed', emailsSent: 0 }, null, 2));
