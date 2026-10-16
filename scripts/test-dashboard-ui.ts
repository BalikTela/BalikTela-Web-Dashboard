import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, type Page } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';

const base = process.env.DASHBOARD_UI_URL ?? 'http://127.0.0.1:5174';
const output = '/tmp/baliktela-dashboard-ui';
const seed = await createSeedData();
const admin = seed.users[0];
const copy = <T extends { id: string }>(item: T, prefix: string) => Array.from({ length: 37 }, (_, index) => ({ ...structuredClone(item), id: `${prefix}-${String(index).padStart(3, '0')}` }));
seed.listings = copy(seed.listings[0], 'UI-LIST').map((item, index) => ({ ...item, batchId: `UI-BATCH-${String(index).padStart(3, '0')}`, title: `Material listing ${index} (demo)`, quantityKg: 1000, status: index % 2 ? 'Closed' : 'Open', region: index % 3 ? 'Metro Manila' : 'Central Visayas', textileType: index % 2 ? 'Denim' : 'Cotton', circularPathway: index % 2 ? 'Reuse' : 'Recycling', weightStatus: index % 3 ? 'Measured' : 'Verified' }));
seed.materialBatches = copy(seed.materialBatches[0], 'UI-BATCH').map(item => ({ ...item, declaredWeightKg: 1000, currentWeightKg: 1000 }));
seed.transfers = copy(seed.transfers[0], 'UI-TRANSFER').map((item, index) => ({ ...item, batchId: seed.materialBatches[index].id, verifiedWeightKg: 500, agreedWeightKg: 1000 }));
seed.offers = copy(seed.offers[0], 'UI-OFFER');
seed.recoveryRecords = copy(seed.recoveryRecords[0], 'UI-RECOVERY').map((item, index) => ({ ...item, batchId: seed.materialBatches[index].id, inputWeightKg: 1000, outputWeightKg: 900, stage: 'Collection' }));
seed.organizations = copy(seed.organizations[0], 'UI-ORG');
seed.facilities = copy(seed.facilities[0], 'UI-FACILITY');
seed.users = [admin, ...copy(seed.users[3], 'UI-USER')];
seed.auditRecords = copy(seed.auditRecords[0] ?? { id: 'UI-AUDIT', actorId: admin.id, action: 'Fixture update', entityType: 'Listing', entityId: 'UI-LIST', timestamp: '2026-09-21T00:00:00Z', details: 'Synthetic browser fixture.' }, 'UI-AUDIT');
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), admin, {});
analytics.regionalActivity = ['Metro Manila', 'Central Visayas', 'Western Visayas', 'Davao Region'].map((region, index) => ({
  ...analytics.regionalActivity[0], region, city: ['Makati', 'Cebu City', 'Iloilo City', 'Davao City'][index],
  collectionKg: analytics.circularFlow.collectedKg / 4, recyclingKg: analytics.circularFlow.recycledKg / 4,
  wasteGapKg: analytics.circularFlow.residualKg / 4,
}));
analytics.facilities = copy(analytics.facilities[0] ?? { id: 'F', name: 'Facility (demo)', location: 'Manila', region: 'Metro Manila', acceptedTypes: ['Cotton'], capacityKg: 1000, utilization: 50, intakeKg: 500, processedKg: 300, processingTimeDays: 2.4, status: 'Available', isDemo: true }, 'UI-FACILITY');
const issues = copy({ id: 'ISSUE', severity: 'Warning', category: 'Fixture', entityType: 'Batch', entityId: 'UI-BATCH', description: 'Synthetic integrity finding.', status: 'Open' }, 'UI-ISSUE');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const checks: string[] = [];
try {
  for (const viewport of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let savedBatch: Record<string, unknown> | undefined;
    let failMap = viewport.width === 375;
    await page.route('**/*philippines-context*', async route => {
      if (failMap && route.request().resourceType() === 'fetch') {
        return route.fulfill({ status: 503, json: { message: 'Isolated map-retry fixture.' } });
      }
      return route.continue();
    });
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      let body: unknown;
      if (path === '/auth/me') body = { user: admin, access: accessSummary(admin), storage: 'ui-fixture' };
      else if (path === '/analytics/dashboard') {
        const region = url.searchParams.get('region');
        const empty = url.searchParams.get('textileType') === 'Polyester';
        body = { ...analytics, regionalActivity: empty ? [] : !region || region === 'All regions' ? analytics.regionalActivity : analytics.regionalActivity.filter(item => item.region === region) };
      }
      else if (path === '/barter/listings') body = { listings: seed.listings };
      else if (path === '/barter/offers') body = { offers: seed.offers };
      else if (path.startsWith('/material-batches/') && route.request().method() === 'PATCH') { savedBatch = route.request().postDataJSON(); body = { batch: seed.materialBatches[0] }; }
      else if (path === '/material-batches') body = { batches: seed.materialBatches.map(item => ({ ...item, measurements: [] })) };
      else if (path === '/transfers') body = { transfers: seed.transfers };
      else if (path === '/recovery-records') body = { records: seed.recoveryRecords };
      else if (path === '/organizations') body = { organizations: seed.organizations };
      else if (path === '/facilities') body = { facilities: seed.facilities };
      else if (path === '/users') body = { users: seed.users, roles: ['Administrator', 'Producer', 'Researcher'] };
      else if (path === '/data-quality') body = { issues, thresholdPercent: 5, summary: { totalIssues: 37, critical: 0, warnings: 37, validationCoveragePercent: 50 } };
      else if (path === '/audit-records') body = { records: seed.auditRecords };
      else return route.fulfill({ status: 404, json: { message: `Unmocked ${path}` } });
      await route.fulfill({ json: body });
    });
    await page.goto(new URL('/dashboard', base).href);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const navigate = async (name: string) => {
      const toggle = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await toggle.isVisible()) await toggle.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    await navigate('Overview');
    if (viewport.width < 1280) {
      await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('img', { name: 'BalikTelaPH', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'BalikTelaPH overview', exact: true }).click();
    }
    await page.locator('canvas').first().waitFor();
    await page.waitForTimeout(200);
    const pixels = await page.locator('canvas').first().evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 3; index < data.length; index += 4) if (data[index] > 0) visible++;
      return visible;
    });
    assert.ok(pixels > 100, 'Charts must render actual content.');
    await page.screenshot({ path: `${output}/overview-${viewport.width}.png`, fullPage: true });
    await navigate('Geographic Insights');
    const geographic = page.locator('main [aria-hidden="false"]');
    if (viewport.width === 375) {
      await geographic.getByRole('button', { name: 'Retry map', exact: true }).waitFor();
      failMap = false;
      await geographic.getByRole('button', { name: 'Retry map', exact: true }).click();
    }
    await geographic.locator('.geo-country-ph').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] .geo-pin').length === 4);
    const geographyLayout = await geographic.evaluate(element => {
      const map = element.querySelector('.geo-map-canvas')!.getBoundingClientRect();
      const tiles = element.querySelector('.geo-summary')!.getBoundingClientRect();
      const performance = element.querySelector('.geo-analysis-grid')!.getBoundingClientRect();
      const markers = [...element.querySelectorAll('.geo-pin')].map(marker => {
        const frame = marker.getBoundingClientRect();
        return { x: frame.x, right: frame.right, y: frame.y, bottom: frame.bottom };
      });
      const country = (element.querySelector('.geo-country-ph') as SVGPathElement).getBBox();
      return { width: element.clientWidth, mapWidth: map.width, mapHeight: map.height, mapBottom: map.bottom, tilesTop: tiles.top, performanceTop: performance.top, markers,
        mapLeft: map.left, mapRight: map.right, mapTop: map.top, countryWidth: country.width, countryHeight: country.height };
    });
    assert.ok(Math.abs(geographyLayout.width - geographyLayout.mapWidth) <= 4, 'Geographic map must fill the section width.');
    assert.ok(geographyLayout.mapHeight >= 480, 'Geographic map must have a substantial viewport.');
    assert.ok(geographyLayout.countryWidth > 150 && geographyLayout.countryHeight > 300, 'Vector map must be nonblank and correctly framed.');
    assert.ok(geographyLayout.tilesTop >= geographyLayout.mapBottom, 'KPI tiles must be below the map.');
    assert.ok(geographyLayout.performanceTop >= geographyLayout.mapBottom, 'Regional charts must be below the map.');
    assert.equal(geographyLayout.markers.length, 4);
    for (const marker of geographyLayout.markers) assert.ok(marker.x >= geographyLayout.mapLeft && marker.right <= geographyLayout.mapRight && marker.y >= geographyLayout.mapTop && marker.bottom <= geographyLayout.mapBottom, 'Regional marker must remain inside the map.');
    const beforeZoom = await geographic.locator('.geo-country-ph').getAttribute('d');
    await geographic.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.waitForFunction(before => document.querySelector('main [aria-hidden="false"] .geo-country-ph')?.getAttribute('d') !== before, beforeZoom);
    await geographic.getByRole('button', { name: 'Fit Philippines', exact: true }).click();
    await geographic.getByRole('button', { name: /Select Davao Region,/ }).click();
    await geographic.getByRole('complementary', { name: 'Selected region' }).getByText('Davao Region', { exact: true }).waitFor();
    await geographic.getByRole('button', { name: 'Locate Western Visayas', exact: true }).click();
    await geographic.getByRole('complementary', { name: 'Selected region' }).getByText('Western Visayas', { exact: true }).waitFor();
    await geographic.getByRole('button', { name: 'Recycled', exact: true }).click();
    assert.equal(await geographic.getByRole('button', { name: 'Recycled', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await geographic.locator('.geo-pin-zero').count(), 4, 'Zero recycling activity must not appear as positive-volume bubbles.');
    await geographic.getByRole('button', { name: 'Recovery gap', exact: true }).click();
    assert.equal(await geographic.locator('.geo-map-gap').count(), 1);
    await geographic.getByRole('button', { name: 'Collected', exact: true }).click();
    await geographic.getByRole('button', { name: 'Close regional detail', exact: true }).click();
    await geographic.getByRole('button', { name: 'Fit Philippines', exact: true }).click();
    if (viewport.width >= 1366 && await geographic.getByRole('button', { name: 'Fullscreen map', exact: true }).count()) {
      await geographic.getByRole('button', { name: 'Fullscreen map', exact: true }).click();
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      await geographic.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
      await page.waitForFunction(() => !document.fullscreenElement);
    }
    await assertResponsive(page, 'Geographic Insights');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/geographic-${viewport.width}.png`, fullPage: true });
    await geographic.getByRole('button', { name: /Select Davao Region,/ }).click();
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('Central Visayas');
    await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] .geo-pin').length === 1);
    assert.equal(await geographic.getByRole('complementary', { name: 'Selected region' }).count(), 0, 'Filtering out the selected region must remove stale details.');
    await page.getByRole('combobox', { name: /^Textile type/ }).selectOption('Polyester');
    await geographic.getByText('No regional activity matches the current filters.', { exact: true }).waitFor();
    assert.equal(await geographic.locator('.geo-pin').count(), 0);
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('All regions');
    await page.getByRole('combobox', { name: /^Textile type/ }).selectOption('All textiles');
    await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] .geo-pin').length === 4);
    await navigate('Listing Oversight');
    await page.getByLabel('Listing region', { exact: true }).waitFor();
    const workspace = () => page.locator('main [aria-hidden="false"]');
    const table = () => workspace().locator('tbody');
    const pager = () => workspace().getByRole('navigation', { name: 'Listings pagination', exact: true });
    await page.waitForFunction(() => document.querySelector('main [aria-hidden="false"] tbody')?.children.length === 10);
    assert.equal(await table().locator('tr').count(), 10);
    await pager().getByRole('button', { name: 'Next page', exact: true }).click();
    await table().getByText('UI-LIST-010 · Demo', { exact: true }).waitFor();
    await pager().getByRole('button', { name: 'Last page', exact: true }).click();
    assert.equal(await table().locator('tr').count(), 7);
    await page.getByLabel('Listing status', { exact: true }).selectOption('Open');
    await pager().getByText('Page 1 of 2', { exact: true }).waitFor();
    await page.getByLabel('Listing region', { exact: true }).selectOption('Central Visayas');
    await page.getByLabel('Listing textile', { exact: true }).selectOption('Cotton');
    await page.getByLabel('Listing pathway', { exact: true }).selectOption('Recycling');
    await page.getByLabel('Listing weight evidence', { exact: true }).selectOption('Verified');
    assert.equal(await table().locator('tr').count(), 7);
    assert.ok((await table().innerText()).includes('1 t'));
    await page.getByLabel('Search listings', { exact: true }).fill('does not exist');
    await page.getByText('No material listings match these filters.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await pager().getByLabel('Listings rows per page', { exact: true }).selectOption('25');
    assert.equal(await table().locator('tr').count(), 25);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `${output}/listings-${viewport.width}.png`, fullPage: true });
    for (const name of ['Material Registry', 'Traceability', 'Recovery Monitoring', 'Facility Analytics', 'Data Quality', 'Organizations', 'User Accounts']) {
      await navigate(name);
      await workspace().getByRole('navigation').first().waitFor();
      await page.waitForFunction(() => document.querySelector('main [aria-hidden="false"] tbody')?.children.length === 10);
      assert.equal(await table().locator('tr').count(), 10, `${name}: paginated rows`);
      const navigation = workspace().getByRole('navigation').first();
      await navigation.getByRole('button', { name: 'Next page', exact: true }).click();
      await navigation.getByText('Page 2 of 4', { exact: true }).waitFor();
      await navigation.getByRole('button', { name: 'First page', exact: true }).click();
      if (name === 'Traceability') {
        await workspace().getByRole('button', { name: 'Offers', exact: true }).click();
        await table().getByText('UI-OFFER-000', { exact: true }).waitFor();
        assert.equal(await table().locator('tr').count(), 10);
      }
      if (name === 'Material Registry') {
        await workspace().getByRole('button', { name: 'Edit UI-BATCH-000', exact: true }).click();
        const dialog = page.locator('dialog[open]');
        assert.equal(await dialog.getByLabel('Declared weight (t)', { exact: true }).inputValue(), '1');
        await dialog.getByLabel('Declared weight (t)', { exact: true }).fill('1.25');
        await dialog.getByLabel('Measurement method', { exact: true }).fill('Browser fixture scale');
        await dialog.getByLabel('Registration / correction reason', { exact: true }).fill('Verify t to kg payload conversion');
        await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(savedBatch?.declaredWeightKg, 1250, 'Editing in tons must retain the canonical kg API.');
      }
      await assertResponsive(page, name);
    }
    await navigate('Audit Trail');
    await workspace().getByRole('navigation', { name: 'Audit records pagination' }).waitFor();
    assert.equal(await workspace().locator('article').count(), 10);
    await assertResponsive(page, 'Audit Trail');
    assert.deepEqual(errors, []);
    checks.push(`${viewport.width}: branding, charts, full-width geographic map and tiles below, composed listing filters, empty/reset states, pagination, weight editor conversion, long tables, responsive layout`);
    await context.close();
  }
  console.log(JSON.stringify({ result: 'passed', checks, screenshots: output, liveDatabaseWrites: 0, emailsSent: 0 }, null, 2));
} finally { await browser.close(); }

async function assertResponsive(page: Page, name: string) {
  const layout = await page.evaluate(() => ({ width: innerWidth, actual: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('main [aria-hidden="false"] h1, main [aria-hidden="false"] p, main [aria-hidden="false"] button')].filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === 'visible' && getComputedStyle(element).whiteSpace !== 'nowrap').map(element => element.textContent?.slice(0,80)) }));
  assert.ok(layout.actual <= layout.width + 1, `${name}: horizontal page overflow`);
  assert.deepEqual(layout.overflow, [], `${name}: overflowing text`);
}
