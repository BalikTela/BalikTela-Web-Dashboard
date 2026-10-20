import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium, type Page } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from '../server/dashboardAnalytics.js';
import { buildHubOperations } from '../server/hubOperations.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from '../server/hubs.js';
import { accessSummary } from '../server/access-control.js';
import { serveWebApp } from '../server/webApp.js';
import type { UserRecord } from '../server/types.js';

// All records and browser responses are local fixtures. No mobile or Supabase writes.
const data = await createSeedData(), admin = data.users[0];
const consumer = data.users.find(item => item.role === 'Consumer')!;
const createdAt = new Date(Date.now() - 86400000).toISOString();
const hub: UserRecord = { ...structuredClone(data.users.find(item => item.role === 'Recycler')!), id: 'UI-POLICY-HUB',
  fullName: 'Hub collection operator', role: 'BalikTela Hub', organizationVerified: true, webHubOperator: true };
const legacy = { ...hub, id: 'UI-LEGACY-HUB', role: 'Recycler' as const, fullName: 'Legacy Hub operator' };
data.users.push(hub, legacy);
for (const operator of [hub, legacy]) {
  for (let index = 0; index < 12; index++) {
    const batchId = `${operator.id}-BATCH-${index}`;
    data.materialBatches.push({ ...data.materialBatches[0], id: batchId, sourceUserId: consumer.id, declaredWeightKg: 100, createdAt, updatedAt: createdAt });
    data.listings.push({ ...data.listings[0], id: `${batchId}-LIST`, batchId, ownerId: consumer.id, weighingHubId: operator.id,
      deliveryRoute: 'via_hub', title: `${operator.fullName} textile ${index}`, createdAt, status: 'Open', availableWeightKg: 100 });
  }
}
const store = new MemoryStore(data), source = await loadDashboardAnalyticsSnapshot(store);
source.hubDisposals = { available: true, records: [hub,legacy].map(operator => ({ id: `${operator.id}-DISPOSAL`,
  listingId: `${operator.id}-BATCH-0-LIST`, operatorId: operator.id, listingTitle: `${operator.fullName} textile 0`, category: 'Cotton',
  weightKg: 20, reason: 'Fixture disposal', disposedAt: new Date(Date.parse(createdAt)+120000).toISOString() })) };
