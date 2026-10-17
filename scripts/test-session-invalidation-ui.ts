import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Route } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';
import { REAUTHENTICATION_MESSAGES, SESSION_CHECK_INTERVAL_MS, type ReauthenticationCode } from '../shared/sessionPolicy.js';

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-session-invalidation';
const seed = await createSeedData();
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], {});
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
await page.clock.install();
let actor = structuredClone(seed.users[0]);
let authenticated = false;
let token = '';
let logins = 0;
let checks = 0;
let refreshes = 0;
let analyticsRequests = 0;
let failure: ReauthenticationCode | 'network' | 'unavailable' | 'expired-access' | undefined;
let configuration: 'denied' | 'suspended' | 'delayed' = 'denied';
let delayed: Route | undefined;
let refreshAllowed = false;
const revocationCookies: Array<string | undefined> = [];
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const authorized = route.request().headers().authorization === `Bearer ${token}` && authenticated;
  if (path === '/api/auth/login') {
    authenticated = true; logins++; token = `isolated-session-token-${logins}`; failure = undefined;
    return route.fulfill({ headers: { 'Set-Cookie': `baliktela_refresh=isolated-refresh-${logins}; HttpOnly; SameSite=Lax; Path=/api/auth` }, json: { accessToken: token, csrfToken: `isolated-csrf-${logins}`, user: actor, access: accessSummary(actor), storage: 'isolated-session-fixture' } });
  }
  if (path === '/api/auth/refresh') {
    refreshes++;
    if (refreshAllowed && authenticated) { token = `${token}-rotated`; failure = undefined; return route.fulfill({ json: { accessToken: token, csrfToken: 'isolated-rotated-csrf' } }); }
    return route.fulfill({ status: 401, json: { message: 'No isolated session.' } });
  }
  if (path === '/api/auth/me') {
    checks++;
    if (failure === 'network') return route.abort('failed');
    if (failure === 'unavailable') return route.fulfill({ status: 503, json: { message: 'Temporary isolated outage.' } });
    if (failure === 'expired-access') return route.fulfill({ status: 401, json: { message: 'Access token expired.' } });
    if (failure) { authenticated = false; return route.fulfill({ status: failure === 'ACCOUNT_UNAVAILABLE' ? 403 : 401, json: { code: failure, message: 'Account changed in isolated fixture.' } }); }
    if (!authorized) return route.fulfill({ status: 401, json: { message: 'Sign in to the isolated fixture.' } });
    return route.fulfill({ json: { user: actor, access: accessSummary(actor), storage: 'isolated-session-fixture' } });
  }
  if (path === '/api/auth/logout') {
    revocationCookies.push(route.request().headers().cookie);
    if (route.request().headers().authorization === `Bearer ${token}`) authenticated = false;
    return route.fulfill({ status: 204, headers: { 'Set-Cookie': 'baliktela_refresh=; Max-Age=0; Path=/api/auth' } });
  }
  if (path === '/api/analytics/dashboard') { analyticsRequests++; return route.fulfill({ json: analytics }); }
  if (path === '/api/configuration') {
    if (configuration === 'delayed') { delayed = route; return; }
    if (configuration === 'suspended') return route.fulfill({ status: 403, json: { code: 'ACCOUNT_UNAVAILABLE', message: 'Account suspended.' } });
    return route.fulfill({ status: 403, json: { message: 'An ordinary permission denial.' } });
  }
  return route.fulfill({ status: 404, json: { message: `Unmocked isolated endpoint ${path}` } });
});
const login = async () => {
  await page.getByLabel('Email address', { exact: true }).fill(actor.email);
  await page.getByLabel('Password', { exact: true }).fill('Isolated-Session-2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.clock.runFor(500);
  await page.getByText('Program Analytics', { exact: true }).waitFor();
};
const signedOut = async (code: ReauthenticationCode) => {
  await page.getByRole('heading', { name: 'Sign in to your workspace', exact: true }).waitFor();
  await page.getByRole('alert').getByText(REAUTHENTICATION_MESSAGES[code], { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/login');
  assert.equal(await page.locator('main .workspace-page').count(), 0, 'Protected pages must be removed, not merely covered.');
  assert.equal(await page.evaluate(() => localStorage.getItem('baliktela_csrf')), null);
};
const heartbeat = async () => { await page.clock.fastForward(SESSION_CHECK_INTERVAL_MS + 100); await page.waitForTimeout(100); };

try {
  await page.goto(new URL('/login', base).href);
  await login();
  const initialRefreshes = refreshes;
  const revoked = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/logout');
  actor.role = 'Researcher';
  failure = 'ACCOUNT_CHANGED';
  await heartbeat();
  await signedOut('ACCOUNT_CHANGED');
  await revoked;
  assert.equal((await context.cookies(new URL('/api/auth/me', base).href)).find(cookie => cookie.name === 'baliktela_refresh')?.value, 'isolated-refresh-1', 'The cookie-free old-session revocation must not apply its Set-Cookie response.');
  assert.equal(refreshes, initialRefreshes, 'Revoked account access must not be silently refreshed.');
  const beforeReload = checks;
  await page.reload();
  await signedOut('ACCOUNT_CHANGED');
  assert.equal(checks, beforeReload, 'Reload must not silently restore the revoked session.');
  await page.screenshot({ path: `${output}/role-change-desktop.png` });
  await login();
  assert.equal(await page.getByRole('button', { name: 'User Accounts', exact: true }).count(), 0, 'The new role must govern the next workspace.');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('baliktela_reauthentication')), null);
  assert.equal(analyticsRequests, 2);

  const beforeHidden = checks;
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { configurable: true, value: true }));
  failure = 'SESSION_REVOKED';
  await heartbeat();
  assert.equal(checks, beforeHidden, 'Hidden tabs must not poll.');
  await page.evaluate(() => { Reflect.deleteProperty(document, 'hidden'); document.dispatchEvent(new Event('visibilitychange')); });
  await signedOut('SESSION_REVOKED');
  await login();

  // Direct permission-policy changes are detected even if a legacy API has not revoked the session yet.
  actor.scope.canExport = !actor.scope.canExport;
  await heartbeat();
  await signedOut('ACCOUNT_CHANGED');
  await login();
  const beforeRevoke = analyticsRequests;
  failure = 'SESSION_REVOKED';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await signedOut('SESSION_REVOKED');
  await login();
  assert.equal(analyticsRequests, beforeRevoke + 1, 'A same-role login must load fresh analytics instead of reusing the old session cache.');

  const analyticsBeforeOutage = analyticsRequests;
  for (const outage of ['network', 'unavailable'] as const) {
    failure = outage;
    await heartbeat();
    assert.ok(await page.getByText('Program Analytics', { exact: true }).isVisible(), 'Network and service failures must not sign out a valid user.');
  }
  failure = undefined;
  refreshAllowed = true;
  failure = 'expired-access';
  await heartbeat();
  assert.ok(await page.getByText('Program Analytics', { exact: true }).isVisible(), 'An ordinary access-token expiry must refresh transparently.');
  assert.equal(refreshes, initialRefreshes + 1);
  assert.equal(analyticsRequests, analyticsBeforeOutage, 'Session checks must not refetch analytics.');
  refreshAllowed = false;

  failure = 'SESSION_EXPIRED';
  await heartbeat();
  await signedOut('SESSION_EXPIRED');
  actor = structuredClone(seed.users[0]);
  await login();
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByText('An ordinary permission denial.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Sign in to your workspace', exact: true }).count(), 0);
  failure = 'SESSION_REVOKED';
  await heartbeat();
  await signedOut('SESSION_REVOKED');
  await login();
  configuration = 'delayed';
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.waitForTimeout(100);
  assert.ok(delayed);
  failure = 'SESSION_REVOKED';
  await heartbeat();
  await signedOut('SESSION_REVOKED');
  await login();
  await delayed!.fulfill({ status: 401, json: { code: 'ACCOUNT_CHANGED', message: 'Late response from an older login.' } });
  await page.waitForTimeout(100);
  assert.ok(await page.getByText('Program Analytics', { exact: true }).isVisible(), 'A delayed response from an old session must not sign out a new login.');

  failure = 'SESSION_REVOKED';
  await heartbeat();
  await signedOut('SESSION_REVOKED');
  await login();
  configuration = 'suspended';
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await signedOut('ACCOUNT_UNAVAILABLE');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: `${output}/account-unavailable-mobile.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'The sign-out explanation must fit mobile screens.');
  const stopped = checks;
  await heartbeat();
  assert.equal(checks, stopped, 'The session timer must stop after sign-out.');
  assert.ok(revocationCookies.length > 0 && revocationCookies.every(value => value === undefined), 'Automatic session revocation must never send browser cookies.');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'passed', checks: ['idle role-change logout', 'persistent explanation and manual reauthentication', 'new-role navigation', 'hidden-tab pause and resume', 'cookie-free old-session revocation', 'permission/scope changes', 'focus-triggered revocation', 'same-role cache clearing', 'network/503 resilience', 'transparent normal token refresh', 'ordinary 403 stays signed in', 'late old-session response rejected', 'account suspension', 'mobile notice', 'timer cleanup'], screenshots: output, liveDatabaseWrites: 0, emailsSent: 0 }, null, 2));
} finally { await browser.close(); }
