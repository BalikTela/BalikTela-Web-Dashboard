import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore, type DashboardSourceSnapshot } from './store.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { aggregateHubDisposals } from './hubDisposals.js';
import { buildHubDisposalMonitoring } from './hubs.js';
import { buildHubOperations } from './hubOperations.js';
import type { HubDisposalRecord } from '../shared/hubs.js';

const now = new Date('2026-10-19T12:00:00Z'), query = { dateRange: 'Last 3 calendar months' };
async function fixture() {
  const data = await createSeedData(), admin = data.users[0], receiver = data.users.find(item => item.role === 'Recycler')!;
  const hub = { ...structuredClone(receiver), id: 'DISPOSAL-HUB', role: 'BalikTela Hub' as const, organizationVerified: true, scope: { ...receiver.scope, facilityIds: [] } };
  data.users.push(hub, { ...hub, id: 'OTHER-DISPOSAL-HUB' });
  const batch = { ...data.materialBatches[0], id: 'DISPOSAL-BATCH', region: 'Metro Manila', materialCategory: 'Cotton', createdAt: '2026-08-10T01:00:00Z' };
  const archived = { ...batch, id: 'DISPOSAL-ARCHIVED', currentStatus: 'Archived' as const, createdAt: '2026-09-05T01:00:00Z' };
  const old = { ...batch, id: 'OLD-DISPOSAL-BATCH', createdAt: '2026-07-20T01:00:00Z' };
  const listing = { ...data.listings[0], id: 'DISPOSAL-LISTING', batchId: batch.id, deliveryRoute: 'via_hub' as const,
    weighingHubId: hub.id, quantityKg: 100, disposedWeightKg: 999, createdAt: batch.createdAt };
  const source: DashboardSourceSnapshot & { hubDisposals: { available: boolean; records: HubDisposalRecord[] } } = { ...await loadDashboardAnalyticsSnapshot(new MemoryStore(data)), allBatches: [batch, archived, old],
    listings: [listing, { ...listing, id: 'ARCHIVED-DISPOSAL-LISTING', batchId: archived.id, status: 'Archived' as const, createdAt: archived.createdAt },
      { ...listing, id: 'OLD-DISPOSAL-LISTING', batchId: old.id, createdAt: old.createdAt }],
    allTransfers: [], measurements: [], recoveryRecords: [], hubDisposals: { available: true, records: [] as HubDisposalRecord[] } };
  const record: HubDisposalRecord = { id: 'PARTIAL-ONE', listingId: listing.id, operatorId: hub.id, listingTitle: listing.title,
    category: 'Cotton', weightKg: 2, reason: 'Documented handling', disposedAt: '2026-10-18T01:00:00Z' };
  return { source, admin, hub, batch, archived, old, record, store: new MemoryStore(data), data };
}

test('Overview disposal sums unique partial ledger entries including archived cohort history, never cumulative counters', async () => {
  const { source, admin, batch, archived, record, store } = await fixture(), original = structuredClone(source);
  source.hubDisposals.records = [record, { ...record }, { ...record, id: 'PARTIAL-TWO', weightKg: 3 },
    { ...record, id: 'ARCHIVED', listingId: 'ARCHIVED-DISPOSAL-LISTING', weightKg: 7 },
    { ...record, id: 'OLD', listingId: 'OLD-DISPOSAL-LISTING', weightKg: 50 }];
  const result = await buildDashboardAnalytics(store, admin, query, source, now);
  assert.equal(result.kpis.find(item => item.label === 'Recorded Hub Disposal')?.value, '0.012 t');
  assert.ok(!result.kpis.some(item => item.label === 'Confirmed Reuse + Recycling'));
  assert.equal(result.hubDisposal.summary.records, 3); assert.equal(result.hubDisposal.summary.disposedKg, 12);
  assert.equal(result.hubOperations.disposedKg, 12);
  const monitoring = await buildHubDisposalMonitoring(store, admin, query, now, source);
  assert.deepEqual(monitoring.summary, result.hubDisposal.summary);
  assert.equal(buildHubOperations(source, [batch, archived], admin, 'Cohort', now).summary.disposedKg, 12);
  assert.equal(source.listings[0].disposedWeightKg, original.listings[0].disposedWeightKg);
});

test('Hub disposal honors batch registration, region, textile filters and Philippine calendar dates', async () => {
  const { source, admin, record, store } = await fixture();
  source.hubDisposals.records = [record, { ...record, id: 'ARCHIVED', listingId: 'ARCHIVED-DISPOSAL-LISTING', weightKg: 7 }];
  for (const filters of [{ region: 'Davao Region' }, { textileType: 'Denim' }]) {
    assert.equal((await buildDashboardAnalytics(store, admin, { ...query, ...filters }, source, now)).hubDisposal.summary.disposedKg, 0);
  }
  const september = await buildDashboardAnalytics(store, admin, { dateRange: 'Custom range', startDate: '2026-09-01', endDate: '2026-09-30' }, source, now);
  assert.equal(september.hubDisposal.summary.disposedKg, 7, 'Latest disposal of September registrations, not disposal-event-month totals.');
});

