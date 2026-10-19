import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium, type Page } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { buildHubDirectory, buildWeighingMonitoring } from '../server/hubs.js';
import { accessSummary } from '../server/access-control.js';
import { serveWebApp } from '../server/webApp.js';
import type { UserRecord } from '../server/types.js';

// Entirely isolated: API responses use MemoryStore fixtures, never shared Supabase.
const app = express();
serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = process.env.DASHBOARD_UI_URL ?? `http://127.0.0.1:${address.port}`;
const output = '/tmp/baliktela-hubs-ui';
await mkdir(output, { recursive: true });
const data = await createSeedData();
const admin = data.users[0];
const operator = data.users.find(item => item.role === 'Recycler')!;
const createdAt = new Date(Date.now() - 2 * 86400000).toISOString();
for (let index = 0; index < 23; index++) {
  const id = `UI-HUB-${String(index).padStart(2, '0')}`;
  data.users.push({ ...structuredClone(operator), id, role: index % 2 === 0 ? 'BalikTela Hub' : 'Recycler', fullName: `Hub operator ${String(index).padStart(2, '0')} (demo)`, email: `${id.toLowerCase()}@fixture.invalid`, organizationVerified: false, verification: 'Pending demo review' });
  data.materialBatches.push({ ...data.materialBatches[0], id: `UI-BATCH-${index}`, declaredWeightKg: null, currentWeightKg: null, weightStatus: null, createdAt, updatedAt: createdAt });
  data.listings.push({ ...data.listings[0], id: `UI-LIST-${index}`, batchId: `UI-BATCH-${index}`, title: `Unweighed cotton ${index} (demo)`, quantityKg: null, weightStatus: null, status: 'Open', weighingHubId: id, deliveryRoute: 'via_hub', reservedKg: 0, createdAt });
}
data.materialBatches.push({ ...data.materialBatches[0], id: 'UI-WEIGHED-BATCH', declaredWeightKg: 125, currentWeightKg: 125, weightStatus: 'Measured', createdAt, updatedAt: createdAt });
data.listings.push({ ...data.listings[0], id: 'UI-WEIGHED-LISTING', batchId: 'UI-WEIGHED-BATCH', title: 'Weighed cotton (demo)', quantityKg: 125, weightStatus: 'Measured', status: 'Open', weighingHubId: operator.id, deliveryRoute: 'via_hub', reservedKg: 0, createdAt });
data.measurements.push({ ...data.measurements[0], id: 'UI-HUB-MEASUREMENT', batchId: 'UI-WEIGHED-BATCH', transferId: null, stage: 'Declaration', canonicalStage: 'listing', weightKg: 125, status: 'Measured', recordedBy: operator.id, facilityId: null, timestamp: createdAt, note: 'Scale S-01, dry textiles (demo).' });
const store = new MemoryStore(data);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
let checks = 0;
async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function responsive(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, 'Tables must scroll locally, not widen the page.');
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('.overflow-x-auto').forEach(element => { element.scrollLeft = 0; });
  });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