const app = express(); serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`, output = '/tmp/baliktela-hub-policy-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
async function navigate(page: Page, name: string) {
  const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name, exact: true }).click();
}
try {
  for (const width of [375, 1440, 2560]) {
    for (const actor of [hub, legacy, admin]) {
      const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors: string[] = [], unmocked: string[] = [];
      let intakeComplete = false;
      const monitoredSource = () => ({ ...source, measurements: [...source.measurements, ...(intakeComplete ? [hub,legacy].flatMap(operator =>
        Array.from({length:12},(_,index) => ({ ...data.measurements[0], id: `${operator.id}-INTAKE-${index}`, batchId: `${operator.id}-BATCH-${index}`,
          transferId: null, canonicalStage: 'collection' as const, stage: 'Receipt' as const, recordedBy: operator.id, weightKg: 100,
          status: 'Measured' as const, supersedesMeasurementId: null, timestamp: new Date(Date.parse(createdAt)+60000).toISOString() }))) : [])] });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, ''), query = Object.fromEntries(url.searchParams);
        let body: unknown;
        if (path === '/auth/me') body = { user: actor, access: accessSummary(actor), storage: 'isolated-ui-fixture' };
        else if (path === '/analytics/dashboard') body = await buildDashboardAnalytics(store, actor, query, monitoredSource());
        else if (path === '/hub-operations') {
          const batches = source.allBatches.filter(batch => actor === admin || source.listings.some(listing => listing.batchId === batch.id && listing.weighingHubId === actor.id));
          body = buildHubOperations(monitoredSource(), batches, actor, 'Fixture registration cohort');
        } else if (path === '/hubs') body = await buildHubDirectory(store, actor, query);
        else if (path === '/hub-disposals') body = await buildHubDisposalMonitoring(store, actor, query, new Date(), monitoredSource());
        else if (path === '/facilities') body = { facilities: data.facilities };
        else if (path === '/transfers') body = { transfers: [] };
        else if (path === '/recovery-records') body = { records: [] };
        else { unmocked.push(path); return route.fulfill({ status: 404, json: { message: `Unmocked ${path}` } }); }
        return route.fulfill({ json: body });
      });
      await page.goto(`${base}/dashboard`);
      if (actor === admin) {
        await page.getByText('Program Analytics', { exact: true }).waitFor();
        await navigate(page, 'Recovery Monitoring');
      }
      const section = page.getByRole('region', { name: 'Hub collection and disposal', exact: true });
      await section.getByRole('table', { name: 'Hub material handling' }).waitFor();
      assert.equal(await section.getByText('Awaiting Disposal',{exact:true}).count(),0);
      assert.equal(await section.getByRole('columnheader',{name:'Awaiting disposal',exact:true}).count(),0);
      if (actor !== admin) {
        assert.equal(await page.getByRole('button', { name: 'Governance & Policy', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Advanced Analytics', exact: true }).count(), 0);
        assert.equal(await section.locator('tbody tr').count(), 10);
        await section.getByRole('button', { name: 'Next page', exact: true }).click();
        await section.getByText('Page 2 of 2', { exact: true }).waitFor();
        await section.getByRole('textbox', { name: 'Search Hub materials' }).fill(`${actor.fullName} textile 0`);
        assert.equal(await section.locator('tbody tr').count(), 1);
        assert.ok(!(await section.innerText()).includes(actor === hub ? legacy.fullName : hub.fullName));
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${actor.id}-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await navigate(page, 'Traceability');
      const activeTraceability = page.locator('main [aria-hidden="false"]');
      await activeTraceability.getByRole('heading',{name:'Transactions and Traceability',exact:true}).waitFor();
      for(const label of ['Hub Collection & Disposal','Hub Management','Hub Directory','Hub Disposals'])
        assert.equal(await activeTraceability.getByRole('button',{name:label,exact:true}).count(),0);
      if (actor !== admin) assert.equal(await page.getByRole('button', { name: 'Historical Listing Weights', exact: true }).count(), 0);
      await navigate(page, 'Recovery Monitoring');
      await section.getByRole('table', { name: 'Hub material handling' }).waitFor();
      assert.equal(await page.locator('main [aria-hidden="false"]').getByText('Diverted from landfill', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('group', { name: 'Recovery sections', exact: true }).getByRole('button').count(), 3);
      for (const label of ['Processing Records', 'Record operation'])
        assert.equal(await page.locator('main [aria-hidden="false"]').getByRole('button', { name: label, exact: true }).count(), 0);
      assert.equal(await page.getByRole('heading', { name: 'Recovery Stage Records', exact: true }).count(), 0);
      if (actor !== admin) {
        assert.equal(await page.getByRole('button', { name: 'Record recovery', exact: true }).count(), 0);
        assert.equal(await page.getByText('Recovery stage records', { exact: true }).count(), 0);
        const metric = (name: string) => section.locator('article').filter({has:page.getByText(name,{exact:true})});
        await metric('Textiles Sent to Hubs').getByText('1.2 t',{exact:true}).waitFor();
        intakeComplete = true;
        await section.getByRole('button',{name:'Refresh Hub operations',exact:true}).click();
        await metric('Textiles Sent to Hubs').getByText('1.2 t',{exact:true}).waitFor();
        await metric('Recorded Hub Disposal').getByText('0.02 t',{exact:true}).waitFor();
        const active = page.locator('main [aria-hidden="false"]');
        await active.getByRole('button',{name:'Hub Disposals',exact:true}).click();
        await active.getByRole('table',{name:'Hub disposal ledger'}).waitFor();
        assert.equal(await active.getByText('Awaiting Disposal',{exact:true}).count(),0);
        assert.equal(await active.getByText('Textiles Sent to Hubs',{exact:true}).count(),0,'The disposal ledger must not repeat the submissions summary.');
        assert.equal(await active.getByText('Diverted from landfill',{exact:true}).count(),0);
        await page.evaluate(()=>scrollTo(0,0));
        await page.screenshot({path:`${output}/${actor.id}-ledger-${width}.png`,fullPage:true});
      }
      await navigate(page, 'Recovery Monitoring');
      const activeRecovery = page.locator('main [aria-hidden="false"]');
      await activeRecovery.getByRole('button',{name:actor===admin?'Hub Management':'Hub Directory',exact:true}).click();
      await activeRecovery.getByRole('heading',{name:actor===admin?'Hub Management':'Hub Directory',exact:true}).waitFor();
      if(actor!==admin)assert.equal(await activeRecovery.getByRole('button',{name:/^Manage Hub /}).count(),0);
      await page.screenshot({path:`${output}/${actor.id}-directory-${width}.png`,fullPage:true});
      await navigate(page, 'Hub Facilities');
      const activeFacility = page.locator('main [aria-hidden="false"]');
      await activeFacility.getByRole('heading',{name:'Hub Facilities',exact:true}).waitFor();
      for(const label of ['Hub Collection & Disposal','Hub Management','Hub Directory','Hub Disposals'])
        assert.equal(await activeFacility.getByRole('button',{name:label,exact:true}).count(),0);
      await navigate(page,'Overview');
      await page.locator('main [aria-hidden="false"]').getByText(actor===admin?'Program Analytics':'Organization Material Evidence',{exact:true}).waitFor();
      assert.equal(await page.locator('main [aria-hidden="false"]').getByRole('region',{name:'Hub collection and disposal',exact:true}).count(),0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []); assert.deepEqual(unmocked, []);
      await context.close();
      console.log(`Hub policy UI passed: ${actor.role}${actor === legacy ? ' (legacy Hub)' : ''}, ${width}px.`);
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
