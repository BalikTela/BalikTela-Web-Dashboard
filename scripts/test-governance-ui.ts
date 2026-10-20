import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildGovernanceDashboard } from '../server/governance.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from '../server/dashboardAnalytics.js';
import { buildDataQuality } from '../server/dataQuality.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';
import { formatMass } from '../shared/metrics.js';

// Every response is an isolated fixture. No live sign-ins, Supabase writes or emails.
const seed = await createSeedData(), now = new Date('2026-10-19T04:00:00Z');
const producer = seed.users.find(user => user.role === 'Producer')!;
for (let index = 0; index < 14; index++) {
  const region = index % 2 ? 'Central Visayas' : 'Metro Manila', organizationId = `POLICY-ORG-${index}`;
  const user = { ...producer, id: `POLICY-SOURCE-${index}`, email: `source-${index}@policy.invalid`, fullName: `Policy Source ${index}`, organization: `Policy Producer ${String(index).padStart(2, '0')}`, organizationId, region };
  seed.users.push(user);
  seed.organizations.push({ ...seed.organizations.find(item => item.id === producer.organizationId)!, id: organizationId, name: user.organization, region });
  const batch = { ...seed.materialBatches[0], id: `POLICY-BATCH-${index}`, sourceUserId: user.id, sourceOrganizationId: organizationId, region, declaredWeightKg: 100, createdAt: '2026-08-05T01:00:00Z' };
  seed.materialBatches.push(batch);
  seed.recoveryRecords.push({ ...seed.recoveryRecords[0], id: `POLICY-INTAKE-${index}`, batchId: batch.id, stage: 'Collection', inputWeightKg: 100, outputWeightKg: 90,
    residualWeightKg: 10, lossWeightKg: 0, status: 'Validated', validatedBy: seed.users[0].id, timestamp: '2026-08-05T03:00:00Z', outcome: null });
}
const store = new MemoryStore(seed), app = express(); serveWebApp(app);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const output = '/tmp/baliktela-governance-ui'; await mkdir(output, { recursive: true });
const results: unknown[] = [];
try {
  for (const [width, role] of [[375, 'Administrator'], [768, 'Administrator'], [1440, 'Administrator'], [2560, 'Administrator'], [1440, 'Government'], [375, 'Researcher']] as const) {
    const actor = structuredClone(seed.users.find(user => user.role === role)!);
    if (role === 'Researcher') actor.scope.canExport = false;
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let writes = 0, reads = 0, fail = false;
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), query = Object.fromEntries(url.searchParams);
      if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only fixtures' } }); }
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: { user: actor, access: accessSummary(actor), storage: 'isolated' } });
      if (url.pathname === '/api/analytics/dashboard') return route.fulfill({ json: await buildDashboardAnalytics(store, actor, query, undefined, now) });
      if (url.pathname === '/api/governance') {
        reads++;
        if (fail) return route.fulfill({ status: 503, json: { message: 'Fixture temporarily unavailable' } });
        return route.fulfill({ json: await buildGovernanceDashboard(store, actor, query, undefined, now) });
      }
      if (url.pathname === '/api/data-quality') {
        const snapshot = await loadDashboardAnalyticsSnapshot(store), cohort = selectAnalyticsCohort(snapshot, actor, query, now);
        return route.fulfill({ json: buildDataQuality(actor, cohort.currentBatches, cohort.currentTransfers, 5, now, snapshot) });
      }
      return route.fulfill({ status: 404, json: { message: `Missing isolated fixture ${url.pathname}` } });
    });
    const visible = () => page.locator('main [aria-hidden="false"]').first();
    const navigate = async (name: string) => {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true }); if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    const fits = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Horizontal page overflow: ${width}/${role}`);
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    await navigate('Governance & Policy');
    await visible().getByRole('heading', { name: 'Policy monitoring', exact: true }).waitFor();
    const expected = (await buildGovernanceDashboard(store, actor, {}, undefined, now)).monitoring;
    assert.match(await visible().locator('article').filter({ has: page.getByText('Textiles Physically Received', { exact: true }) }).innerText(), new RegExp(formatMass(expected.summary.collectedKg)));
    await visible().getByText('Landfill diversion', { exact: true }).waitFor();
    await visible().getByText('Not established', { exact: true }).waitFor();
    await fits(); await page.screenshot({ path: `${output}/${role}-summary-${width}.png`, fullPage: true });
    await visible().getByRole('tab', { name: 'Policy Summary', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await visible().getByRole('table', { name: 'Regional policy performance' }).waitFor();
    assert.equal(await visible().getByRole('tab', { name: 'Regional Performance' }).getAttribute('aria-selected'), 'true');
    await fits(); await page.screenshot({ path: `${output}/${role}-regions-${width}.png`, fullPage: true });
    await visible().getByRole('tab', { name: 'Producer Evidence', exact: true }).click();
    await visible().getByRole('table', { name: 'Producer policy evidence' }).waitFor();
    if (role === 'Administrator') {
      assert.equal(await visible().getByRole('table', { name: 'Producer policy evidence' }).locator('tbody tr').count(), 10);
      const nav = visible().getByRole('navigation', { name: 'Producer evidence pagination' });
      await nav.getByRole('button', { name: 'Next page', exact: true }).click();
      assert.match(await nav.innerText(), /Page 2 of 2/);
      await visible().getByRole('textbox', { name: 'Search producer evidence' }).fill('Policy Producer 00');
      assert.equal(await visible().getByRole('table', { name: 'Producer policy evidence' }).locator('tbody tr').count(), 1);
      await visible().getByRole('textbox', { name: 'Search producer evidence' }).fill('');
    } else {
      assert.ok(!(await visible().innerText()).includes('Policy Producer'));
      await visible().getByText('Producer identities are withheld.', { exact: false }).waitFor();
    }
    await fits(); await page.screenshot({ path: `${output}/${role}-producers-${width}.png`, fullPage: true });
    await visible().getByRole('tab', { name: 'Accountability & Methodology', exact: true }).click();
    await visible().getByText('PoC reporting scope', { exact: true }).waitFor();
    await visible().getByText('Original source classifications remain', { exact: false }).waitFor();
    if (role === 'Government') {
      for (const label of ['Material registry', 'Recovery monitoring', 'Data quality', 'Traceability']) assert.equal(await visible().getByRole('button', { name: label, exact: true }).count(), 0);
    }
    if (role === 'Researcher') await visible().getByText('Not assigned', { exact: true }).waitFor();
    await fits(); await page.screenshot({ path: `${output}/${role}-accountability-${width}.png`, fullPage: true });
    await visible().getByRole('tab', { name: 'Policy Summary', exact: true }).click();
    const priorReads = reads;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('baliktela:records-changed', { detail: '/imports/commit' })));
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/governance');
    assert.ok(reads > priorReads);
    await page.getByRole('combobox', { name: /^Textile type/ }).selectOption('Polyester');
    await visible().locator('article').filter({ has: page.getByText('Textiles Physically Received', { exact: true }) }).getByText('Pending evidence', { exact: true }).waitFor();
    await visible().getByRole('tab', { name: 'Producer Evidence', exact: true }).click();
    await visible().getByText('No producer source groups match these filters and search.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await visible().getByRole('table', { name: 'Producer policy evidence' }).waitFor();
    fail = true;
    await visible().getByRole('button', { name: 'Refresh policy evidence', exact: true }).click();
    await visible().getByRole('alert').getByText('Refresh failed:', { exact: false }).waitFor();
    fail = false;
    await visible().getByRole('button', { name: 'Refresh policy evidence', exact: true }).click();
    await page.waitForResponse(response => new URL(response.url()).pathname === '/api/governance' && response.status() === 200);
    await visible().getByRole('alert').waitFor({ state: 'detached' });
    if (role === 'Administrator') {
      await visible().getByRole('tab', { name: 'Accountability & Methodology', exact: true }).click();
      await visible().getByRole('button', { name: 'Data quality', exact: true }).click();
      await visible().getByText('Checks and Source Records', { exact: true }).waitFor();
    }
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    results.push({ width, role, reads, writes, errors: errors.length });
    await context.close();
  }
  console.log(JSON.stringify({ results, screenshots: output, liveDatabaseWrites: 0 }, null, 2));
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