try {
  for (const viewport of [{ width: 320, height: 740 }, { width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let actor: UserRecord = admin;
    let failHubs = viewport.width === 320;
    let lastDecision: Record<string, unknown> | undefined;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      const query = Object.fromEntries(url.searchParams);
      let body: unknown;
      if (path === '/auth/me') body = { user: actor, access: accessSummary(actor), storage: 'isolated-ui-fixture' };
      else if (path === '/analytics/dashboard') body = await buildDashboardAnalytics(store, actor, query);
      else if (path === '/hubs') {
        if (failHubs) return route.fulfill({ status: 503, json: { message: 'Fixture connection unavailable.' } });
        body = await buildHubDirectory(store, actor, query);
      } else if (path.startsWith('/hubs/') && route.request().method() === 'PATCH') {
        lastDecision = route.request().postDataJSON();
        const id = path.split('/')[2];
        const user = await store.findById('users', id);
        assert.ok(user);
        await store.update('users', id, { organizationVerified: lastDecision!.action === 'approve', scope: { ...user.scope, facilityIds: lastDecision!.facilityIds as string[] } });
        body = { message: 'Fixture approval saved.', revokedSessions: 1 };
      } else if (path === '/weighing') body = await buildWeighingMonitoring(store, actor, query);
      else if (path === '/facilities') body = { facilities: data.facilities };
      else if (path === '/transfers') body = { transfers: [] };
      else if (path === '/material-batches') body = { batches: data.materialBatches.map(item => ({ ...item, measurements: [] })) };
      else return route.fulfill({ status: 404, json: { message: `Unmocked Hub fixture endpoint ${path}` } });
      return route.fulfill({ json: body });
    });
    await page.goto(`${base}/dashboard`);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: /^Date range/ }).selectOption('All time');
    await navigate(page, 'Facility Analytics');
    await page.getByRole('button', { name: 'Hub Management', exact: true }).click();
    if (failHubs) {
      await page.getByRole('alert').getByText('Fixture connection unavailable.').waitFor();
      failHubs = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    const active = page.locator('main [aria-hidden="false"]');
    const pager = active.getByRole('navigation', { name: 'Hub operators pagination' });
    await pager.waitFor();
    assert.equal(await active.locator('tbody tr').count(), 10);
    await pager.getByRole('button', { name: 'Next page', exact: true }).click();
    await pager.getByText('Page 2 of 3', { exact: true }).waitFor();
    await page.getByLabel('Search Hub operators').fill('Hub operator 00');
    await active.getByText('Hub operator 00 (demo)', { exact: true }).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 1);
    await responsive(page);
    await page.getByRole('button', { name: 'Manage Hub Hub operator 00 (demo)', exact: true }).click();
    const editor = page.getByRole('dialog');
    await editor.getByLabel('Access decision').selectOption('approve');
    await editor.getByLabel('Administrative reason').fill('Isolated approval browser fixture.');
    await responsive(page);
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await editor.waitFor({ state: 'hidden' });
    assert.equal(lastDecision?.action, 'approve');
    await active.locator('tbody').getByText('Approved', { exact: true }).waitFor();
    await page.getByLabel('Search Hub operators').fill('');
    await page.getByLabel('Hub approval filter').selectOption('Pending approval');
    assert.ok((await active.locator('tbody').innerText()).includes('Pending approval'));
    await screenshot(page, `hubs-${viewport.width}`);
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('Davao Region');
    await active.getByText('No Hub operators match these filters.', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('All regions');
    await pager.waitFor();
    await navigate(page, 'Traceability');
    await page.getByRole('button', { name: 'Weighing Monitoring', exact: true }).click();
    const taskPager = active.getByRole('navigation', { name: 'Weighing tasks pagination' });
    await taskPager.waitFor();
    assert.equal(await active.locator('tbody tr').count(), 10);
    assert.match(await active.locator('tbody').innerText(), /Awaiting weighing/);
    await taskPager.getByRole('button', { name: 'Next page', exact: true }).click();
    await taskPager.getByText('Page 2 of 3', { exact: true }).waitFor();
    await page.getByLabel('Search weighing records').fill('Unweighed cotton 0');
    assert.equal(await active.locator('tbody tr').count(), 1);
    await responsive(page);
    await screenshot(page, `queue-${viewport.width}`);
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('Davao Region');
    await active.getByText('No textiles match this weighing queue.', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('All regions');
    await active.getByText('Unweighed cotton 0 (demo)', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Measurement history', exact: true }).click();
    await page.getByLabel('Search weighing records').fill('');
    await active.getByText('UI-HUB-MEASUREMENT', { exact: true }).waitFor();
    await active.getByText('Scale S-01, dry textiles (demo).', { exact: true }).waitFor();
    await active.getByText('No completed transfer', { exact: true }).waitFor();
    await active.getByText('Not recorded', { exact: true }).waitFor();
    await responsive(page);
    await screenshot(page, `history-${viewport.width}`);
    // A reload establishes a separate account; no stale admin component may survive.
    for (const role of ['Researcher', 'Government'] as const) {
      actor = { ...admin, id: `UI-${role}`, role, scope: { ...admin.scope, aggregateOnly: role === 'Government' } };
      await page.reload();
      await page.getByText('Program Analytics', { exact: true }).waitFor();
      await navigate(page, 'Facility Analytics');
      await page.getByRole('button', { name: 'Hub Directory', exact: true }).click();
      await active.getByText('Hub operators', { exact: true }).waitFor();
      assert.equal(await active.getByRole('button', { name: /^Manage Hub/ }).count(), 0);
      if (role === 'Government') {
        await active.getByText('Aggregate regional access · operator identities and assignments withheld', { exact: true }).waitFor();
        assert.equal(await active.getByText('Hub operator 00 (demo)', { exact: true }).count(), 0);
      }
      await navigate(page, 'Traceability');
      await page.getByRole('button', { name: 'Weighing Monitoring', exact: true }).click();
      if (role === 'Government') {
        await active.getByText('Aggregate access · material and operator identities withheld', { exact: true }).waitFor();
        assert.equal(await active.getByText('UI-HUB-MEASUREMENT', { exact: true }).count(), 0);
      }
      await responsive(page);
    }
    assert.deepEqual(errors, []);
    checks++;
    console.log(`Hub UI: approval, queue/history, pagination, privacy, responsive ${viewport.width}px passed.`);
    await context.close();
  }
  console.log(`${checks} viewport checks passed. Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
