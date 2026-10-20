import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { buildReport, REPORT_DEFINITIONS, reportCsv, reportScope } from '../server/reports.js';

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-reports-ui'; await mkdir(output, { recursive: true });
const now = new Date('2026-10-17T04:00:00Z');
const seed = await createSeedData(); const actor = seed.users[0];
const regions = ['Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region'];
const materials = ['Cotton', 'Polyester', 'Denim', 'Mixed fabric', 'Uniforms', 'Household linen'];
for (const region of regions) for (const material of materials) seed.materialBatches.push({ ...seed.materialBatches[0], id: `REPORT-UI-${region}-${material}`, region, materialCategory: material, declaredWeightKg: 10, createdAt: '2026-09-20T04:00:00Z' });
seed.materialBatches.push({ ...seed.materialBatches[0], id: 'REPORT-UI-OCT', declaredWeightKg: .125, createdAt: '2026-10-17T03:00:00Z' });
const store = new MemoryStore(seed);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks: string[] = [];
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
    const page = await context.newPage(); await page.clock.setFixedTime(now);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let fail = viewport.width === 375;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const query = Object.fromEntries(url.searchParams);
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: actor, access: accessSummary(actor), storage: 'isolated-test' } });
      if (url.pathname === '/api/analytics/dashboard') return route.fulfill({ json: await buildDashboardAnalytics(store, actor, query, undefined, now) });
      if (url.pathname === '/api/reports') return route.fulfill({ json: { reports: REPORT_DEFINITIONS, scope: reportScope(actor) } });
      const match = /^\/api\/reports\/([^/]+)\/(preview|export)$/.exec(url.pathname);
      if (match) {
        if (fail && match[2] === 'preview') return route.fulfill({ status: 503, json: { message: 'Isolated report retry test.' } });
        const { format, ...filters } = query;
        try {
          const report = await buildReport(store, actor, match[1], filters, undefined, now);
          if (match[2] === 'export' && format !== 'print') return route.fulfill({ contentType: 'text/csv', body: reportCsv(report) });
          return route.fulfill({ json: report });
        } catch (error) { return route.fulfill({ status: 400, json: { message: (error as Error).message } }); }
      }
      return route.fulfill({ status: 404, json: { message: `Unexpected request ${url.pathname}` } });
    });
    await page.goto(new URL('/dashboard', base).href);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const navigate = async (name: string) => {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true }); if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    await navigate('Reports');
    if (fail) { await page.getByRole('button', { name: 'Retry report', exact: true }).waitFor(); fail = false; await page.getByRole('button', { name: 'Retry report', exact: true }).click(); }
    const active = page.locator('main [aria-hidden="false"]');
    await active.getByRole('table', { name: 'Material Flow Summary preview', exact: true }).waitFor();
    await active.getByRole('columnheader', { name: 'Total Textiles Declared (t)', exact: true }).waitFor();
    await active.getByRole('columnheader', { name: 'Textiles Physically Received (t)', exact: true }).waitFor();
    const reportTypes = active.getByRole('combobox', { name: 'Report type', exact: true });
    assert.deepEqual(await reportTypes.locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['material-flow', 'data-quality', 'organizations']);
    assert.equal(await reportTypes.getByRole('option', { name: /environmental/i }).count(), 0);
    await active.getByRole('region', { name: 'Report interpretation', exact: true }).getByText('How the percentage works', { exact: true }).waitFor();
    assert.equal(await active.getByRole('table').locator('tbody tr').count(), 10);
    await active.getByRole('button', { name: 'Last page', exact: true }).click();
    await active.getByRole('cell', { name: 'TOTAL', exact: true }).waitFor();
    const total = await active.getByRole('table').locator('tbody tr').last().innerText();
    assert.ok(total.includes('0.815125'), 'New October batch must be included in the rolling window.');
    await active.getByRole('button', { name: 'First page', exact: true }).click();
    await page.getByRole('combobox', { name: 'Date range', exact: true }).selectOption('Custom range');
    await page.getByRole('textbox', { name: 'Reporting start date', exact: true }).fill('2026-09-01');
    await page.getByRole('textbox', { name: 'Reporting end date', exact: true }).fill('2026-09-21');
    await active.getByText('1 Sept 2026 - 21 Sept 2026 / Asia/Manila', { exact: true }).waitFor();
    const dl = active.locator('dl'); assert.ok((await dl.innerText()).includes('0.815 t'));
    const downloadPromise = page.waitForEvent('download');
    await active.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const download = await downloadPromise;
    assert.equal(download.suggestedFilename(), 'baliktela-material-flow-2026-09-01-2026-09-21.csv');
    const csv = await readFile((await download.path())!, 'utf8');
    assert.ok(csv.includes('0.815')); assert.ok(!csv.includes('0.815125'));
    assert.ok(csv.indexOf('SUMMARY') < csv.indexOf('DETAILED DATA'));
    assert.ok(csv.includes('INTERPRETATION'));assert.ok(csv.includes('DEFINITIONS'));assert.ok(!csv.includes('"",""'));
    assert.ok(csv.includes('Total Textiles Declared (t)'));assert.ok(csv.includes('Textiles Physically Received (t)'));
    assert.ok(!csv.includes('Validated collection'));
    if (viewport.width === 1440) {
      const popupPromise = context.waitForEvent('page');
      await active.getByRole('button', { name: 'Print / PDF', exact: true }).click();
      const popup = await popupPromise; await popup.getByRole('heading', { name: 'Material Flow Summary', exact: true }).waitFor();
      assert.equal(await popup.title(), 'Material Flow Summary | BalikTelaPH');
      await popup.getByRole('columnheader', { name: 'Total Textiles Declared (t)', exact: true }).waitFor();
      await popup.getByRole('columnheader', { name: 'Textiles Physically Received (t)', exact: true }).waitFor();
      await popup.getByRole('region', { name: 'Report interpretation', exact: true }).getByText('Report Interpretation', { exact: true }).waitFor();
      assert.equal(await popup.locator('tbody tr').count(), 25, 'Print must include all data rows, not the ten-row preview or catalog.');
      assert.equal(await popup.locator('aside, nav').count(), 0);
      await popup.pdf({ path: `${output}/material-flow.pdf`, format: 'A4', landscape: true, printBackground: true });
      await popup.close();
    }
    for (const reportId of ['data-quality', 'organizations']) {
      await active.getByRole('combobox', { name: 'Report type', exact: true }).selectOption(reportId);
      await active.getByRole('table', { name: `${REPORT_DEFINITIONS.find(item => item.id === reportId)!.name} preview`, exact: true }).waitFor();
    }
    await active.getByRole('combobox', { name: 'Report type', exact: true }).selectOption('material-flow');
    await page.getByRole('combobox', { name: 'Region', exact: true }).selectOption('Central Visayas');
    await active.getByRole('table').waitFor();
    assert.ok(!(await active.getByRole('table').innerText()).includes('Metro Manila'));
    await page.getByRole('combobox', { name: 'Textile type', exact: true }).selectOption('Cotton');
    await active.getByRole('table').waitFor();
    assert.equal(await active.getByRole('table').locator('tbody tr').count(), 2);
    await page.getByRole('textbox', { name: 'Reporting start date', exact: true }).fill('2026-01-01');
    await page.getByRole('textbox', { name: 'Reporting end date', exact: true }).fill('2026-01-02');
    await active.getByText('1 Jan 2026 - 2 Jan 2026 / Asia/Manila', { exact: true }).waitFor();
    assert.ok((await active.getByRole('table').innerText()).includes('Not available'));
    await page.getByRole('textbox', { name: 'Reporting start date', exact: true }).fill('2026-02-01');
    await active.getByRole('button', { name: 'Retry report', exact: true }).waitFor();
    assert.equal(await active.getByRole('button', { name: 'Export CSV', exact: true }).count(), 0, 'Invalid filters must not export stale preview data.');
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await active.getByRole('table').waitFor();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/reports-${viewport.width}.png`, fullPage: true });
    const layout = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('main [aria-hidden="false"] h3, main [aria-hidden="false"] p, main [aria-hidden="false"] button')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible').map(element => element.textContent) }));
    assert.ok(layout.actual <= layout.width + 1, `Page overflow at ${viewport.width}`); assert.deepEqual(layout.overflowing, []); assert.deepEqual(errors, []);
    checks.push(`${viewport.width}: rolling/custom dates, pagination, all report types, filtered CSV, printable data, empty/invalid filters and responsiveness`);
    await context.close();
  }
  const researcher = seed.users.find(item => item.role === 'Researcher')!;
  researcher.scope.canExport = false; researcher.scope.aggregateOnly = true; researcher.scope.regions = ['Metro Manila'];
  const readOnlyContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  const readOnly = await readOnlyContext.newPage(); await readOnly.clock.setFixedTime(now);
  await readOnly.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const query = Object.fromEntries(url.searchParams);
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: researcher, access: accessSummary(researcher), storage: 'isolated-test' } });
    if (url.pathname === '/api/analytics/dashboard') return route.fulfill({ json: await buildDashboardAnalytics(store, researcher, query, undefined, now) });
    if (url.pathname === '/api/reports') return route.fulfill({ json: { reports: REPORT_DEFINITIONS, scope: reportScope(researcher) } });
    const match = /^\/api\/reports\/([^/]+)\/preview$/.exec(url.pathname);
    if (match) return route.fulfill({ json: await buildReport(store, researcher, match[1], query, undefined, now) });
    return route.fulfill({ status: 403, json: { message: 'Export not allowed for this test account.' } });
  });
  await readOnly.goto(new URL('/dashboard', base).href);
  await readOnly.getByText('Program Analytics', { exact: true }).waitFor();
  await readOnly.getByRole('button', { name: 'Reports', exact: true }).click();
  const restricted = readOnly.locator('main [aria-hidden="false"]');
  await restricted.getByRole('table').waitFor();
  assert.deepEqual(await restricted.getByRole('combobox', { name: 'Report type', exact: true }).locator('option').evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)), ['material-flow', 'data-quality', 'organizations']);
  assert.equal(await restricted.getByRole('button', { name: 'Export CSV', exact: true }).isDisabled(), true);
  assert.equal(await restricted.getByRole('button', { name: 'Print / PDF', exact: true }).isDisabled(), true);
  await restricted.getByRole('combobox', { name: 'Report type', exact: true }).selectOption('organizations');
  await restricted.getByRole('table', { name: 'Organization Participation preview', exact: true }).waitFor();
  const text = await restricted.getByRole('table').innerText();
  for (const organization of seed.organizations) assert.ok(!text.includes(organization.name));
  checks.push('Researcher: aggregate preview, organization de-identification, CSV/print restrictions');
  await readOnlyContext.close();
} finally { await browser.close(); }
console.log(JSON.stringify({ checks, screenshots: output, liveDatabaseWrites: 0 }, null, 2));
