import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { registeredAccountCount } from './platformActivity.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { planImport, commitImport } from './imports.js';
import { IMPORT_COLUMNS } from '../shared/imports.js';
import type { AuditRecord } from './types.js';

const now = new Date('2026-10-20T04:00:00Z');
const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const data = await createSeedData();
  const admin = data.users[0], producer = data.users.find(user => user.role === 'Producer')!, consumer = data.users.find(user => user.role === 'Consumer')!;
  admin.authUserId = identity(1); producer.authUserId = identity(2); consumer.authUserId = identity(3);
  data.users.push({ ...structuredClone(consumer), id: 'REGIONAL', authUserId: identity(4), region: 'Central Visayas', city: 'Cebu City' },
    { ...structuredClone(consumer), id: 'DUPLICATE-PROFILE' },
    { ...structuredClone(consumer), id: 'FUTURE-REGISTRATION', authUserId: identity(5), joinedAt: '2026-10-21T01:00:00Z' },
    { ...structuredClone(consumer), id: 'SYN-USR-PROFILE', authUserId: identity(6) },
    { ...structuredClone(consumer), id: 'INVALID-REGISTRATION', authUserId: identity(7), joinedAt: 'unknown' });
  data.systemInteractions = ['active_users', 'sessions', 'waste_submissions', 'barter_actions', 'report_exports'].map(eventName => ({
    id: `FAKE-${eventName}`, userId: null, organizationId: null, sessionId: null, eventName: eventName as typeof data.systemInteractions[number]['eventName'],
    client: 'mobile', properties: { count: 999999, averageSessionMinutes: 99, synthetic: true }, privacyClassification: 'aggregate', occurredAt: now.toISOString(),
  }));
  const exported: AuditRecord = { id: 'EXPORT-ADMIN', actorId: admin.id, action: 'report.exported', entityType: 'Report', entityId: 'material-flow', timestamp: '2026-10-19T03:00:00Z', details: '{}' };
  data.auditRecords = [exported, { ...exported }, { ...exported, id: 'EXPORT-CONSUMER', actorId: consumer.id },
    { ...exported, id: 'BOUNDARY', timestamp: '2026-07-31T16:00:00Z' },
    { ...exported, id: 'BEFORE', timestamp: '2026-07-31T15:59:59Z' },
    { ...exported, id: 'FUTURE', timestamp: '2026-10-21T01:00:00Z' },
    { ...exported, id: 'WRONG-TYPE', entityType: 'Transfer' }, { ...exported, id: 'PREVIEW', action: 'report.previewed' }];
  return { data, admin, producer, consumer, store: new MemoryStore(data) };
}

test('platform engagement counts canonical records and Auth-linked profiles, never synthetic usage summaries', async () => {
  const { data, store, admin } = await fixture(), before = structuredClone(data);
  const view = await buildDashboardAnalytics(store, admin, {}, undefined, now), metrics = view.engagementMetrics;
  assert.equal(metrics.registeredAccounts, 4);
  assert.equal(view.kpis.find(item => item.label === 'Registered Accounts')?.value, '4');
  assert.equal(view.kpis.some(item => item.label === 'Reported Active Users'), false);
  assert.equal(metrics.listings, view.sharedActivity.listings);
  assert.equal(metrics.requests, data.offers.length);
  assert.equal(metrics.completedTransfers, view.sharedActivity.completedTransfers);
  assert.equal(metrics.reportExports, 3);
  assert.equal(metrics.monthlyActiveUsers, null); assert.equal(metrics.monthlyActiveUsersAvailable, false);
  assert.equal(metrics.sessions, null); assert.equal(metrics.averageSessionMinutes, null);
  assert.ok(!JSON.stringify(metrics).includes('999999'));
  assert.deepEqual(data, before, 'Reading activity must not create telemetry, users, exports or lifecycle records.');
});

