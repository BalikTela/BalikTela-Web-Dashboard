import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { WEB_ACCESS_MESSAGE } from '../shared/webAccess.js';

// The actual API runs against isolated in-memory fixtures, never shared Supabase.
const seed = await createSeedData();
const socket = createServer().listen(0, '127.0.0.1'); await once(socket, 'listening');
const address = socket.address(); assert.ok(address && typeof address !== 'string');
await new Promise<void>(resolve => socket.close(() => resolve()));
const origin = `http://127.0.0.1:${address.port}`, password = 'BalikTelaDemo2026!';
const child = spawn(process.execPath, ['build/server/index.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(address.port), CLIENT_ORIGIN: origin, SERVE_WEB: 'true', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', MONGODB_URI: '', AUTH_DEMO_DELIVERY: 'true', DASHBOARD_PREWARM: 'false', JWT_SECRET: 'isolated-web-role-policy-test-signing-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.resume(); child.stderr.resume();
const output = '/tmp/baliktela-web-role-policy'; await mkdir(output, { recursive: true });
async function call(path: string, token?: string, body?: Record<string, unknown>, expected = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${origin}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const value = await response.json().catch(() => ({}));
  assert.equal(response.status, expected, `${method} ${path}: ${response.status}: ${value.message ?? ''}`);
  return value;
}
const signIn = (role: string, expected = 200) => call('/auth/login', undefined, { email: seed.users.find(user => user.role === role)!.email, password, client: 'api' }, expected);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Wait for this isolated API. */ }
    assert.ok(child.exitCode === null && attempt < 80, 'Isolated API failed to start.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const admin = await signIn('Administrator');
  for (const role of ['Producer', 'Recycler', 'Consumer']) {
    const denied = await signIn(role, 403);
    assert.equal(denied.code, 'WEB_ACCESS_DENIED'); assert.equal(denied.accessToken, undefined);
  }
  await call('/auth/register', undefined, { email: 'no-create@example.invalid', fullName: 'No create', password, consent: true }, 403);
  const usersBefore = await call('/users', admin.accessToken);
  assert.equal(usersBefore.users.length, seed.users.length);
  const researchUser = seed.users.find(user => user.role === 'Researcher')!;
  const governmentUser = seed.users.find(user => user.role === 'Government')!;
  await call(`/users/${researchUser.id}`, admin.accessToken, { aggregateOnly: false, regions: [], canExport: true, reason: 'Isolated de-identified research access verification.' }, 200, 'PATCH');
  const governmentEdit = await call(`/users/${governmentUser.id}`, admin.accessToken, { aggregateOnly: false, canExport: true, reason: 'Government summary enforcement verification.' }, 200, 'PATCH');
  assert.equal(governmentEdit.user.scope.aggregateOnly, true);
  const researcher = await signIn('Researcher'), government = await signIn('Government');
  assert.equal(government.user.scope.aggregateOnly, true);
  for (const account of [researcher, government]) {
    for (const path of ['/users', '/audit-records']) await call(path, account.accessToken, undefined, 403);
    for (const path of ['/material-batches/MB-2609-001', '/users/USR-PROD-01', '/facilities/FAC-001', '/configuration', '/barter/listings/LST-2609-001']) await call(path, account.accessToken, { reason: 'Must be denied.' }, 403, 'PATCH');
    await call('/analytics/dashboard?producer=Private%20Name', account.accessToken, undefined, 403);
  }
  await call('/barter/listings', government.accessToken, undefined, 403);
  await call('/material-batches', government.accessToken, undefined, 403);
  await call('/transfers', government.accessToken, undefined, 403);
  await call('/analytics/predictive', government.accessToken, undefined, 403);
  const records = await Promise.all(['/barter/listings', '/material-batches?dateRange=All%20time', '/transfers?dateRange=All%20time', '/recovery-records?dateRange=All%20time', '/facilities', '/hubs', '/hub-operations?dateRange=All%20time', '/hub-disposals?dateRange=All%20time', '/governance', '/analytics/dashboard', '/data-quality', '/configuration'].map(path => call(path, researcher.accessToken)));
  const encoded = JSON.stringify(records);
  for (const row of [...seed.users, ...seed.organizations, ...seed.facilities]) {
    assert.ok(!encoded.includes(row.id), `Research response exposed source ID ${row.id}`);
    const name = 'fullName' in row ? row.fullName : row.name;
    assert.ok(!encoded.includes(name), 'Research response exposed a source name.');
  }
  assert.ok(records[0].listings.length); assert.ok(records[1].batches.length); assert.ok(records[2].transfers.length);
  assert.match(records[0].listings[0].id, /^LISTING-/); assert.match(records[1].batches[0].id, /^BATCH-/); assert.match(records[2].transfers[0].id, /^TRANSACTION-/);
  for (const account of [researcher, government]) {
    const report = await call('/reports/organizations/export?format=print', account.accessToken);
    assert.equal(report.scope.aggregateOnly, true);
    for (const organization of seed.organizations) assert.ok(!JSON.stringify(report).includes(organization.name));
  }
  await call(`/users/${seed.users[0].id}`, admin.accessToken, { role: 'Consumer', reason: 'Self-demotion must be refused.' }, 409, 'PATCH');
  const mobile = seed.users.find(user => user.role === 'Consumer')!;
  const managed = await call(`/users/${mobile.id}`, admin.accessToken, { fullName: mobile.fullName, reason: 'Admin can still manage mobile-only accounts.' }, 200, 'PATCH');
  assert.equal(managed.user.role, 'Consumer');
  await call('/users', researcher.accessToken, { fullName: 'No invite', email: 'denied@example.invalid', role: 'Administrator' }, 403);
  await call('/users', admin.accessToken, { fullName: 'No mobile invite', email: 'denied@example.invalid', role: 'Recycler', organizationId: seed.organizations[0].id }, 400);

  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const screenshots: string[] = [];
  for (const width of [375, 1440]) for (const role of ['Administrator', 'Government', 'Researcher']) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/dashboard`);
    await page.getByLabel('Email address', { exact: true }).fill(seed.users.find(user => user.role === role)!.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    if (role === 'Administrator') {
      await page.getByRole('button', { name: 'User Accounts', exact: true }).click();
      const table = page.getByRole('table', { name: 'User accounts', exact: true }); await table.waitFor();
      const options = await page.getByLabel('Account group', { exact: true }).locator('option').allTextContents();
      assert.deepEqual(options, ['All account groups', 'Admin', 'Government', 'Researcher', 'Producer / Consumer', 'Recycler / Hub']);
      await page.getByLabel('Account group', { exact: true }).selectOption('Producer / Consumer');
      assert.ok(await table.getByText('Mobile only', { exact: true }).count());
      await page.getByLabel('Account group', { exact: true }).selectOption('Recycler / Hub');
      assert.ok(await table.getByText('Mobile only', { exact: true }).count());
      await table.getByRole('button', { name: 'Manage access', exact: true }).first().click();
      assert.equal(await page.getByRole('dialog').getByLabel('Platform access', { exact: true }).inputValue(), 'Mobile only');
      await page.getByRole('button', { name: 'Close account editor', exact: true }).click();
      await page.getByRole('button', { name: 'Dashboard account', exact: true }).click();
      await page.getByLabel('Dashboard role', { exact: true }).waitFor();
      assert.deepEqual(await page.getByLabel('Dashboard role', { exact: true }).locator('option').allTextContents(), ['Admin', 'Government', 'Researcher']);
      await page.getByRole('button', { name: 'Close account editor', exact: true }).click();
    } else {
      for (const label of ['User Accounts', 'Organizations', 'Audit Trail', 'Configuration', 'Rewards']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
      if (role === 'Government') {
        for (const label of ['Listing Oversight', 'Material Registry', 'Traceability']) assert.equal(await page.getByRole('button', { name: label, exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Advanced Analytics', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Predictive', exact: true }).count(), 0);
      } else {
        await page.getByRole('button', { name: 'Listing Oversight', exact: true }).click();
        await page.getByText('Cotton textile listing', { exact: true }).first().waitFor();
        assert.ok(!(await page.locator('main').innerText()).includes(seed.listings[0].title));
        assert.equal(await page.getByRole('button', { name: /Review listing/ }).count(), 0);
      }
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const path = `${output}/${role}-${width}.png`; await page.screenshot({ path, fullPage: true }); screenshots.push(path);
    assert.deepEqual(errors, []); await context.close();
  }
  for (const role of ['Producer', 'Recycler', 'Consumer']) {
    const context = await browser.newContext({ viewport: { width: 375, height: 900 } }), page = await context.newPage();
    await page.goto(`${origin}/dashboard`);
    await page.getByLabel('Email address', { exact: true }).fill(seed.users.find(user => user.role === role)!.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText(WEB_ACCESS_MESSAGE, { exact: true }).waitFor();
    assert.equal(await page.getByText('Program Analytics', { exact: true }).count(), 0);
    await context.close();
  }
  console.log(JSON.stringify({ result: 'passed', rolesWithWebAccess: ['Administrator', 'Government', 'Researcher'], mobileWebLoginsDenied: true, readOnlyAndPrivacyChecks: true, browserScenarios: screenshots.length + 3, screenshots, sharedDatabaseWrites: 0 }, null, 2));
} finally {
  await browser?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
}
