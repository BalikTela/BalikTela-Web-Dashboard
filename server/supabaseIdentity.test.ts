import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { recentPasswordEmailProof, SupabaseIdentity } from './supabaseIdentity.js';

test('password setup requires recent verified invitation/recovery claims, not ordinary login claims', () => {
  const now = 1_800_000_000_000;
  const proof = (method: string, timestamp = now / 1000) => ({ session_id: 'provider-session', amr: [{ method, timestamp }] });
  assert.equal(recentPasswordEmailProof(proof('invite'), now), 'provider-session');
  assert.equal(recentPasswordEmailProof(proof('recovery'), now), 'provider-session');
  assert.equal(recentPasswordEmailProof(proof('otp'), now), 'provider-session');
  for (const method of ['password', 'oauth', 'token_refresh', 'totp']) assert.equal(recentPasswordEmailProof(proof(method), now), null);
  assert.equal(recentPasswordEmailProof(proof('recovery', now / 1000 - 1801), now), null);
  assert.equal(recentPasswordEmailProof(proof('invite', now / 1000 + 1), now), null);
  assert.equal(recentPasswordEmailProof({ amr: proof('invite').amr }, now), null);
});

test('setup codes require a recent provider-issued timestamp before OTP verification', async (t) => {
  const authUserId = '00000000-0000-4000-8000-000000000001';
  mockSupabaseEnvironment(t);
  for (const purpose of ['invite', 'recovery'] as const) {
    for (const issueTime of [null, 'not-a-timestamp', new Date(Date.now() - 601_000).toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
      await t.test(`${purpose}: rejects ${issueTime === null ? 'missing' : issueTime === 'not-a-timestamp' ? 'malformed' : Date.parse(issueTime) < Date.now() ? 'expired' : 'future'} issue time`, async (context) => {
        let requests = 0;
        context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
          requests++;
          assert.ok(String(input).endsWith(`/auth/v1/admin/users/${authUserId}`));
          return new Response(JSON.stringify({ id: authUserId, email: 'invitee@example.test', invited_at: purpose === 'invite' ? issueTime : new Date().toISOString(), recovery_sent_at: purpose === 'recovery' ? issueTime : new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        await assert.rejects(new SupabaseIdentity().verifySetupCode(authUserId, 'invitee@example.test', '123456', purpose), /invalid, expired, or already used/);
        assert.equal(requests, 1, 'Expired codes must not be verified or create a provider session.');
      });
    }
  }
});

test('failed invitation emails never generate substitute links or delete existing identities', async (t) => {
  mockSupabaseEnvironment(t);
  const cases = [
    { code: 'email_address_not_authorized', status: 403, expectedStatus: 400, message: /custom SMTP/ },
    { code: 'over_email_send_rate_limit', status: 429, expectedStatus: 429, message: /rate-limited/ },
    { code: 'email_exists', status: 422, expectedStatus: 409, message: /do not delete/ },
    { code: 'unexpected_failure', status: 500, expectedStatus: 400, message: /SMTP credentials/ },
    { code: 'request_timeout', status: 504, expectedStatus: 504, message: /timed out/ },
  ];
  for (const scenario of cases) {
    await t.test(scenario.code, async context => {
      let requests = 0;
      context.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        requests++;
        assert.equal(new URL(String(input)).pathname, '/auth/v1/invite', 'No identity lookup, delete, or generateLink fallback is allowed.');
        assert.equal(init?.method, 'POST');
        const body = JSON.parse(String(init?.body));
        assert.equal(body.data.invitation_channel, 'web');
        return new Response(JSON.stringify({ code: scenario.code, msg: 'Private SMTP diagnostic must not leak.' }), { status: scenario.status, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
      });
      await assert.rejects(new SupabaseIdentity().inviteInstitutionalUser('invitee@example.test', 'PROFILE-TEST', 'Researcher', 'Test recipient'), error => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'SupabaseAuthError');
        assert.match(error.message, scenario.message);
        assert.doesNotMatch(error.message, /Private SMTP diagnostic/);
        assert.equal((error as Error & { status: number }).status, scenario.expectedStatus);
        return true;
      });
      assert.equal(requests, 1);
    });
  }
});

test('setup resend retains a safe provider error code for operator diagnostics', async (t) => {
  mockSupabaseEnvironment(t);
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.ok(String(input).includes('/auth/v1/recover'));
    return new Response(JSON.stringify({ code: 'email_address_not_authorized', msg: 'Private SMTP diagnostic must not leak.' }), { status: 403, headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' } });
  });
  await assert.rejects(new SupabaseIdentity().requestSetupCode('invitee@example.test'), error => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error & { code: string }).code, 'email_address_not_authorized');
    assert.doesNotMatch(error.message, /Private SMTP diagnostic/);
    return true;
  });
});

function mockSupabaseEnvironment(t: TestContext) {
  const keys = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SECRET_KEY'];
  const previous = keys.map(key => process.env[key]);
  process.env.SUPABASE_URL = 'https://auth.example.test';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_isolated_test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_isolated_test';
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
}
