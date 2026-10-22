import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from '../server/dashboardAnalytics.js';
import { buildHubOperations } from '../server/hubOperations.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from '../server/hubs.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';
import { HUB_SIMULATION_PREFIX as P, HUB_SIMULATION_PROFILE_NOTE } from '../shared/hubStorage.js';

// Read-only fixtures: processing evidence stays intact and no shared database is used.
const seed = await createSeedData(), store = new MemoryStore(seed);
const hub={...structuredClone(seed.users.find(user=>user.role==='Recycler')!),id:`${P}OP-UI`,
  fullName:'Retired simulation Hub',email:'ui@simulation.baliktela.invalid',authUserId:null,passwordHash:null,
  stakeholder:'BalikTela Hub',accountStatus:'Deactivated' as const,profile:{...seed.users[0].profile,recyclingPractices:HUB_SIMULATION_PROFILE_NOTE}};
const consumer=seed.users.find(user=>user.role==='Consumer')!;
const simulationBatch={...seed.materialBatches[0],id:`${P}BAT-UI`,sourceUserId:consumer.id,isDemo:true,
  declaredWeightKg:999000,currentWeightKg:998000,createdAt:'2026-10-18T01:00:00Z'};
const simulationListing={...seed.listings[0],id:`${P}LST-UI`,batchId:simulationBatch.id,ownerId:consumer.id,
  title:'Hub simulation: retired browser fixture',weighingHubId:hub.id,deliveryRoute:'via_hub' as const,isDemo:true,
  quantityKg:999000,createdAt:simulationBatch.createdAt};
seed.users.push(hub);seed.materialBatches.push(simulationBatch);seed.listings.push(simulationListing);
const source = await loadDashboardAnalyticsSnapshot(store);
source.hubDisposals={available:true,records:[{id:`${P}DSP-UI`,listingId:simulationListing.id,listingTitle:simulationListing.title,
  operatorId:hub.id,category:simulationBatch.materialCategory,weightKg:1000,reason:'Isolated browser fixture only',disposedAt:'2026-10-18T02:00:00Z'}]};
