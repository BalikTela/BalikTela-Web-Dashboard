import assert from 'node:assert/strict';
import test from 'node:test';
import { readAuthLink } from '../src/lib/authLinks.js';

test('setup entry opens without URL credentials and preserves the requested code type', () => {
  for (const suffix of ['?auth=setup', '?auth=setup&purpose=recovery']) {
    const link = readAuthLink(`https://dashboard.example.test/${suffix}`);
    assert.equal(link.isCallback, true);
    assert.equal(link.isSetup, true);
    assert.equal(link.hasCredentials, false);
    assert.equal(link.error, '');
    assert.equal(link.setupPurpose, suffix.includes('recovery') ? 'recovery' : 'invite');
  }
});

test('invitation and recovery callbacks are recognized with fragment or query types', () => {
  for (const suffix of [
    '?auth=complete#access_token=test-access&refresh_token=test-refresh&type=invite',
    '?auth=complete&type=invite#access_token=test-access&refresh_token=test-refresh',
    '?auth=invite#access_token=test-access&refresh_token=test-refresh',
    '?auth=complete#access_token=test-access&refresh_token=test-refresh',
    '?auth=recovery#access_token=test-access&refresh_token=test-refresh',
    '?token_hash=test-hash&type=invite',
    '?auth=invite&resetToken=development-token',
  ]) {
    const link = readAuthLink(`https://dashboard.example.test/${suffix}`);
    assert.equal(link.isCallback, true);
    assert.equal(link.hasCredentials, true);
    assert.equal(link.error, '');
  }
});

test('missing, partial, expired, and unsupported links cannot claim successful confirmation', () => {
  for (const suffix of ['?auth=complete', '?auth=invite#access_token=partial', '?token_hash=test&type=unknown', '?code=unsupported-pkce']) {
    const link = readAuthLink(`https://dashboard.example.test/${suffix}`);
    assert.equal(link.isCallback, true);
    assert.ok(link.error);
  }
  assert.match(readAuthLink('https://dashboard.example.test/#error=access_denied&error_code=otp_expired').error, /expired/);
  assert.equal(readAuthLink('https://dashboard.example.test/').isCallback, false);
});
