import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';
import { buildPredictiveReport, trainingCsv } from '../server/analytics/predictive.js';

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-predictive-ui';
await mkdir(output, { recursive: true });
const seed = await createSeedData();
const admin = seed.users[0];
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), admin, {});
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks: string[] = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let fail = viewport.width === 375;
    let predictiveRequests = 0;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: admin, access: accessSummary(admin), storage: 'isolated-ui-fixture' } });
      if (url.pathname === '/api/analytics/dashboard') return route.fulfill({ json: analytics });
      if (url.pathname === '/api/governance') return route.fulfill({ json: {
        methodology: { massAccounting: 'Verified mass accounting', environmentalImpact: 'Pending methodology', predictiveAnalytics: 'Synthetic proof of concept', prescriptiveAnalytics: 'Legacy API metadata; not a dashboard feature', version: 'Demo methodology' },
        privacy: { role: 'Administrator', policy: 'Authorized scope', aggregateOnly: false, exportAllowed: true }, policyIndicators: [],
      } });
      if (url.pathname === '/api/analytics/predictive/dataset') return route.fulfill({ json: { csv: trainingCsv(), filename: 'baliktela-synthetic-predictive-v1.csv' } });
      if (url.pathname === '/api/analytics/predictive') {
        predictiveRequests++;
        if (fail) return route.fulfill({ status: 503, json: { message: 'Isolated forecast retry test.' } });
        return route.fulfill({ json: buildPredictiveReport({ region: url.searchParams.get('region') ?? undefined, materialCategory: url.searchParams.get('materialCategory') ?? undefined, historyWeeks: Number(url.searchParams.get('historyWeeks') ?? 26) }) });
      }
      return route.fulfill({ status: 404, json: { message: `Unexpected ${url.pathname}` } });
    });
    await page.goto(new URL('/dashboard', base).href);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const navigation = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await navigation.isVisible()) await navigation.click();
    await page.getByRole('button', { name: 'Advanced Analytics', exact: true }).click();
    await page.getByRole('button', { name: 'Diagnostic', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Prescriptive', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Predictive', exact: true }).click();
    const panel = page.locator('.predictive');
    assert.equal(await panel.getByText('Synthetic proof of concept', { exact: true }).count(), 0);
    await panel.getByText('Simulated platform activity. Separate from live operational records.', { exact: true }).waitFor();
    if (fail) { await panel.getByRole('button', { name: 'Retry forecast' }).waitFor(); fail = false; await panel.getByRole('button', { name: 'Retry forecast' }).click(); }
    await panel.getByRole('table', { name: 'Collection weekly projections' }).waitFor();
    assert.equal(await panel.getByRole('table').locator('tbody tr').count(), 4);
    assert.equal(await page.getByText('Global view', { exact: true }).isVisible(), false);
    if (viewport.width >= 1536) assert.equal(await page.getByText('Synthetic PoC · Fixed snapshot', { exact: true }).isVisible(), true);
    assert.ok((await panel.locator('.predictive-primary').innerText()).includes('69.801 t'));
    const pixels = await panel.locator('canvas').evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let filled = 0; for (let index = 3; index < pixels.length; index += 4) if (pixels[index]) filled++;
      return filled;
    });
    assert.ok(pixels > 1000, 'Forecast must render a nonblank chart.');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/collection-${viewport.width}.png`, fullPage: true });
    await panel.getByRole('tab', { name: 'Declared waste', exact: true }).click();
    await panel.getByRole('table', { name: 'Declared waste weekly projections' }).waitFor();
    assert.ok((await panel.locator('.predictive-primary').innerText()).includes('92.405 t'));
    await panel.getByRole('tab', { name: 'Recycler tendencies', exact: true }).click();
    assert.equal(await panel.getByRole('table').locator('tbody tr').count(), 6);
    await panel.getByRole('tab', { name: 'Recycler tendencies', exact: true }).press('Home');
    assert.equal(await panel.getByRole('tab', { name: 'Collection forecast', exact: true }).getAttribute('aria-selected'), 'true');
    await panel.getByRole('tab', { name: 'Collection forecast', exact: true }).press('End');
    assert.equal(await panel.getByRole('tab', { name: 'Recycler tendencies', exact: true }).getAttribute('aria-selected'), 'true');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/materials-${viewport.width}.png`, fullPage: true });
    await panel.getByRole('combobox', { name: 'Forecast region', exact: true }).selectOption('Central Visayas');
    await panel.getByText('2,400', { exact: true }).waitFor();
    await panel.getByRole('combobox', { name: 'Forecast material category', exact: true }).selectOption('Cotton');
    await panel.getByText('More supporting history is required', { exact: true }).waitFor();
    assert.equal(await panel.getByRole('table').count(), 0, 'Sparse scopes must not show stale model output.');
    await panel.getByRole('button', { name: 'Use broader scope' }).click();
    await panel.getByRole('table').waitFor();
    await panel.getByRole('combobox', { name: 'Forecast historical view', exact: true }).selectOption('13');
    await page.waitForFunction(() => !document.querySelector('.predictive [role="status"]'));
    await panel.getByRole('tab', { name: 'Collection forecast', exact: true }).click();
    assert.ok((await panel.locator('.predictive-primary').innerText()).includes('69.801 t'));
    const before = predictiveRequests;
    await panel.getByRole('combobox', { name: 'Forecast historical view', exact: true }).selectOption('26');
    await panel.getByRole('table').waitFor();
    assert.equal(predictiveRequests, before, 'Revisited scopes should reuse the short-lived report cache.');
    await panel.locator('summary').click();
    await panel.getByText('9,600 synthetic records. 120 weekly observations.', { exact: true }).waitFor();
    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Dataset CSV' }).click();
    assert.equal((await download).suggestedFilename(), 'baliktela-synthetic-predictive-v1.csv');
    const layout = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('.predictive h3, .predictive h4, .predictive p, .predictive button, .predictive strong')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible').map(element => element.textContent) }));
    assert.ok(layout.actual <= layout.width + 1, `Page overflow at ${viewport.width}: ${layout.actual}`);
    assert.deepEqual(layout.overflowing, [], `Text overflow at ${viewport.width}`);
    if (await navigation.isVisible()) await navigation.click();
    await page.getByRole('button', { name: 'Governance & Policy', exact: true }).click();
    const governance = page.locator('main [aria-hidden="false"]');
    await governance.getByText('Methodology and access status', { exact: true }).waitFor();
    assert.equal(await governance.locator('article').count(), 3);
    assert.equal(await governance.getByText(/prescriptive/i).count(), 0);
    assert.ok(await governance.getByText('Predictive analytics', { exact: true }).isVisible());
    assert.deepEqual(errors, []);
    checks.push(`${viewport.width}x${viewport.height}: diagnostic/predictive only, three outputs, filters, scope gate, CSV, cache, chart pixels, responsive layout, governance without prescriptive`);
    await context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify({ checks, screenshots: output }, null, 2));
