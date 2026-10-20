import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { rewardsPage } from '../server/rewards.js';
import type { RewardActivity } from '../shared/rewards.js';

const listener = createServer().listen(0, '127.0.0.1'); await once(listener, 'listening');
const address = listener.address(); assert.ok(address && typeof address !== 'string');
await new Promise<void>(resolve => listener.close(() => resolve()));
const base = `http://127.0.0.1:${address.port}`;
const child = spawn(process.execPath, ['build/server/index.js'], {
  env: { ...process.env, NODE_ENV: 'test', SERVE_WEB: 'true', PORT: String(address.port), CLIENT_ORIGIN: base, JWT_SECRET: randomUUID() + randomUUID(),
    SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', MONGODB_URI: '', AUTH_DEMO_DELIVERY: 'true', DASHBOARD_PREWARM: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = ''; child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000); }); child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000); });
const members = Array.from({ length: 45 }, (_, index) => ({ id: `CONSUMER-${String(index).padStart(2, '0')}`, name: `Consumer ${String(index).padStart(2, '0')}`, role: 'Consumer', active: true }));
const entries: RewardActivity[] = members.slice(0, 43).map((member, index) => ({ id: `AWARD-${index}`, userId: member.id, name: member.name, title: 'Listed textile: Denim offcuts - Direct to consumer', points: 5,
  entryType: 'earned', createdAt: '2026-10-20T08:00:00Z' }));
entries.push({ ...entries[0], id: 'REVERSAL', points: -2, title: 'Corrected award', entryType: 'reversal' },
  { ...entries[0], id: 'REDEMPTION', points: -1, title: 'Redeemed credits', entryType: 'redemption' },
  { ...entries[0], id: 'ZZ-ADJUSTMENT', points: 3, title: 'Signed adjustment', entryType: 'adjustment' });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const directory = '/tmp/baliktela-rewards-ui'; await mkdir(directory, { recursive: true });
try {
  for (let attempt = 0; ; attempt++) {
    try { assert.equal((await fetch(`${base}/api/health`).then(response => response.json())).status, 'ok'); break; }
    catch { if (child.exitCode !== null || attempt > 80) throw new Error(`Isolated API did not start: ${output}`); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const results = [];
  for (const width of [375, 1366, 2560]) {
    const context: BrowserContext = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    const page: Page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let mode: 'normal' | 'empty' | 'error' | 'slow' = 'normal';
    await page.route('**/api/rewards?*', async route => {
      const url = new URL(route.request().url()); requests.push(url.search);
      assert.equal(route.request().method(), 'GET');
      if (mode === 'error') return route.fulfill({ status: 503, json: { message: 'Rewards temporarily unavailable.' } });
      if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 700));
      const view = url.searchParams.get('view') === 'activity' ? 'activity' : 'leaderboard';
      return route.fulfill({ json: rewardsPage(mode === 'empty' ? [] : members, mode === 'empty' ? [] : entries,
        { view, page: Number(url.searchParams.get('page')), limit: Number(url.searchParams.get('limit')) }) });
    });
    await page.goto(`${base}/login`);
    await page.getByLabel('Email address', { exact: true }).fill('admin@baliktela.demo');
    await page.getByLabel('Password', { exact: true }).fill('BalikTelaDemo2026!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByText('Program Analytics', { exact: true }).waitFor();
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Rewards', exact: true }).click();
    await page.getByRole('table', { name: 'Community leaderboard', exact: true }).waitFor();
    const table = () => page.getByRole('table', { name: 'Community leaderboard', exact: true });
    assert.equal(await table().locator('tbody tr').count(), 20);
    assert.equal(await table().locator('tbody tr').first().locator('td').first().textContent(), '1');
    assert.equal(await page.getByText('Global view', { exact: true }).count(), 0);
    await page.screenshot({ path: `${directory}/leaderboard-${width}.png`, fullPage: true });
    await page.getByLabel('Rewards rows per page', { exact: true }).selectOption('10');
    await page.getByText('1-10 of 45 records', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Next page', exact: true }).click();
    await page.getByText('11-20 of 45 records', { exact: true }).waitFor();
    assert.ok(requests.some(query => query.includes('page=2') && query.includes('limit=10')));
    assert.equal(await table().locator('tbody tr').first().locator('td').first().textContent(), '2');
    await page.getByRole('button', { name: 'Last page', exact: true }).click();
    await page.getByText('41-45 of 45 records', { exact: true }).waitFor();
    assert.equal(await table().getByText('0', { exact: true }).count(), 2);
    assert.ok(await page.getByRole('button', { name: 'Next page', exact: true }).isDisabled());
    await page.getByRole('button', { name: 'Reward Activity', exact: true }).click();
    await page.getByRole('table', { name: 'Reward activity', exact: true }).waitFor();
    await page.getByText('Reversal', { exact: true }).waitFor();
    await page.getByText('Redeemed', { exact: true }).waitFor();
    await page.getByText('Adjustment', { exact: true }).waitFor();
    await page.screenshot({ path: `${directory}/activity-${width}.png`, fullPage: true });
    mode = 'error'; await page.getByRole('button', { name: 'Refresh rewards', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Refresh failed' }).waitFor();
    assert.equal(await page.getByRole('table', { name: 'Reward activity', exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
    await page.getByText('Rewards temporarily unavailable.', { exact: true }).waitFor();
    mode = 'empty'; await page.getByRole('button', { name: 'Refresh rewards', exact: true }).click();
    await page.getByText('No active Consumer accounts.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reward Activity', exact: true }).click();
    await page.getByText('No reward activity for active Consumers.', { exact: true }).waitFor();
    mode = 'slow'; await page.getByRole('button', { name: 'Leaderboard', exact: true }).click();
    await page.getByText('Loading rewards...', { exact: true }).waitFor();
    await table().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill('researcher@baliktela.demo');
    await page.getByLabel('Password', { exact: true }).fill('BalikTelaDemo2026!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByText('Program Analytics', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Rewards', exact: true }).count(), 0);
    results.push({ width, serverPagination: 'passed', signedActivity: 'passed', loadingEmptyError: 'passed', adminOnly: 'passed', pageErrors: 0 });
    await context.close();
  }
  console.log(JSON.stringify({ results, screenshots: directory, sharedDatabaseWrites: 0 }, null, 2));
} finally {
  await browser?.close();
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
}
