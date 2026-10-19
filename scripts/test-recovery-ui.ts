import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { accessSummary } from '../server/access-control.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { serveWebApp } from '../server/webApp.js';

// Deliberate failure fixtures only. Never connect this browser test to shared mutations.
const seed = await createSeedData();
const record = { ...seed.recoveryRecords[0], id: 'RECOVERY-LOAD-TEST', facilityId: seed.facilities[0].id,
  inputWeightKg: 100, outputWeightKg: 80, residualWeightKg: 15, lossWeightKg: 5 };
const analytics = await buildDashboardAnalytics(new MemoryStore(seed), seed.users[0], {});
const app = express(); serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
await mkdir('/tmp/baliktela-recovery-ui', { recursive: true });
try {
  for (const width of [375, 1366, 2560]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let recoveryFails = false; let invalidRecovery = false; let facilityFails = false; let transferFails = true; let readOnly = false;
    let releaseFacility: () => void = () => {};
    const facilityGate = width === 375 ? new Promise<void>(resolve => { releaseFacility = resolve; }) : Promise.resolve();
    let slowRegion = false; let latestRegion = '';
    let transferRequests = 0; let facilityRequests = 0; let writes = 0;
    await page.route('**/api/**', async route => {
      const request = route.request(); const url = new URL(request.url()); const path = url.pathname.replace(/^\/api/, '');
      if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only fixture' } }); }
      if (path === '/auth/me') {
        const access = accessSummary(seed.users[0]);
        if (readOnly) access.permissions = access.permissions.filter(permission => !['facilities.read','transfers.read','recovery.create','recovery.manage'].includes(permission));
        return route.fulfill({ json: { user: seed.users[0], access, storage: 'isolated' } });
      }
      if (path === '/analytics/dashboard') return route.fulfill({ json: analytics });
      if (path === '/hub-disposals') return route.fulfill({json:{available:true,aggregateOnly:false,records:[],landfillAvoidedKg:null,summary:{records:0,disposedKg:0,listings:0,missingLinks:0,invalidRecords:0}}});
      if (path === '/recovery-records') {
        const region = url.searchParams.get('region') ?? '';
        if (slowRegion && region === 'Metro Manila') await new Promise(resolve => setTimeout(resolve, 600));
        if (recoveryFails) return route.fulfill({ status: 503, json: { message: 'Recovery service temporarily unavailable.' } });
        if (invalidRecovery) return route.fulfill({ json: {} });
        return route.fulfill({ json: { records: [{ ...record, id: region === latestRegion && latestRegion ? 'LATEST-REGION-RECORD' : record.id }] } });
      }
      if (path === '/facilities') {
        facilityRequests++;
        await facilityGate;
        return route.fulfill(facilityFails
          ? { status: 503, json: { message: 'Facility lookup temporarily unavailable.' } }
          : { json: { facilities: seed.facilities } });
      }
      if (path === '/transfers') {
        transferRequests++;
        return route.fulfill(transferFails ? { status: 503, json: { message: 'Transfer lookup temporarily unavailable.' } }
          : { json: { transfers: seed.transfers } });
      }
      return route.fulfill({ status: 404, json: { message: `Unmocked ${path}` } });
    });
    const openRecovery = async () => {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name: 'Recovery Monitoring', exact: true }).click();
      await page.locator('main [aria-hidden="false"]').getByRole('heading', { name: 'Collection and Recovery Operations', exact: true }).waitFor();
    };
    const active = page.locator('main [aria-hidden="false"]');
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    await openRecovery();
    await page.waitForFunction(() => Boolean(document.querySelector('main [aria-hidden="false"] tbody tr, main [aria-hidden="false"] [role="alert"]')), undefined, { timeout: 8000 });
    assert.equal(await active.locator('tbody tr').count(), 1, 'A transfer-form lookup must not prevent the initial recovery table from loading.');
    assert.equal(transferRequests, 0, 'Transfer options should load only when recording a new operation.');
    releaseFacility();
    assert.match(await active.innerText(), /0\.1 t/);

    await active.getByRole('button', { name: 'Record operation', exact: true }).click();
    await active.getByRole('alert').getByText(/Transfer lookup temporarily unavailable/).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 1, 'A form-options failure must preserve monitoring.');
    transferFails = false;
    await active.getByRole('button', { name: 'Record operation', exact: true }).click();
    await page.getByRole('dialog').getByRole('heading', { name: 'Record operational event' }).waitFor();
    assert.ok(await page.getByRole('dialog').getByLabel('Transfer', { exact: true }).locator('option').count());
    await page.getByRole('button', { name: 'Close editor', exact: true }).click();

    recoveryFails = true;
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('Metro Manila');
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 0, 'Old filter results must not masquerade as the failed new scope.');
    recoveryFails = false;
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).click();
    await active.locator('tbody').getByText(record.id, { exact: true }).waitFor();

    facilityFails = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('baliktela:records-changed', { detail: '/facilities' })));
    await active.getByText('Facility names could not be refreshed. Recorded facility IDs are shown where needed.', { exact: true }).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 1);
    facilityFails = false;
    await active.getByRole('button', { name: 'Retry facility lookup', exact: true }).click();
    await active.getByRole('button', { name: 'Retry facility lookup', exact: true }).waitFor({ state: 'hidden' });

    recoveryFails = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('baliktela:records-changed', { detail: '/recovery-records' })));
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 1, 'Background failures must preserve the last successful table.');
    recoveryFails = false;
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).click();
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).waitFor({ state: 'hidden' });

    invalidRecovery = true;
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('baliktela:records-changed', { detail: '/recovery-records' })));
    await active.getByText(/Recovery records could not be read/).waitFor();
    assert.equal(await active.locator('tbody tr').count(), 1, 'Malformed responses must not crash the page or clear existing records.');
    invalidRecovery = false;
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).click();
    await active.getByRole('button', { name: 'Retry recovery records', exact: true }).waitFor({ state: 'hidden' });

    slowRegion = true; latestRegion = 'Central Visayas';
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('All regions');
    await page.getByRole('combobox', { name: /^Region/ }).selectOption('Metro Manila');
    await page.getByRole('combobox', { name: /^Region/ }).selectOption(latestRegion);
    await active.locator('tbody').getByText('LATEST-REGION-RECORD', { exact: true }).waitFor();
    await page.waitForTimeout(800);
    assert.equal(await active.locator('tbody').getByText(record.id, { exact: true }).count(), 0, 'Late responses must not overwrite newer filter results.');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/baliktela-recovery-ui/recovery-${width}.png`, fullPage: true });
    if (width === 1366) {
      readOnly = true;
      const before = { facilities: facilityRequests, transfers: transferRequests };
      await page.reload();
      await page.getByText('Program Analytics', { exact: true }).waitFor();
      await openRecovery();
      await active.locator('tbody').getByText(record.id, { exact: true }).waitFor();
      assert.equal(await active.getByRole('button', { name: 'Record operation', exact: true }).count(), 0);
      assert.deepEqual({ facilities: facilityRequests, transfers: transferRequests }, before, 'Read-only monitoring must not request unauthorized form dependencies.');
    }
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    await context.close();
    console.log(`Recovery first load, lazy form options, retry, refresh resilience, filter race and ${width}px responsive checks passed.`);
  }
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
