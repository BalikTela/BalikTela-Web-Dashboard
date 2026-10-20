import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from 'dotenv';
import express from 'express';
import { chromium } from 'playwright-core';
import { SupabaseStore } from '../server/supabaseStore.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectHubCohort } from '../server/dashboardAnalytics.js';
import { buildHubStorageAnalytics } from '../server/hubStorage.js';
import { buildHubOperations } from '../server/hubOperations.js';
import { buildHubDisposalMonitoring } from '../server/hubs.js';
import { accessSummary } from '../server/access-control.js';
import { serveWebApp } from '../server/webApp.js';
import { buildHubSimulation } from '../server/analytics/hubSimulation.js';
import { HUB_SIMULATION_PREFIX as P, isStorageSimulationOperator } from '../shared/hubStorage.js';

config({ path: '.env.supabase', quiet: true });
const store = new SupabaseStore(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!);
const output = 'test-results/hub-simulation';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]!));
try {
  const source = await loadDashboardAnalyticsSnapshot(store), now = new Date();
  const actor = source.users.find(item => item.role === 'Administrator' && item.accountStatus === 'Active');
  assert.ok(actor, 'An existing active administrator is required for read-only verification.');
  const demo = buildHubSimulation(source.facilities);
  const own = { ...source, allBatches: source.allBatches.filter(item => item.id.startsWith(P)),
    allTransfers: [], listings: source.listings.filter(item => item.id.startsWith(P)), measurements: source.measurements.filter(item => item.id.startsWith(P)),
    recoveryRecords: [], offers: [], users: [actor, ...source.users.filter(item => item.id.startsWith(P))],
    hubDisposals: { available: source.hubDisposals?.available ?? false, records: source.hubDisposals?.records.filter(item => item.id.startsWith(P)) ?? [] } };
  assert.equal(own.allBatches.length, 7); assert.equal(own.listings.length, 7); assert.equal(own.measurements.length, 12); assert.equal(own.hubDisposals.records.length, 4);
  assert.equal(own.users.length, 15); assert.ok(own.users.slice(1).every(item => item.accountStatus === 'Deactivated' && item.authUserId === null && item.passwordHash === null));
  assert.equal(own.users.filter(isStorageSimulationOperator).length, 7);
  assert.ok(own.listings.every(item => item.status !== 'Open' && item.availableWeightKg === 0 && item.isDemo));
  const onlyStorage = buildHubStorageAnalytics(own, source.facilities, actor, now);
  for (const expected of demo.scenarios) {
    const row = onlyStorage.rows.find(item => item.id === expected.hubId)!;
    assert.equal(row.storedKg, expected.heldKg); assert.equal(row.reservedKg, expected.reservedKg); assert.equal(row.disposedKg, expected.disposedKg);
    assert.equal(row.selectable, false);
  }
  const operations = buildHubOperations(own, own.allBatches, actor, 'Synthetic simulation only', now);
  assert.equal(operations.summary.sentKg, 20500); assert.equal(operations.summary.collectedKg, 17250); assert.equal(operations.summary.disposedKg, 2900);
  const analytics = await buildDashboardAnalytics(store, actor, {}, source, now);
  const stages = [ ['Empty Hub', '00:30'], ['Consumer submits; space reserved', '01:30'], ['Hub receives; intake paused', '02:30'],
    ['First disposal; space released', '04:30'], ['Final disposal; cleared Hub reopens', '06:30'] ];
  const timeline = stages.flatMap(([stage, time]) => {
    const at = new Date(`2026-10-20T${time}:00.000Z`), replay = structuredClone(own);
    for (const listing of replay.listings) {
      const disposed = replay.hubDisposals.records.filter(item => item.listingId === listing.id && Date.parse(item.disposedAt) <= at.getTime()).reduce((sum, item) => sum + item.weightKg, 0);
      listing.disposedWeightKg = disposed; listing.disposedAt = null;
      listing.status = disposed === listing.quantityKg ? 'Closed' : 'Reserved'; listing.canonicalStatus = disposed === listing.quantityKg ? 'closed' : 'reserved';
    }
    return buildHubStorageAnalytics(replay, source.facilities, actor, at).rows.filter(row => ['FAC-001','FAC-002'].includes(row.id))
      .map(row => ({ stage, hub: row.name, storedKg: row.storedKg, reservedKg: row.reservedKg, utilization: row.utilization, status: row.status }));
  });
  const report = { verifiedAt: now.toISOString(), dataset: P, actualMobileClicks: false, verificationWrites: 0,
    totalsKg: { declared: 20500, received: 17250, disposed: 2900, held: 14350, reserved: 3250 },
    scenarioRows: onlyStorage.rows, combinedRows: analytics.hubStorage.rows, timeline,
    unknownCombinedHubs: analytics.hubStorage.rows.filter(item => item.storedKg === null).map(item => item.name) };
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/verification.json`, JSON.stringify(report, null, 2));
  const rowHtml = (rows: typeof onlyStorage.rows) => rows.map(row => `<tr><td>${escape(row.name)}</td><td>${row.capacityKg}</td><td>${row.storedKg ?? 'Not established'}</td><td>${row.reservedKg ?? 'Not established'}</td><td>${row.disposedKg ?? 'Unavailable'}</td><td>${row.utilization ?? '-'}%</td><td>${escape(row.status)}</td></tr>`).join('');
  await writeFile(`${output}/report.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BalikTela Hub Simulation</title><style>body{margin:0;color:#203b32;background:#f6f8f7;font:15px/1.6 system-ui,sans-serif}main{max-width:1200px;margin:auto;padding:32px 20px}h1{font-size:28px}h2{font-size:20px;margin-top:32px}p{max-width:950px}table{border-collapse:collapse;width:100%;font-size:13px;background:white}td,th{text-align:left;padding:12px;border-bottom:1px solid #d8e2dd}th{background:#eaf2ee}section{overflow:auto}aside{border-left:3px solid #b97822;padding-left:16px}a{color:#18694f}@media print{body{background:white}main{padding:0}}</style><main><h1>BalikTela Hub lifecycle simulation</h1><aside>Synthetic scenario records saved in the shared database. No physical delivery or disposal occurred. No new login accounts or public stock were created. This is a replay of dashboard evidence, not an automated mobile app journey.</aside><p>The same batch, listing, operator, receipt and disposal IDs connect Material Registry, Listing Oversight, Recovery Monitoring, Overview and Hub Facilities.</p><h2>Simulation-only totals</h2><p>20,500 kg declared = 17,250 kg received + 3,250 kg reserved awaiting receipt.<br>17,250 kg received = 2,900 kg disposed + 14,350 kg still held.</p><h2>Step-by-step process</h2><section><table><thead><tr><th>Step</th><th>Hub</th><th>Held kg</th><th>Reserved kg</th><th>Utilization</th><th>Status</th></tr></thead><tbody>${timeline.map(row=>`<tr><td>${escape(row.stage)}</td><td>${escape(row.hub)}</td><td>${row.storedKg ?? '-'}</td><td>${row.reservedKg ?? '-'}</td><td>${row.utilization ?? '-'}%</td><td>${escape(row.status)}</td></tr>`).join('')}</tbody></table></section><h2>Seven linked scenarios</h2><section><table><thead><tr><th>Hub</th><th>Capacity kg</th><th>Held kg</th><th>Reserved kg</th><th>Disposed kg</th><th>Utilization</th><th>Status</th></tr></thead><tbody>${rowHtml(onlyStorage.rows)}</tbody></table></section><h2>Combined dashboard view</h2><p>Existing records are preserved. Unknown balances from unrelated operational records remain unknown; synthetic receipts do not repair real evidence.</p><section><table><thead><tr><th>Hub</th><th>Capacity kg</th><th>Held kg</th><th>Reserved kg</th><th>Disposed kg</th><th>Utilization</th><th>Status</th></tr></thead><tbody>${rowHtml(analytics.hubStorage.rows)}</tbody></table></section><p>Read-only verification: ${escape(now.toISOString())}. Figures use the production dashboard calculators. Simulation profiles remain disabled and non-selectable; admission control for real mobile submissions is not implemented by this seed.</p><p><a href="facilities-1366.png">Hub Facilities screenshot</a> · <a href="recovery-1366.png">Recovery Monitoring screenshot</a> · <a href="verification.json">Verification data</a></p></main></html>`);
  if (process.argv.includes('--browser')) {
    const app = express(); serveWebApp(app); const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
    const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    try { for (const width of [375, 1366, 2560]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' }), page = await context.newPage();
      const errors: string[] = []; let writes = 0; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname, query = Object.fromEntries(url.searchParams);
        if (request.method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: { message: 'Read-only verification' } }); }
        if (path === '/api/auth/me') return route.fulfill({ json: { user: { ...actor, passwordHash: null }, access: accessSummary(actor), storage: 'read-only-production-snapshot' } });
        if (path === '/api/analytics/dashboard') return route.fulfill({ json: analytics });
        if (path === '/api/barter/listings') return route.fulfill({ json: { listings: source.listings } });
        if (path === '/api/material-batches') return route.fulfill({ json: { batches: source.allBatches.map(batch => ({ ...batch, measurements: source.measurements.filter(item => item.batchId === batch.id) })) } });
        if (path === '/api/hub-operations') { const cohort = selectHubCohort(source, actor, query, now); return route.fulfill({ json: buildHubOperations(source, cohort.batches, cohort.actor, cohort.period.label, now) }); }
        if (path === '/api/hub-disposals') return route.fulfill({ json: await buildHubDisposalMonitoring(store, actor, query, now, source) });
        return route.fulfill({ status: 404, json: { message: 'Not used in this read-only verification' } });
      });
      const active = () => page.locator('main [aria-hidden="false"]').first();
      const navigate = async (name: string) => { const menu = page.getByRole('button', { name: 'Open navigation', exact: true }); if (await menu.isVisible()) await menu.click(); await page.getByRole('button', { name, exact: true }).click(); };
      await page.goto(`http://127.0.0.1:${address.port}/dashboard`); await page.getByText('Program Analytics', { exact: true }).waitFor();
      await navigate('Hub Facilities'); await active().getByRole('table', { name: 'Hub facility analytics' }).waitFor();
      assert.equal(await active().getByText('Includes synthetic simulation', { exact: true }).count(), 7);
      const cleared = active().getByRole('row').filter({ has: page.getByText(source.facilities.find(item => item.id === 'FAC-002')!.name, { exact: true }) });
      await cleared.getByText('0%', { exact: true }).waitFor(); await cleared.getByText('Available', { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: `${output}/facilities-${width}.png`, fullPage: true });
      await navigate('Listing Oversight'); await active().getByLabel('Search listings', { exact: true }).fill('Hub simulation:');
      await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] tr[data-listing-id]').length === 7);
      await navigate('Material Registry'); await active().getByLabel('Search batch records', { exact: true }).fill(P);
      await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] tbody tr').length === 7);
      await navigate('Recovery Monitoring'); await active().getByLabel('Search Hub materials', { exact: true }).fill(P);
      await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] tbody tr').length === 7);
      await page.screenshot({ path: `${output}/recovery-${width}.png`, fullPage: true });
      await active().getByRole('button', { name: 'Hub Disposals', exact: true }).click();
      await active().getByLabel('Search disposal records', { exact: true }).fill(P);
      await page.waitForFunction(() => document.querySelectorAll('main [aria-hidden="false"] tbody tr').length === 4);
      assert.deepEqual(errors, []); assert.equal(writes, 0); await context.close();
    } } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
  console.log(JSON.stringify({ verified: true, totalsKg: report.totalsKg, linkedHubs: 7, batches: 7, receipts: 5, disposals: 4,
    unknownCombinedHubs: report.unknownCombinedHubs, databaseWrites: 0, report: `${output}/report.html` }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ verified: false, message: error instanceof assert.AssertionError ? error.message : 'Read-only simulation verification failed.',
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined })); process.exitCode = 1;
} finally { await store.close(); }
