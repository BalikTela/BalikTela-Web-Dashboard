import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.INVITATION_UI_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const admin = { id: 'UI-ADMIN', fullName: 'Existing Administrator', role: 'Administrator', scope: { aggregateOnly: false } };
const recipient = { id: 'UI-INVITEE', fullName: 'Invited Researcher', role: 'Researcher', accountStatus: 'Pending verification', scope: { aggregateOnly: true } };
const checks = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    for (const scenario of ['fragment', 'missing-type', 'token-hash', 'recovery', 'confirmation', 'expired', 'incomplete']) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let resolutions = 0;
      let updates = 0;
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let body;
        if (path === '/api/auth/me') body = { user: admin, access: { permissions: ['analytics.read'] }, storage: 'ui-fixture' };
        else if (path === '/api/auth/link/resolve') {
          resolutions++;
          const supplied = route.request().postDataJSON();
          if (scenario === 'token-hash') assert.equal(supplied.tokenHash, 'test-once');
          const intent = scenario === 'recovery' ? 'recovery' : scenario === 'confirmation' ? 'confirmation' : 'invite';
          body = { email: 'invited@example.test', intent, requiresPassword: intent !== 'confirmation', accessToken: 'verified-access', refreshToken: 'verified-refresh' };
        } else if (path === '/api/auth/password/reset') {
          updates++;
          const supplied = route.request().postDataJSON();
          assert.equal(supplied.accessToken, 'verified-access');
          assert.equal(supplied.password, 'PrivateInvitation2026!');
          body = { email: 'invited@example.test', message: 'Password created. Administrator approval is still required.' };
        } else if (path === '/api/auth/login') body = { user: recipient, access: { permissions: ['profile.read'] }, accessToken: 'fixture-app-token', csrfToken: 'fixture-csrf', storage: 'ui-fixture' };
        else throw new Error(`Unexpected callback request: ${path}`);
        await route.fulfill({ json: body });
      });
      const suffix = {
        fragment: '?auth=complete#access_token=test-access&refresh_token=test-refresh&type=invite',
        'missing-type': '?auth=complete#access_token=test-access&refresh_token=test-refresh',
        'token-hash': '?auth=complete&type=invite&token_hash=test-once',
        recovery: '?auth=complete#access_token=test-access&refresh_token=test-refresh&type=recovery',
        confirmation: '?auth=complete#access_token=test-access&refresh_token=test-refresh&type=signup',
        expired: '?auth=complete#error=access_denied&error_code=otp_expired',
        incomplete: '?auth=complete',
      }[scenario];
      await page.goto(`${base}/${suffix}`);
      if (['expired', 'incomplete'].includes(scenario)) {
        await page.getByRole('heading', { name: 'Email link unavailable' }).waitFor();
        assert.equal(resolutions, 0);
      } else if (scenario === 'confirmation') {
        await page.getByText('Email confirmed. Sign in with the password you chose during registration.', { exact: true }).waitFor();
        assert.equal(await page.locator('input[type=password]').count(), 0);
      } else {
        const label = scenario === 'recovery' ? 'New password' : 'Create password';
        await page.getByLabel(label, { exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: 'Overview', exact: true }).count(), 0);
        await page.getByLabel(label, { exact: true }).fill('PrivateInvitation2026!');
        await page.getByLabel('Confirm password', { exact: true }).fill('MismatchedPassword2026!');
        await page.getByRole('button', { name: scenario === 'recovery' ? 'Update password' : 'Create password', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Password confirmation does not match.' }).waitFor();
        assert.equal(updates, 0);
        await page.getByLabel('Confirm password', { exact: true }).fill('PrivateInvitation2026!');
        if (scenario === 'fragment') await page.screenshot({ path: `/tmp/baliktela-invitation-${viewport.width}.png`, fullPage: true });
        await page.getByRole('button', { name: scenario === 'recovery' ? 'Update password' : 'Create password', exact: true }).click();
        await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
        assert.equal(updates, 1);
        assert.equal(await page.locator('input[type=email]').inputValue(), 'invited@example.test');
        await page.getByLabel('Password', { exact: true }).fill('PrivateInvitation2026!');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.getByRole('heading', { name: 'Account approval is pending', exact: true }).waitFor();
      }
      if (!['expired', 'incomplete'].includes(scenario)) assert.equal(resolutions, 1, 'One-time tokens must not be consumed twice by StrictMode.');
      assert.equal(new URL(page.url()).hash, '');
      assert.equal(new URL(page.url()).search, '');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      checks.push(`${viewport.width}: ${scenario}`);
      await context.close();
    }
  }
  console.log(JSON.stringify({ result: 'passed', checks }, null, 2));
} finally { await browser.close(); }