test('activity follows the material cohort while accounts follow profile scope and exports follow audit dates', async () => {
  const { store, admin } = await fixture();
  const region = await buildDashboardAnalytics(store, admin, { region: 'Central Visayas' }, undefined, now);
  assert.equal(region.engagementMetrics.registeredAccounts, 1);
  assert.equal(region.engagementMetrics.listings, region.sharedActivity.listings);
  assert.equal(region.engagementMetrics.listings, 0);
  assert.equal(region.engagementMetrics.requests, 0);
  assert.equal(region.engagementMetrics.completedTransfers, 0);
  assert.equal(region.engagementMetrics.reportExports, 3, 'Exports are explicitly date-scoped, not material-scoped.');
  const cotton = await buildDashboardAnalytics(store, admin, { textileType: 'Cotton' }, undefined, now);
  assert.equal(cotton.engagementMetrics.listings, 1); assert.equal(cotton.engagementMetrics.registeredAccounts, 4);
  const september = await buildDashboardAnalytics(store, admin, { dateRange: 'Custom range', startDate: '2026-09-01', endDate: '2026-09-30' }, undefined, now);
  assert.equal(september.engagementMetrics.registeredAccounts, 4, 'Registered accounts is an as-of count, not registrations in September.');
  assert.equal(september.engagementMetrics.reportExports, 0);
});

test('role boundaries isolate account counts and audit exports and return no private profile or audit details', async () => {
  const { data, store, admin, producer, consumer } = await fixture();
  const government = data.users.find(user => user.role === 'Government')!;
  government.scope = { ...government.scope, regions: ['Central Visayas'], aggregateOnly: true };
  data.auditRecords.push({ ...data.auditRecords[0], id: 'GOV-EXPORT', actorId: government.id });
  const view = await buildDashboardAnalytics(store, government, {}, undefined, now);
  assert.equal(view.engagementMetrics.registeredAccounts, 1); assert.equal(view.engagementMetrics.reportExports, 1);
  assert.equal(view.engagementMetrics.exportScope, 'Own');
  const snapshot = await loadDashboardAnalyticsSnapshot(store);
  assert.equal(registeredAccountCount(snapshot, producer, {}, now), 1);
  assert.equal(registeredAccountCount(snapshot, consumer, {}, now), 1);
  assert.equal(registeredAccountCount(snapshot, { ...producer, role: 'BalikTela Hub', webHubOperator: true,
    scope: { ...producer.scope, organizationIds: data.users.map(user => user.organizationId).filter((id): id is string => Boolean(id)) } }, {}, now), 1);
  assert.equal(registeredAccountCount(snapshot, government, { region: 'Metro Manila' }, now), 0);
  const json = JSON.stringify(view.engagementMetrics);
  for (const secret of [admin.email, consumer.email, identity(4), 'EXPORT-ADMIN', 'GOV-EXPORT']) assert.ok(!json.includes(secret));
});

test('bulk lifecycle imports move activity once without inflating accounts or manufacturing telemetry or exports', async () => {
  const { data, store, admin } = await fixture();
  const before = await buildDashboardAnalytics(store, admin, {}, undefined, now);
  const csv = [IMPORT_COLUMNS.join(','), 'engagement-linked,2026-10-10T01:00:00Z,USR-PROD-01,USR-REC-01,FAC-001,Cotton,100,90,80,Recycling,70'].join('\n');
  const preview = await planImport(store, admin, csv, now);
  await commitImport(store, admin, csv, preview.preview.previewHash, 'Isolated activity reconciliation', now, 0);
  const after = await buildDashboardAnalytics(store, admin, {}, undefined, now);
  for (const key of ['listings', 'requests', 'completedTransfers'] as const) assert.equal(after.engagementMetrics[key], before.engagementMetrics[key] + 1);
  assert.equal(after.engagementMetrics.registeredAccounts, before.engagementMetrics.registeredAccounts);
  assert.equal(after.engagementMetrics.reportExports, before.engagementMetrics.reportExports);
  assert.equal(after.engagementMetrics.listings, after.sharedActivity.listings);
  const replay = await planImport(store, admin, csv, now);
  await commitImport(store, admin, csv, replay.preview.previewHash, 'Idempotent retry', now, 0);
  assert.deepEqual((await buildDashboardAnalytics(store, admin, {}, undefined, now)).engagementMetrics, after.engagementMetrics);
  assert.equal(data.systemInteractions[0].properties.count, 999999);
});

test('missing audit feed remains unavailable, while a known empty feed is zero', async () => {
  const { data, admin } = await fixture();
  class MissingAudit extends MemoryStore { async loadReportExportEvents(): Promise<AuditRecord[]> { throw new Error('Unavailable audit feed'); } }
  assert.equal((await buildDashboardAnalytics(new MissingAudit(data), admin, {}, undefined, now)).engagementMetrics.reportExports, null);
  data.auditRecords = [];
  assert.equal((await buildDashboardAnalytics(new MemoryStore(data), admin, {}, undefined, now)).engagementMetrics.reportExports, 0);
});
