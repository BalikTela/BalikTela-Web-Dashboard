import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from '../server/dashboardAnalytics.js';
import { buildReport, REPORT_DEFINITIONS, reportScope } from '../server/reports.js';
import { buildGovernanceDashboard } from '../server/governance.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';
import { buildOperationalDemo } from '../server/analytics/operationalDemo.js';
import { buildOctoberDemo } from '../server/analytics/octoberDemo.js';
import { DEFAULT_REPORTING_RANGE } from '../shared/reporting.js';
import type { DatabaseShape } from '../server/types.js';

// All API responses are isolated fixtures. No Supabase connection or business mutations.
const seed = await createSeedData();
const disposalHub = { ...structuredClone(seed.users.find(user => user.role === 'Recycler')!), id: 'UI-DISPOSAL-HUB', role: 'BalikTela Hub' as const, scope: { ...seed.users[0].scope, facilityIds: [] } };
seed.users.push(disposalHub);
class DisposalFixtureStore extends MemoryStore {
  async loadHubDisposals() {
    const record = { id: 'UI-DISPOSAL', listingId: seed.listings[0].id, operatorId: disposalHub.id, listingTitle: seed.listings[0].title,
      category: seed.listings[0].textileType, weightKg: 5, reason: 'Fixture Hub disposal', disposedAt: '2026-10-18T01:00:00Z' };
    return { available: true, records: [record, { ...record }] };
  }
}
seed.recoveryRecords.push(
  { ...seed.recoveryRecords[0], id: 'COLLECTION', stage: 'Collection', inputWeightKg: 89, outputWeightKg: 89, residualWeightKg: 0 },
  { ...seed.recoveryRecords[0], id: 'STOCK', batchId: seed.materialBatches[0].id, stage: 'Collection', inputWeightKg: 100, outputWeightKg: 100, residualWeightKg: 0 },
);
const query = { dateRange: 'Custom range', startDate: '2026-07-01', endDate: '2026-09-21' };
const now = new Date('2026-10-19T04:00:00Z');
const missing = { ...seed, recoveryRecords: [], measurements: [] };
const conflict = { ...seed, recoveryRecords: [...seed.recoveryRecords, { ...seed.recoveryRecords.at(-2)!, id: 'CONFLICTING-COLLECTION' }] };
const synthetic = structuredClone(seed);
for (const [name, rows] of buildOperationalDemo().domainTables) (synthetic[name] as DatabaseShape[keyof DatabaseShape]) = rows;
for (const [name, rows] of buildOctoberDemo().domainTables) (synthetic[name] as DatabaseShape[keyof DatabaseShape]).push(...rows as never[]);
const syntheticAnalytics = await buildDashboardAnalytics(new MemoryStore(synthetic), seed.users[0], {}, undefined, now);
assert.deepEqual(syntheticAnalytics.wasteTrend.map(row => row.month), ['Aug 2026', 'Sept 2026', 'Oct 2026']);
const app = express(); serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const output = '/tmp/baliktela-material-evidence-ui'; await mkdir(output, { recursive: true });
const results: unknown[] = [];
try {
  for (const viewport of [{ width: 375, height: 812 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let mode: 'normal' | 'missing' | 'conflict' | 'synthetic' = 'normal'; let writes = 0;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only fixture' } }); }
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: seed.users[0], access: accessSummary(seed.users[0]), storage: 'isolated' } });
      const filters = Object.fromEntries(url.searchParams);
      const data = mode === 'normal' ? seed : mode === 'missing' ? missing : mode === 'synthetic' ? synthetic : conflict;
      const store = mode === 'normal' ? new DisposalFixtureStore(data) : new MemoryStore(data);
      const selection = mode === 'synthetic' ? filters : { ...filters, ...query };
      if (url.pathname === '/api/analytics/dashboard') {
        return route.fulfill({ json: await buildDashboardAnalytics(store, seed.users[0], selection, undefined, now) });
      }
      if (url.pathname === '/api/material-batches') {
        const snapshot = await loadDashboardAnalyticsSnapshot(store);
        const cohort = selectAnalyticsCohort(snapshot, seed.users[0], selection, now);
        return route.fulfill({ json: { batches: cohort.currentBatches.map(batch => ({ ...batch, measurements: [] })) } });
      }
      if (url.pathname === '/api/reports') return route.fulfill({ json: { reports: REPORT_DEFINITIONS, scope: reportScope(seed.users[0]) } });
      if (url.pathname === '/api/reports/material-flow/preview') return route.fulfill({ json: await buildReport(store, seed.users[0], 'material-flow', selection, undefined, now) });
      if (url.pathname === '/api/governance') return route.fulfill({ json: await buildGovernanceDashboard(store, seed.users[0], selection, undefined, now) });
      return route.fulfill({ status: 404, json: { message: `Unmocked ${url.pathname}` } });
    });
    const open = async () => {
      await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
      await page.getByText('Program Analytics', { exact: true }).waitFor();
      await page.getByText('Evidence coverage', { exact: true }).waitFor();
      assert.equal(await page.getByRole('heading', { name: 'System oversight', exact: true }).count(), 0);
      await page.getByText('Material Evidence Summary', { exact: true }).waitFor();
      assert.equal(await page.getByText('Shared Platform Activity', { exact: true }).count(), 0);
      await page.getByText('Platform Engagement', { exact: true }).waitFor();
    };
    const visible = () => page.locator('main [aria-hidden="false"]').first();
    const checkWidth = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Horizontal page overflow at ${viewport.width}`);
    const navigate = async (name: string) => {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    await open();
    const metric = (name: string) => visible().locator('article').filter({ has: page.getByText(name, { exact: true }) }).first();
    const circularity = () => visible().locator('section').filter({ has: page.getByRole('heading', { name: 'Circular Economy Performance', exact: true }) });
    const checkCircularity = async () => {
      await circularity().getByText('Confirmed recovery share', { exact: true }).waitFor();
      await circularity().getByText('Recovery yield from sorted textiles', { exact: true }).waitFor();
      assert.equal(await circularity().locator('article').count(), 2, 'Only supported circularity indicators belong in this section.');
      assert.doesNotMatch(await circularity().innerText(), /environmental|emissions|water|disabled|conversion factor/i);
      for (const label of ['Environmental diversion claim', 'Emissions avoided', 'Water avoided']) {
        assert.equal(await visible().getByText(label, { exact: true }).count(), 0);
      }
      const layout = await circularity().locator('article').evaluateAll(items => items.map(item => {
        const bounds = item.getBoundingClientRect();
        return { top: bounds.top, left: bounds.left, right: bounds.right, width: bounds.width };
      }));
      if (viewport.width >= 1366) {
        assert.ok(Math.abs(layout[0].top - layout[1].top) < 1, 'Desktop circularity indicators must share a row.');
        assert.ok(Math.abs(layout[0].width - layout[1].width) < 1, 'Circularity indicators must have equal-width columns.');
      } else {
        assert.ok(layout[1].top > layout[0].top, 'Mobile circularity indicators must stack.');
      }
      assert.equal(await circularity().locator('article p').evaluateAll(items => items.some(item => item.scrollWidth > item.clientWidth + 1)), false, 'Circularity text must fit its container.');
      assert.ok(!(await visible().innerText()).includes('null%'));
      await checkWidth();
    };
    assert.match(await metric('Total Textiles Declared').innerText(), /0\.575 t/);
    assert.match(await metric('Total Textiles Declared').innerText(), /Reported batch weights/);
    assert.equal(await visible().getByText('Total Textiles Collected', { exact: true }).count(), 0);
    const declaredSummary = () => visible().locator('.circular-flow-step').filter({ has: page.getByText('Total Textiles Declared', { exact: true }) });
    assert.match(await declaredSummary().innerText(), /0\.575 t/);
    assert.match(await metric('Recorded Hub Disposal').innerText(), /0\.005 t/);
    assert.match(await metric('Recorded Hub Disposal').innerText(), /1 disposal record/);
    assert.equal(await page.getByText('Confirmed Reuse + Recycling', { exact: true }).count(), 0);
    const activity = () => visible().locator('section').filter({ has: page.getByText('Platform Engagement', { exact: true }) }).last();
    await activity().getByText('Registered accounts', { exact: true }).waitFor();
    assert.equal(await activity().getByText('Waste submissions', { exact: true }).count(), 0);
    assert.equal(await activity().getByText('Barter actions', { exact: true }).count(), 0);
    for (const label of ['Active users', 'Sessions', 'Average session duration']) {
      assert.equal(await activity().getByText(label, { exact: true }).count(), 0, 'Unavailable session metrics must not render.');
    }
    assert.equal(await activity().locator('article').count(), 5, 'Keep all five record-based engagement metrics.');
    assert.match(await metric('Confirmed Recovery Share').innerText(), /45\.5%/);
    assert.match(await metric('Recyclable Textiles Received').innerText(), /0\.1 t/);
    assert.match(await metric('Recyclable Textiles Received').innerText(), /1 recyclable batch/);
    assert.equal(await page.getByText('Confirmed Recycling Output', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Definition', { exact: true }).count(), 0, 'KPI tiles must not render definition expanders.');
    assert.equal(await metric('Total Textiles Declared').locator('polyline').getAttribute('points').then(value => value?.trim().split(' ').length), 3, 'Declared trend must include every registration month, independent of intake evidence.');
    await metric('Total Textiles Declared').getByRole('img', { name: 'Total Textiles Declared trend from Jul 2026 to Sept 2026', exact: true }).waitFor();
    assert.equal(await metric('Total Textiles Declared').locator('details').count(), 0);
    assert.equal(await page.getByText(/All physically collected textiles/).count(), 0);
    await page.locator('canvas').first().waitFor();
    await page.waitForTimeout(150);
    const pixels = await page.locator('canvas').first().evaluate(element => {
      const canvas = element as HTMLCanvasElement, data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0; for (let i = 3; i < data.length; i += 4) if (data[i]) count++; return count;
    });
    assert.ok(pixels > 100);
    await checkWidth();
    assert.equal(await visible().locator('article p').evaluateAll(paragraphs => paragraphs.some(item => item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1)), false, 'Metric text must fit its container.');
    await page.screenshot({ path: `${output}/overview-${viewport.width}.png`, fullPage: true });
    await page.screenshot({ path: `${output}/overview-viewport-${viewport.width}.png` });
    await navigate('Material Registry');
    await metric('Total Textiles Declared').getByText('0.575 t', { exact: true }).waitFor();
    await checkWidth();
    await navigate('Reports');
    await visible().getByRole('table', { name: 'Material Flow Summary preview', exact: true }).waitFor();
    await visible().locator('dl > div').filter({ has: page.getByText('Total Textiles Declared', { exact: true }) }).getByText('0.575 t', { exact: true }).waitFor();
    await visible().locator('dl > div').filter({ has: page.getByText('Textiles Physically Received', { exact: true }) }).getByText('0.189 t', { exact: true }).waitFor();
    await checkWidth();
    await navigate('Governance & Policy');
    await metric('Textiles Physically Received').getByText('0.189 t', { exact: true }).waitFor();
    const comparison = visible().getByRole('table', { name: 'Policy period comparison', exact: true });
    await comparison.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Total Textiles Declared', exact: true }) }).getByRole('cell', { name: '0.575 t', exact: true }).waitFor();
    await checkWidth();
    await navigate('Waste Analytics');
    await metric('Total Textiles Declared').getByText('0.575 t', { exact: true }).waitFor();
    await metric('Textiles Physically Received').getByText('0.189 t', { exact: true }).waitFor();
    assert.equal(await visible().getByText('Validated collection', { exact: true }).count(), 0);
    await checkCircularity();
    assert.match(await circularity().locator('article').first().innerText(), /45\.5%/);
    await page.screenshot({ path: `${output}/waste-${viewport.width}.png`, fullPage: true });
    await navigate('Geographic Insights');
    await visible().getByText('Confirmed recycling', { exact: true }).waitFor();
    await visible().getByRole('button', { name: 'Recycled', exact: true }).click();
    await visible().getByRole('button', { name: /^Select Metro Manila, Pending evidence/ }).click();
    await visible().getByRole('complementary', { name: 'Selected region' }).getByText('Pending evidence', { exact: true }).waitFor();
    await checkWidth();
    await navigate('Stakeholders');
    assert.match(await visible().locator('article').filter({ has: page.getByText('Confirmed outcome output', { exact: true }) }).first().innerText(), /0\.086 t/);
    await checkWidth();
    await navigate('Hub Facilities');
    await visible().getByRole('heading', { name: 'Hub Facilities', exact: true }).waitFor();
    await visible().getByText('Confirmed outcome output', { exact: true }).waitFor();
    assert.ok((await visible().innerText()).includes('0.086 t'));
    await checkWidth();
    await navigate('Advanced Analytics');
    await visible().getByRole('columnheader', { name: 'Confirmed recovery share', exact: true }).waitFor();
    assert.ok(!(await visible().innerText()).includes('null%'));
    await checkWidth();
    await navigate('Overview');
    // Global filters recompute both declarations and the separate recovery denominator.
    const region = page.getByRole('combobox', { name: /^Region/ });
    await region.selectOption('Central Visayas');
    await declaredSummary().getByText('0 t', { exact: true }).waitFor();
    await metric('Total Textiles Declared').getByText('0 t', { exact: true }).waitFor();
    assert.match(await declaredSummary().innerText(), /0 t/);
    assert.match(await metric('Confirmed Recovery Share').innerText(), /Not available/);
    await region.selectOption('All regions');
    await declaredSummary().getByText('0.575 t', { exact: true }).waitFor();
    await metric('Total Textiles Declared').getByText('0.575 t', { exact: true }).waitFor();
    mode = 'missing'; await open();
    assert.match(await metric('Total Textiles Declared').innerText(), /0\.575 t/);
    assert.match(await declaredSummary().innerText(), /0\.575 t/);
    assert.equal(await metric('Total Textiles Declared').locator('polyline').count(), 1, 'Declarations retain their sparkline even without any intake records.');
    assert.match(await metric('Recyclable Textiles Received').innerText(), /Pending evidence/);
    assert.match(await metric('Confirmed Recovery Share').innerText(), /Not available/);
    await checkWidth();
    await page.screenshot({ path: `${output}/pending-${viewport.width}.png`, fullPage: true });
    await navigate('Waste Analytics');
    await checkCircularity();
    assert.equal(await circularity().getByText('Not available', { exact: true }).count(), 2, 'Missing evidence must not become zero percentages.');
    await page.screenshot({ path: `${output}/waste-pending-${viewport.width}.png`, fullPage: true });
    mode = 'conflict'; await open();
    assert.match(await metric('Total Textiles Declared').innerText(), /0\.575 t/);
    await page.getByText(/collection and .* outcome batch allocations need review/).waitFor();
    assert.match(await metric('Confirmed Recovery Share').innerText(), /Not available/);
    await checkWidth();
    await navigate('Waste Analytics');
    await checkCircularity();
    await circularity().locator('article').first().getByText('Not available', { exact: true }).waitFor();
    mode = 'synthetic'; await open();
    const dateRange = page.getByRole('combobox', { name: 'Date range', exact: true });
    assert.equal(await dateRange.inputValue(), DEFAULT_REPORTING_RANGE);
    await page.getByText('1 Aug 2026 - 19 Oct 2026', { exact: true }).waitFor();
    for (const expected of syntheticAnalytics.kpis.slice(0, 5)) {
      assert.match(await metric(expected.label).innerText(), new RegExp(expected.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      if (expected.label === 'Recorded Hub Disposal') assert.equal(expected.value, 'Not available');
      else assert.ok(!['Pending evidence', 'Not available'].includes(expected.value));
    }
    const declaredValue = syntheticAnalytics.kpis[0].value;
    assert.ok((await declaredSummary().innerText()).includes(declaredValue), 'Featured declaration total must match Material Evidence Summary.');
    assert.equal(await page.getByText('Shared Platform Activity', { exact: true }).count(), 0);
    assert.equal(await page.getByText(/synthetic demo batches and .* operational batches/).count(), 0);
    await page.getByText('Registered Accounts', { exact: true }).waitFor();
    await dateRange.selectOption('Last 90 days');
    await page.getByText('22 Jul 2026 - 19 Oct 2026', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await page.getByText('1 Aug 2026 - 19 Oct 2026', { exact: true }).waitFor();
    assert.equal(await dateRange.inputValue(), DEFAULT_REPORTING_RANGE);
    await checkWidth();
    await page.screenshot({ path: `${output}/completed-demo-${viewport.width}.png` });
    assert.deepEqual(errors, []); assert.equal(writes, 0);
    results.push({ ...viewport, pages: ['Overview', 'Material Registry', 'Reports', 'Governance & Policy', 'Waste Analytics', 'Geographic Insights', 'Stakeholders', 'Hub Facilities', 'Advanced Analytics'], states: ['validated', 'filtered', 'missing', 'conflicting', 'completed-synthetic-lifecycle'], chartPixels: pixels, writes, pageErrors: errors.length });
    await context.close();
  }
  process.stdout.write(JSON.stringify({ output, results }, null, 2) + '\n');
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
