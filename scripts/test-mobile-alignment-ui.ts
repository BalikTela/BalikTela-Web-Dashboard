import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { accessSummary } from '../server/access-control.js';
import { serveWebApp } from '../server/webApp.js';

// Browser acceptance uses only in-memory fixtures. No Supabase credentials or writes.
const app = express();
serveWebApp(app);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
await mkdir('/tmp/baliktela-mobile-alignment-ui', { recursive: true });
try {
  for (const width of [375, 1366, 2560]) {
    const data = await createSeedData();
    const createdAt = new Date(Date.now() - 86400000).toISOString();
    const listing = { ...data.listings[0], id: 'NATIVE-LISTING', title: 'Mobile textile fixture', status: 'Draft' as const,
      canonicalStatus: 'draft', quantityKg: 100, availableWeightKg: 60, reservedKg: 20, isDemo: false, createdAt };
    const transfer = { ...data.transfers[0], id: 'NATIVE-TRANSFER', listingId: listing.id, status: 'Processing' as const,
      canonicalStatus: 'processing', verifiedWeightKg: null, createdAt, updatedAt: createdAt, events: [{ ...data.transfers[0].events[0],
        id: 'NATIVE-EVENT', type: 'Processing' as const, canonicalStage: 'processing', weightKg: 9, weightStatus: 'Measured' as const,
        note: 'Mobile processing evidence', timestamp: createdAt }] };
    const offer = { ...data.offers[0], id: 'NATIVE-OFFER', listingId: listing.id, status: 'Revised' as const, canonicalStatus: 'revised' };
    data.listings = [listing]; data.transfers = [transfer]; data.offers = [offer];
    const store = new MemoryStore(data);
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.clock.install();
    const requests: Record<string, number> = {};
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    let writes = 0;
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      requests[path] = (requests[path] ?? 0) + 1;
      if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only fixture.' } }); }
      const query = Object.fromEntries(url.searchParams);
      if (path === '/auth/me') return route.fulfill({ json: { user: data.users[0], access: accessSummary(data.users[0]), storage: 'isolated' } });
      if (path === '/analytics/dashboard') return route.fulfill({ json: await buildDashboardAnalytics(store, data.users[0], query) });
      if (path === '/barter/listings') return route.fulfill({ json: { listings: data.listings } });
      if (path === '/transfers') return route.fulfill({ json: { transfers: data.transfers } });
      if (path === '/barter/offers') return route.fulfill({ json: { offers: data.offers } });
      return route.fulfill({ status: 404, json: { message: `Missing fixture: ${path}` } });
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.clock.runFor(300);
    await page.getByText('Program Analytics', { exact: true }).waitFor();
    const navigate = async (name: string) => {
      const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
      if (await menu.isVisible()) await menu.click();
      await page.getByRole('button', { name, exact: true }).click();
    };
    const active = page.locator('main [aria-hidden="false"]');
    await navigate('Listing Oversight');
    await active.locator('tbody').getByText('Draft', { exact: true }).waitFor();
    assert.match(await active.innerText(), /0\.04 t available/);
    assert.match(await active.innerText(), /0\.02 t reserved/);
    await store.update('listings', listing.id, { status: 'Archived', canonicalStatus: 'archived' });
    await page.clock.fastForward(31_000);
    await active.locator('tbody').getByText('Archived', { exact: true }).waitFor();
    await navigate('Traceability');
    await active.getByText('Processing', { exact: true }).waitFor();
    const listingRequests = requests['/barter/listings'];
    await active.getByRole('button', { name: 'View NATIVE-TRANSFER', exact: true }).click();
    await page.getByRole('dialog').getByText('Mobile processing evidence', { exact: true }).waitFor();
    await store.update('transfers', transfer.id, { events: [{ ...transfer.events[0], note: 'Updated mobile receipt evidence' }] });
    await page.clock.fastForward(31_000);
    await page.getByRole('dialog').getByText('Updated mobile receipt evidence', { exact: true }).waitFor();
    assert.equal(requests['/barter/listings'], listingRequests, 'Hidden visited pages must not poll.');
    await page.getByRole('button', { name: 'Close transfer detail' }).click();
    await active.getByRole('button', { name: 'Offers', exact: true }).click();
    await active.getByText('Revised', { exact: true }).waitFor();
    await store.update('offers', offer.id, { status: 'Expired', canonicalStatus: 'expired' });
    await page.clock.fastForward(31_000);
    await active.getByText('Expired', { exact: true }).waitFor();
    assert.equal(await active.getByRole('button', { name: 'Review NATIVE-OFFER' }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: `/tmp/baliktela-mobile-alignment-ui/status-${width}.png`, fullPage: true });
    assert.equal(writes, 0); assert.deepEqual(errors, []);
    await context.close();
    console.log(`Mobile status/stock, visible-page polling, live detail and responsive ${width}px passed.`);
  }
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