test('invalid, conflicting, future and unlinked disposal evidence cannot inflate the KPI', async () => {
  const { source, admin, batch, record, store } = await fixture();
  source.hubDisposals.records = [record, { ...record, weightKg: 999 }, { ...record, id: 'VALID', weightKg: 4 },
    { ...record, id: 'NEGATIVE', weightKg: -1 }, { ...record, id: 'MISSING-WEIGHT', weightKg: NaN },
    { ...record, id: 'UNKNOWN-OPERATOR', operatorId: 'MISSING' }, { ...record, id: 'BAD-DATE', disposedAt: 'invalid' },
    { ...record, id: 'NO-REASON', reason: '' }, { ...record, id: 'ORPHAN', listingId: 'MISSING' },
    { ...record, id: 'FUTURE', disposedAt: '2026-10-20T00:00:00+08:00' }];
  const result = aggregateHubDisposals(source, [batch], admin, now);
  assert.equal(result.summary.disposedKg, 4); assert.equal(result.summary.records, 1);
  assert.equal(result.summary.invalidRecords, 6); assert.equal(result.summary.missingLinks, 1);
  assert.equal((await buildDashboardAnalytics(store, admin, query, source, now)).kpis.find(item => item.label === 'Recorded Hub Disposal')?.value, '0.004 t');
});

test('unavailable disposal feed is not zero, and invalid-only evidence stays pending', async () => {
  const { source, admin, record, store } = await fixture();
  source.hubDisposals.available = false; source.hubDisposals.records = [record];
  assert.equal((await buildDashboardAnalytics(store, admin, query, source, now)).kpis.find(item => item.label === 'Recorded Hub Disposal')?.value, 'Not available');
  source.hubDisposals = { available: true, records: [] };
  assert.equal((await buildDashboardAnalytics(store, admin, query, source, now)).kpis.find(item => item.label === 'Recorded Hub Disposal')?.value, '0 t');
  source.hubDisposals.records = [{ ...record, weightKg: -1 }];
  assert.equal((await buildDashboardAnalytics(store, admin, query, source, now)).kpis.find(item => item.label === 'Recorded Hub Disposal')?.value, 'Pending evidence');
});

test('Hub identity scope and aggregate-only privacy apply to the same ledger calculation', async () => {
  const { source, admin, hub, batch, record, store } = await fixture();
  source.hubDisposals.records = [record, { ...record, id: 'OTHER', operatorId: 'OTHER-DISPOSAL-HUB', weightKg: 9 }];
  assert.equal(aggregateHubDisposals(source, [batch], hub, now).summary.disposedKg, 2);
  const government = aggregateHubDisposals(source, [batch], { ...admin, role: 'Government' }, now);
  assert.deepEqual(government.records, []); assert.equal(government.summary.disposedKg, 11);
  source.users = source.users.map(user => user.id === hub.id ? { ...user, role: 'Consumer' as const, organizationVerified: false } : user);
  assert.equal(aggregateHubDisposals(source, [batch], admin, now).summary.disposedKg, 11, 'Later role changes do not erase valid historical ledger records.');
  source.hubDisposals.records = [record];
  assert.equal((await buildDashboardAnalytics(store, admin, { ...query, stakeholderType: 'BalikTela Hub' }, source, now)).hubDisposal.summary.disposedKg, 2);
});

test('recorded disposal never enters recovery percentage, recycling output or landfill diversion', async () => {
  const { source, admin, batch, record, store, data } = await fixture();
  const transfer = { ...data.transfers[0], id: 'RECOVERY-TRANSFER', batchId: batch.id, listingId: source.listings[0].id, status: 'Completed' as const,
    createdAt: batch.createdAt, updatedAt: '2026-09-01T01:00:00Z', agreedWeightKg: 80, receiptWeightKg: 80, verifiedWeightKg: 80 };
  source.allTransfers.push(transfer);
  source.recoveryRecords.push({ ...data.recoveryRecords[0], id: 'INTAKE', batchId: batch.id, transferId: transfer.id, stage: 'Collection',
    inputWeightKg: 100, outputWeightKg: 100, residualWeightKg: 0, lossWeightKg: 0, status: 'Validated', validatedBy: admin.id, timestamp: batch.createdAt },
  { ...data.recoveryRecords[0], id: 'FINAL', batchId: batch.id, transferId: transfer.id, stage: 'Recovery', outcome: 'Recycling',
    inputWeightKg: 80, outputWeightKg: 72, residualWeightKg: 8, lossWeightKg: 0, status: 'Validated', validatedBy: admin.id, timestamp: transfer.updatedAt });
  const before = await buildDashboardAnalytics(store, admin, query, source, now);
  source.hubDisposals.records = [{ ...record, weightKg: 20 }];
  const after = await buildDashboardAnalytics(store, admin, query, source, now);
  assert.equal(before.impactMetrics.diversionRate, 72); assert.equal(after.impactMetrics.diversionRate, 72);
  assert.deepEqual(after.circularFlow, before.circularFlow); assert.equal(after.impactMetrics.landfillAvoidedKg, null);
  assert.match(after.kpis.find(item => item.label === 'Confirmed Recovery Share')!.delta, /Reuse \+ recycling/);
});
