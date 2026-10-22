import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import express from 'express';
import { chromium } from 'playwright-core';
import { createSeedData } from '../server/seed.js';
import { MemoryStore } from '../server/store.js';
import { buildDashboardAnalytics } from '../server/dashboardAnalytics.js';
import { registerHubStockRoutes } from '../server/hubStockRoutes.js';
import { accessSummary } from '../server/access-control.js';
import { issueToken } from '../server/auth.js';
import { serveWebApp } from '../server/webApp.js';

// Disposable local fixtures exercise the actual API. No Supabase connection or shared writes.
const data = await createSeedData(), admin = data.users[0];
const consumer = data.users.find(item => item.role === 'Consumer')!;
const site = { ...data.facilities[0], id: 'UI-STOCK-HUB', name: 'Stock Review Hub', storageCapacityKg: 50000, isDemo: false, status: 'Available' as const };
const hub = { ...data.users.find(item => item.role === 'Recycler')!, id: 'UI-STOCK-OPERATOR', role: 'BalikTela Hub' as const,
  accountStatus: 'Active' as const, organizationVerified: true, canonicalVerification: 'verified', scope: { ...admin.scope, facilityIds: [site.id] } };
const batch = { ...data.materialBatches[0], id: 'UI-STOCK-BATCH', declaredWeightKg: 25000, sourceUserId: consumer.id, createdAt: '2026-10-22T01:00:00Z' };
const listing = { ...data.listings[0], id: 'UI-STOCK-LISTING', title: 'Linen stock', batchId: batch.id, weighingHubId: hub.id, ownerId: consumer.id,
  deliveryRoute: 'via_hub' as const, status: 'Archived' as const, canonicalStatus: 'archived', createdAt: batch.createdAt, availableWeightKg: 0, disposedWeightKg: 25000 };
const government = { ...admin, id: 'UI-STOCK-GOV', role: 'Government' as const };
const researcher = { ...admin, id: 'UI-STOCK-RESEARCH', role: 'Researcher' as const };
data.users = [admin, hub, consumer, government, researcher]; data.facilities = [site]; data.materialBatches = [batch]; data.listings = [listing];
data.transfers = []; data.recoveryRecords = []; data.auditRecords = [];
data.measurements = [{ ...data.measurements[0], id: 'UI-STOCK-WEIGHT', batchId: batch.id, recordedBy: hub.id, canonicalStage: 'listing',
  stage: 'Declaration', transferId: null, status: 'Measured', weightKg: 25000, timestamp: '2026-10-22T01:01:00Z', supersedesMeasurementId: null }];
class LocalStore extends MemoryStore {
  async loadHubDisposals() { return { available: true, records: [{ id: 'UI-STOCK-DISPOSAL', listingId: listing.id, operatorId: hub.id,
    listingTitle: listing.title, category: 'Linen', weightKg: 25000, reason: 'Recorded disposal', disposedAt: '2026-10-22T01:02:00Z' }] }; }
}
const store = new LocalStore(data);
const at = new Date().toISOString(), sessionId = 'UI-STOCK-SESSION';
await store.createSession({ id: sessionId, userId: admin.id, client: 'api', tokenHash: 'test', usedTokenHashes: [], csrfHash: 'test',
  expiresAt: new Date(Date.now() + 600000).toISOString(), revokedAt: null, createdAt: at, updatedAt: at });
const token = issueToken(admin.id, admin.role, sessionId);
let actor = admin;
const app = express(); app.use(express.json());
registerHubStockRoutes(app, store);
app.get('/api/analytics/dashboard', async (req, res) => { res.json(await buildDashboardAnalytics(store, actor, req.query)); });
app.get('/api/facilities', (_req, res) => res.json({ facilities: [site] }));
app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
serveWebApp(app);
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert.ok(address && typeof address !== 'string');
const output = '/tmp/baliktela-hub-stock-ui'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  for (const width of [1440, 375]) {
    const context = await browser.newContext({ viewport: { width, height: width === 375 ? 812 : 1000 }, timezoneId: 'Asia/Manila', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      if (new URL(route.request().url()).pathname === '/api/auth/me') return route.fulfill({ json: { user: actor, access: accessSummary(actor), storage: 'local-test' } });
      return route.continue({ headers: { ...route.request().headers(), authorization: `Bearer ${token}` } });
    });
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByRole('button', { name: 'Hub Facilities', exact: true }).waitFor({ state: 'attached' });
    const menu = page.getByRole('button', { name: 'Open navigation', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('button', { name: 'Hub Facilities', exact: true }).click();
    const table = page.getByRole('table', { name: 'Hub facility analytics' });
    const row = table.locator('tbody tr').filter({ hasText: site.name }); await row.waitFor();
    if (width === 1440) assert.ok((await row.innerText()).includes('Stock not established'));
    await row.getByRole('button', { name: `Confirm current stock for ${site.name}` }).click();
    const dialog = page.locator('dialog[open]'); await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Actual stock remaining (t)', { exact: true }).inputValue(), '');
    assert.equal(await dialog.getByLabel('I checked the actual stock held at this Hub.', { exact: true }).isChecked(), false);
    await dialog.getByLabel('Actual stock remaining (t)', { exact: true }).fill(width === 1440 ? '0' : '0.5');
    await dialog.getByLabel('Reason for this stock confirmation', { exact: true }).fill('Actual stock checked at the Hub.');
    await dialog.getByLabel('I checked the actual stock held at this Hub.', { exact: true }).check();
    await page.screenshot({ path: `${output}/confirm-${width}.png`, fullPage: true });
    const response = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/stock-confirmations'));
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    const result = await response; assert.equal(result.status(), 201, await result.text());
    await dialog.waitFor({ state: 'hidden' });
    await row.getByText(/Admin-confirmed count/).waitFor();
    await row.getByText('Available', { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/saved-${width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  }
  for (const roleActor of [government, researcher]) {
    actor = roleActor;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: actor, access: accessSummary(actor), storage: 'local-test' } }));
    await page.goto(`http://127.0.0.1:${address.port}/dashboard`);
    await page.getByRole('button', { name: 'Hub Facilities', exact: true }).click();
    await page.getByRole('table', { name: 'Hub facility analytics' }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Confirm current stock for/ }).count(), 0);
    assert.equal(await page.getByText(site.name, { exact: true }).count(), 0);
    await context.close();
  }
  assert.equal((await store.all('auditRecords')).filter(item => item.action === 'hub.stock.confirmed').length, 2);
  console.log(JSON.stringify({ result: 'passed', browserScenarios: 4, sharedDatabaseWrites: 0, screenshots: output }));
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
