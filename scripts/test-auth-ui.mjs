import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const base = process.env.INVITATION_UI_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const recipient = { id: 'AUTH-UI-RESEARCHER', fullName: 'Authentication UI Researcher', role: 'Researcher', accountStatus: 'Pending verification', scope: { aggregateOnly: true } };
const profile = { user: recipient, access: { permissions: ['profile.read'] }, storage: 'ui-fixture' };
const checks = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    for (const scenario of ['reload', 'expiry', 'offline-logout']) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      let state = 'initial';
      let refreshes = 0;
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/auth/login') { state = 'signed'; return route.fulfill({ json: { ...profile, accessToken: 'auth-ui-private-token', csrfToken: 'csrf-ui-initial' } }); }
        if (path === '/api/auth/me' && state === 'signed' && route.request().headers().authorization) return route.fulfill({ json: profile });
        if (path === '/api/auth/refresh' && state === 'signed') {
          refreshes++;
          assert.ok(route.request().headers()['x-csrf-token']);
          return route.fulfill({ json: { accessToken: 'auth-ui-refreshed-token', csrfToken: 'csrf-ui-rotated' } });
        }
        if (path === '/api/auth/logout' && scenario === 'offline-logout') return route.abort('failed');
        return route.fulfill({ status: 401, json: { message: 'The session is unavailable.' } });
      });
      await page.goto(base);
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Create participant account', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Email address', { exact: true }).inputValue(), '');
      assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
      assert.equal(await page.getByText('Demo access', { exact: true }).count(), 0);
      assert.equal(await page.getByText('admin@baliktela.demo', { exact: true }).count(), 0);
      await page.getByLabel('Email address', { exact: true }).fill('researcher@example.test');
      await page.getByLabel('Password', { exact: true }).fill('PrivateResearcher2026!');
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.getByRole('heading', { name: 'Account approval is pending', exact: true }).waitFor();
      if (scenario === 'reload') {
        await page.reload();
        await page.getByRole('heading', { name: 'Account approval is pending', exact: true }).waitFor();
        assert.equal(refreshes, 1, 'StrictMode bootstrap requests must coalesce cookie refresh.');
        assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('auth-ui-private-token')), false);
      } else if (scenario === 'expiry') {
        state = 'expired';
        await page.evaluate(async () => { const { platformApi } = await import('/src/services/platformApi.ts'); await platformApi.sessions().catch(() => undefined); });
        await page.getByRole('heading', { name: 'Sign in to your workspace', exact: true }).waitFor();
        await page.getByRole('alert').filter({ hasText: 'Your session expired or was revoked.' }).waitFor();
      } else {
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.getByRole('heading', { name: 'Sign in to your workspace', exact: true }).waitFor();
        await page.getByRole('alert').filter({ hasText: 'Server sign-out could not be confirmed.' }).waitFor();
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      checks.push(`${viewport.width}: ${scenario}`);
      await context.close();
    }
  }
  console.log(JSON.stringify({ result: 'passed', checks }, null, 2));
} finally { await browser.close(); }
