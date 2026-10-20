import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { issueToken } from './auth.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { registerReportRoutes } from './reports.js';
import { buildDashboardAnalytics } from './dashboardAnalytics.js';
import type { UserRole } from './types.js';

test('report previews and exports enforce current permissions, filters, formats and audit boundaries', async () => {
  const seed = await createSeedData(); const store = new MemoryStore(seed);
  const now = new Date('2026-10-17T04:00:00Z');
  const tokens = new Map<UserRole, string>();
  for (const actor of seed.users) {
    const id = `REPORT-${actor.id}`;
    await store.createSession({ id, userId: actor.id, client: 'api', tokenHash: 'test', csrfHash: 'test', usedTokenHashes: [], expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
    tokens.set(actor.role, issueToken(actor.id, actor.role, id));
  }
  const researcher = seed.users.find(item => item.role === 'Researcher')!;
  researcher.scope.canExport = false; researcher.scope.aggregateOnly = true; researcher.scope.regions = ['Metro Manila'];
  const app = express(); registerReportRoutes(app, store, () => now);
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing HTTP test address.');
  const get = (path: string, role?: UserRole) => fetch(`http://127.0.0.1:${address.port}/api/reports${path}`, { headers: role ? { Authorization: `Bearer ${tokens.get(role)}` } : {} });
  try {
    const auditCount = (await store.all('auditRecords')).length;
    const exports = async () => (await buildDashboardAnalytics(store, seed.users[0], {}, undefined, now)).engagementMetrics.reportExports;
    assert.equal(await exports(), 0);
    assert.equal((await get('')).status, 401);
    const catalog = await get('', 'Administrator');
    assert.equal(catalog.status, 200);
    assert.deepEqual((await catalog.json()).reports.map((report: { id: string }) => report.id), ['material-flow', 'data-quality', 'organizations']);
    for (const path of ['/environmental-impact/preview', '/environmental-impact/export', '/environmental-impact/export?format=print']) {
      const removed = await get(path, 'Administrator');
      assert.equal(removed.status, 404, `Removed report must not be accessible at ${path}`);
      assert.equal((await removed.json()).message, 'Report not found.');
      assert.equal(removed.headers.get('cache-control'), 'private, no-store');
    }
    assert.equal((await get('/material-flow/preview', 'Consumer')).status, 403);
    assert.equal((await get('/material-flow/export', 'Researcher')).status, 403);
    const preview = await get('/material-flow/preview', 'Researcher'); assert.equal(preview.status, 200);
    const document = await preview.json(); assert.equal(document.scope.canExport, false); assert.equal(document.scope.aggregateOnly, true);
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    const outside = await (await get('/material-flow/preview?region=Central%20Visayas', 'Researcher')).json();
    assert.equal(Number(outside.rows.at(-1)[2]), 0);
    assert.equal((await get('/invented/export', 'Administrator')).status, 404);
    assert.equal((await get('/material-flow/export?format=exe', 'Administrator')).status, 400);
    assert.equal((await get('/material-flow/export?region=x&region=y', 'Administrator')).status, 400);
    assert.equal((await get('/material-flow/export?dateRange=Custom%20range&startDate=2026-02-30&endDate=2026-03-01', 'Administrator')).status, 400);
    assert.equal((await store.all('auditRecords')).length, auditCount);
    assert.equal(await exports(), 0, 'Previews, forbidden exports and invalid requests are not export events.');
    const csv = await get('/material-flow/export?textileType=Cotton', 'Administrator');
    assert.equal(csv.status, 200); assert.match(csv.headers.get('content-type')!, /text\/csv/);
    assert.match(csv.headers.get('content-disposition')!, /2026-08-01-2026-10-17\.csv/);
    const body = await csv.text(); assert.ok(body.includes('Cotton')); assert.ok(!body.includes('Denim'));
    assert.equal((await store.all('auditRecords')).length, auditCount + 1);
    assert.equal(await exports(), 1);
    const printable = await get('/organizations/export?format=print', 'Administrator'); assert.equal(printable.status, 200);
    assert.equal((await printable.json()).id, 'organizations');
    assert.equal((await store.all('auditRecords')).length, auditCount + 2);
    assert.equal(await exports(), 2, 'CSV and print-generation requests each have an audited export record.');
    researcher.accountStatus = 'Suspended';
    assert.equal((await get('/material-flow/preview', 'Researcher')).status, 403);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
