import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { researchBatch, researchFacility, researchListing, researchMeasurement, researchRecovery, researchTransfer, summaryActor } from './webPrivacy.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { MemoryStore } from './store.js';
import { buildReport } from './reports.js';
import { buildHubDirectory, buildHubDisposalMonitoring } from './hubs.js';
import { buildGovernanceDashboard } from './governance.js';

test('research record projections hide source identifiers and free text while preserving linked weights and states', async () => {
  const seed = await createSeedData(), actor = seed.users.find(user => user.role === 'Researcher')!;
  const batch = { ...seed.materialBatches[0], id: 'PRIVATE-BATCH', sourceUserId: 'PRIVATE-USER', sourceOrganizationId: 'PRIVATE-ORG', currentCustodianId: 'PRIVATE-CUSTODIAN', city: 'PRIVATE-ADDRESS', secondaryUnit: 'PRIVATE-UNIT' };
  const listing = { ...seed.listings[0], id: 'PRIVATE-LISTING', batchId: batch.id, ownerId: batch.sourceUserId, ownerOrganizationId: batch.sourceOrganizationId, ownerName: 'PRIVATE-NAME', title: 'PRIVATE-TITLE', description: 'PRIVATE-DESCRIPTION', exchangeFor: 'PRIVATE-TERMS', city: 'PRIVATE-ADDRESS', weighingHubId: 'PRIVATE-OPERATOR' };
  const measurement = { ...seed.measurements[0], id: 'PRIVATE-MEASUREMENT', batchId: batch.id, transferId: 'PRIVATE-TRANSFER', recordedBy: batch.sourceUserId, verifiedBy: 'PRIVATE-OPERATOR', facilityId: 'PRIVATE-FACILITY', method: 'PRIVATE-METHOD', note: 'PRIVATE-NOTE' };
  const transfer = { ...seed.transfers[0], id: 'PRIVATE-TRANSFER', batchId: batch.id, listingId: listing.id, offerId: 'PRIVATE-OFFER', providerId: batch.sourceUserId, recipientId: 'PRIVATE-RECIPIENT', agreedTerms: 'PRIVATE-TERMS', discrepancyReason: 'PRIVATE-REASON', events: [{ ...seed.transfers[0].events[0], id: 'PRIVATE-EVENT', actorId: batch.sourceUserId, actorName: 'PRIVATE-NAME', location: 'PRIVATE-ADDRESS', note: 'PRIVATE-NOTE', measurementId: measurement.id }] };
  const recovery = { ...seed.recoveryRecords[0], id: 'PRIVATE-RECOVERY', batchId: batch.id, transferId: transfer.id, facilityId: 'PRIVATE-FACILITY', organizationId: 'PRIVATE-ORG', recordedBy: 'PRIVATE-OPERATOR', validatedBy: 'PRIVATE-OPERATOR', note: 'PRIVATE-NOTE' };
  const facility = { ...seed.facilities[0], id: 'PRIVATE-FACILITY', organizationId: 'PRIVATE-ORG', name: 'PRIVATE-NAME', city: 'PRIVATE-ADDRESS', serviceAreas: ['PRIVATE-ADDRESS'] };
  const b = researchBatch(actor, batch), l = researchListing(actor, listing), m = researchMeasurement(actor, measurement), t = researchTransfer(actor, transfer), r = researchRecovery(actor, recovery), f = researchFacility(actor, facility);
  assert.ok(!JSON.stringify({ b, l, m, t, r, f }).includes('PRIVATE-'));
  assert.equal(b.id, l.batchId); assert.equal(b.id, m.batchId); assert.equal(b.id, t.batchId);
  assert.equal(t.id, m.transferId); assert.equal(t.id, r.transferId); assert.equal(t.listingId, l.id);
  assert.equal(l.ownerId, b.sourceUserId); assert.equal(t.providerId, l.ownerId); assert.equal(m.recordedBy, t.events[0].actorId);
  assert.equal(m.facilityId, f.id); assert.equal(r.facilityId, f.id); assert.equal(m.id, t.events[0].measurementId);
  assert.equal(b.declaredWeightKg, batch.declaredWeightKg); assert.equal(t.status, transfer.status); assert.equal(m.weightKg, measurement.weightKg);
  assert.deepEqual(researchBatch(actor, batch), b);
  assert.notEqual(researchBatch({ ...actor, id: 'OTHER-RESEARCHER' }, batch).id, b.id);
  assert.equal(batch.id, 'PRIVATE-BATCH'); assert.equal(transfer.agreedTerms, 'PRIVATE-TERMS');
});

test('government and researcher summaries and report downloads never expose participant or facility identities', async () => {
  const seed = await createSeedData(), store = new MemoryStore(seed), source = await loadDashboardAnalyticsSnapshot(store);
  const now = new Date('2026-10-22T04:00:00Z'), admin = seed.users[0];
  const original = JSON.stringify(source);
  for (const role of ['Government', 'Researcher'] as const) {
    const actor = { ...seed.users.find(user => user.role === role)!, scope: { ...admin.scope, aggregateOnly: false, canExport: true } };
    const dashboard = await buildDashboardAnalytics(store, actor, {}, source, now);
    assert.equal(dashboard.metadata.aggregateOnly, true);
    assert.deepEqual(dashboard.transactions, []); assert.deepEqual(dashboard.stakeholders, []);
    const outputs = [dashboard, await buildReport(store, actor, 'organizations', {}, source, now), await buildGovernanceDashboard(store, actor, {}, source, now), await buildHubDirectory(store, actor, {}, source), await buildHubDisposalMonitoring(store, actor, {}, now, source)];
    const encoded = JSON.stringify(outputs);
    for (const row of [...seed.users, ...seed.organizations, ...seed.facilities]) {
      assert.ok(!encoded.includes(row.id), `${role} leaked source identifier ${row.id}`);
      const name = 'fullName' in row ? row.fullName : row.name;
      assert.ok(!encoded.includes(name), `${role} leaked a participant or registry name`);
    }
    const expected = await buildDashboardAnalytics(store, admin, {}, source, now);
    assert.deepEqual(dashboard.circularFlow, expected.circularFlow);
    assert.deepEqual(dashboard.sharedActivity, expected.sharedActivity);
  }
  assert.equal(JSON.stringify(source), original);
  assert.equal(summaryActor(admin), admin);
});