const now = new Date('2026-10-20T04:00:00Z');
const evidenceBefore = structuredClone(seed.recoveryRecords);
const app = express(); serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const output = '/tmp/baliktela-recovery-ui';
await mkdir(output, { recursive: true });
const results: unknown[] = [];
try {
  for (const width of [375, 1366, 2560]) {
    for (const role of ['Administrator', 'Government', 'Researcher'] as const) {
      const actor = seed.users.find(user => user.role === role)!;
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage(), errors: string[] = [], unmocked: string[] = [];
      let processingRequests = 0, writes = 0, failCollection = false, hubAccess = true;
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, '');
        const query = Object.fromEntries(url.searchParams);
        if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only fixture' } }); }
        if (path === '/auth/me') {
          const access = accessSummary(actor);
          if (!hubAccess) access.permissions = access.permissions.filter(permission => !['hubs.read', 'hubs.manage'].includes(permission));
          return route.fulfill({ json: { user: actor, access, storage: 'isolated' } });
        }
        if (path === '/analytics/dashboard') return route.fulfill({ json: await buildDashboardAnalytics(store, actor, query, source, now) });
        if (path === '/hub-operations') {
          if (failCollection) return route.fulfill({ status: 503, json: { message: 'Hub operations temporarily unavailable.' } });
          const cohort = selectAnalyticsCohort(source, actor, query, now);
          const operations=buildHubOperations(source,cohort.currentBatches,actor,'Fixture registration cohort',now);
          assert.ok(!operations.records.some(row=>row.batchId.startsWith(P)));
          return route.fulfill({ json: operations });
        }
        if (path === '/hubs') return route.fulfill({ json: await buildHubDirectory(store, actor, query) });
        if (path === '/hub-disposals') return route.fulfill({ json: await buildHubDisposalMonitoring(store, actor, query, now, source) });
        if (path === '/facilities') return route.fulfill({ json: { facilities: seed.facilities } });
        if (path === '/recovery-records') { processingRequests++; return route.fulfill({ json: { records: seed.recoveryRecords } }); }
        unmocked.push(path); return route.fulfill({ status: 404, json: { message: `Unmocked ${path}` } });
      });
      await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
      await page.getByText('Program Analytics', { exact: true }).waitFor();
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name: 'Recovery Monitoring', exact: true }).click();
      const active = page.locator('main [aria-hidden="false"]');
      const sections = active.getByRole('group', { name: 'Recovery sections', exact: true });
      await sections.waitFor();
      assert.equal(await sections.getByRole('button').count(), 3);
      for (const label of ['Processing Records', 'Record operation', 'Refresh recovery records'])
        assert.equal(await active.getByRole('button', { name: label, exact: true }).count(), 0);
      assert.equal(await active.getByRole('heading', { name: 'Recovery Stage Records', exact: true }).count(), 0);
      assert.equal(await active.getByRole('combobox', { name: 'Recovery stage', exact: true }).count(), 0);
      await active.getByRole('heading', { name: 'Hub Collection & Disposal', exact: true }).waitFor();
      const collection = active.getByRole('region', { name: 'Hub collection and disposal', exact: true });
      await collection.getByText(/linked listings/).waitFor();
      assert.equal(await collection.getByText('Awaiting Disposal',{exact:true}).count(),0);
      assert.equal(await collection.getByRole('columnheader',{name:'Awaiting disposal',exact:true}).count(),0);
      if(role==='Administrator'){
        await collection.getByLabel('Search Hub materials',{exact:true}).fill(P);
        await collection.getByText('No assigned or handled Hub materials match these filters.',{exact:true}).waitFor();
        await collection.getByLabel('Search Hub materials',{exact:true}).fill('');
      }
      failCollection = true;
      await collection.getByRole('button', { name: 'Refresh Hub operations', exact: true }).click();
      await collection.getByRole('alert').waitFor();
      await collection.getByText(/linked listings/).waitFor();
      failCollection = false;
      await collection.getByRole('button', { name: 'Refresh Hub operations', exact: true }).click();
      await collection.getByRole('alert').waitFor({ state: 'hidden' });
      const directory = role === 'Administrator' ? 'Hub Management' : 'Hub Directory';
      await sections.getByRole('button', { name: directory, exact: true }).click();
      await active.getByRole('heading', { name: directory, exact: true }).waitFor();
      await sections.getByRole('button', { name: 'Hub Disposals', exact: true }).click();
      await active.getByRole('heading', { name: 'Hub Disposal Monitoring', exact: true }).waitFor();
      if(role==='Administrator'){
        await active.getByLabel('Search disposal records',{exact:true}).fill(P);
        await active.getByText('No disposal records match this search.',{exact:true}).waitFor();
      }
      await sections.getByRole('button', { name: 'Hub Collection & Disposal', exact: true }).click();
      await collection.getByText(/linked listings/).waitFor();
      await page.getByRole('combobox', { name: /^Region/ }).selectOption('Metro Manila');
      await collection.getByText(/linked listings/).waitFor();
      await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
      await collection.getByText(/linked listings/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${output}/hub-only-${role}-${width}.png`, fullPage: true });
      if (role === 'Researcher' && width === 1366) {
        hubAccess = false;
        await page.reload();
        await page.getByText('Program Analytics', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Recovery Monitoring', exact: true }).count(), 0, 'Processing-read permission alone must not expose the Hub-only page.');
      }
      assert.equal(processingRequests, 0, 'No removed processing-record endpoint should be fetched.');
      assert.equal(writes, 0); assert.deepEqual(errors, []); assert.deepEqual(unmocked, []);
      assert.deepEqual(await store.all('recoveryRecords'), evidenceBefore, 'Removing the UI must preserve historical analytics evidence.');
      results.push({ width, role, sections: 3, processingRequests, writes, pageErrors: errors.length });
      await context.close();
    }
  }
  console.log(JSON.stringify({ results, screenshots: output, liveDatabaseWrites: 0 }, null, 2));
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
