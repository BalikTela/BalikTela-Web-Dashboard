import assert from 'node:assert/strict';
import test from 'node:test';
import { createSeedData } from './seed.js';
import { MemoryStore, type DashboardSourceSnapshot } from './store.js';
import { loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { hasPermission, permissionsFor, resolveWebActor, scopeBatches } from './access-control.js';
import { buildHubOperations } from './hubOperations.js';
import { hubCollectionEvidence } from './hubEvidence.js';
import { aggregateMaterialEvidence } from './materialEvidence.js';
import { textileRecyclability } from '../shared/materialClassification.js';
import express from 'express';
import { authorize } from './access-control.js';
import { requireAuth, issueToken } from './auth.js';
import { registerHubRoutes } from './hubs.js';
import { buildDataQuality } from './dataQuality.js';

const now = new Date('2026-10-19T10:00:00Z');
async function fixture() {
  const data = await createSeedData();
  const consumer = data.users.find(item => item.role === 'Consumer')!;
  const hub = { ...structuredClone(data.users.find(item => item.role === 'Recycler')!), id: 'POLICY-HUB', role: 'BalikTela Hub' as const,
    organizationVerified: true, canonicalVerification: 'verified', accountStatus: 'Active' as const };
  const batch = { ...data.materialBatches[0], id: 'POLICY-BATCH', sourceUserId: consumer.id, condition: 'Good' as const,
    declaredWeightKg: 100, currentWeightKg: 100, createdAt: '2026-10-15T01:00:00Z' };
  const listing = { ...data.listings[0], id: 'POLICY-LISTING', batchId: batch.id, ownerId: consumer.id, deliveryRoute: 'via_hub' as const,
    weighingHubId: hub.id, quantityKg: 100, availableWeightKg: 100, reservedKg: 0, status: 'Open' as const, createdAt: batch.createdAt };
  const source: DashboardSourceSnapshot = { ...await loadDashboardAnalyticsSnapshot(new MemoryStore(data)),
    users: [...data.users, hub], allBatches: [batch], listings: [listing], allTransfers: [], recoveryRecords: [], measurements: [],
    hubDisposals: { available: true, records: [] } };
  return { source, hub, batch, listing, consumer, admin: data.users[0], measurement: data.measurements[0], recovery: data.recoveryRecords[0] };
}

test('Hub and Recycler web access is denied without rewriting their mobile roles or approvals', async () => {
  const { source, hub } = await fixture();
  const stored = { ...hub, role: 'Recycler' as const, stakeholder: undefined };
  const resolved = await resolveWebActor({ all: async (name: string) => name === 'listings' ? source.listings : [] } as never, stored);
  assert.equal(resolved.role, 'Recycler'); assert.equal(resolved.webHubOperator, undefined); assert.equal(stored.webHubOperator, undefined);
  assert.equal(resolved.organizationVerified, stored.organizationVerified);
  for (const actor of [hub, resolved, { ...stored, stakeholder: 'Collection personnel' }]) {
    for (const permission of ['offers.create', 'transfers.manage', 'recovery.create', 'recovery.manage', 'facilities.manage', 'analytics.predictive.read', 'weighing.read'] as const)
      assert.equal(hasPermission(actor, permission), false, permission);
    assert.equal(hasPermission(actor, 'hubs.read'), false);
    assert.equal(hasPermission({ ...actor, organizationVerified: false }, 'hubs.read'), false);
    assert.equal(hasPermission({ ...actor, accountStatus: 'Suspended' }, 'profile.read'), false);
  }
  assert.deepEqual(permissionsFor(stored), []);
  assert.deepEqual(permissionsFor({ ...stored, stakeholder: 'Recycler / Upcycler' }), []);
});

test('consumer recyclability assumption requires a posted own listing and does not manufacture intake or outcomes', async () => {
  const { source, batch, listing, measurement, hub, recovery } = await fixture(), original = structuredClone(source);
  assert.deepEqual(textileRecyclability(batch, source), { eligible: true, basis: 'Consumer listing assumption' });
  assert.equal(textileRecyclability(batch, { ...source, listings: [{ ...listing, status: 'Draft' }] }).eligible, false);
  assert.equal(textileRecyclability({ ...batch, sourceUserId: hub.id }, source).eligible, false);
  const flow = () => aggregateMaterialEvidence([batch], [], [], { ...source, measurements: source.measurements });
  assert.equal(flow().collectedKg, 0); assert.equal(flow().recyclableCollectedKg, 0);
  source.measurements.push({ ...measurement, id: 'LISTING-ONLY', batchId: batch.id, transferId: null, canonicalStage: 'listing',
    stage: 'Declaration', weightKg: 100, status: 'Verified', recordedBy: hub.id, timestamp: batch.createdAt });
  assert.equal(flow().recyclableCollectedKg, 0);
  const intake = { ...recovery, id: 'INTAKE', batchId: batch.id, stage: 'Collection' as const, status: 'Validated' as const,
    recordedBy: hub.id, validatedBy: hub.id, inputWeightKg: 100, outputWeightKg: 100, residualWeightKg: 0, lossWeightKg: 0 };
  const collected = aggregateMaterialEvidence([batch], [], [intake], { ...source, measurements: source.measurements });
  assert.equal(collected.recyclableCollectedKg, 100); assert.equal(collected.assumedRecyclableCollectedBatches, 1);
  assert.equal(collected.recycledKg, 0);
  assert.deepEqual(source.allBatches, original.allBatches);
  assert.deepEqual(source.listings, original.listings);
});

test('Hub assignment and legacy listing weights are not collection; physical receipts count once per batch', async () => {
  const { source, hub, admin, batch, listing, measurement } = await fixture();
  source.measurements.push({ ...measurement, id: 'OLD-WEIGHING', batchId: batch.id, transferId: null, canonicalStage: 'listing',
    stage: 'Declaration', recordedBy: hub.id, weightKg: 100, status: 'Verified', timestamp: batch.createdAt });
  let result = buildHubOperations(source, [batch], admin, 'All time', now);
  assert.equal(result.summary.collectedKg, null); assert.equal(result.summary.awaitingCollection, 1); assert.equal(result.summary.legacyWeighings, 1);
  const receipt = { ...source.measurements[0], id: 'COLLECTION', canonicalStage: 'collection' as const, stage: 'Receipt' as const };
  source.measurements.push(receipt, { ...receipt });
  source.listings.push({ ...listing, id: 'SECOND-LISTING' });
  result = buildHubOperations(source, [batch], admin, 'All time', now);
  assert.equal(result.summary.collectedKg, 100); assert.equal(result.summary.collectedBatches, 1);
  assert.equal(result.records.filter(item => item.collectionKg !== null).length, 1);
  source.measurements.push({ ...receipt, id: 'CORRECTED', weightKg: 95, supersedesMeasurementId: receipt.id });
  assert.equal(hubCollectionEvidence(source, batch.id, new Set([hub.id]), now)?.weightKg, 95);
  source.measurements.push({ ...receipt, id: 'CONFLICTING' });
  assert.equal(hubCollectionEvidence(source, batch.id, new Set([hub.id]), now), null);
});

test('Hub disposal is deduplicated, includes archived history and never becomes collection or landfill diversion', async () => {
  const { source, hub, admin, batch, listing } = await fixture();
  const disposal = { id: 'DISPOSAL', listingId: listing.id, operatorId: hub.id, listingTitle: listing.title, category: batch.materialCategory,
    ownerName: listing.ownerName, weightKg: 20, reason: 'Recorded handling', disposedAt: '2026-10-18T01:00:00Z' };
  source.hubDisposals!.records.push(disposal, { ...disposal }, { ...disposal, id: 'FUTURE', disposedAt: '2026-10-20T01:00:00Z' }, { ...disposal, id: 'INVALID', weightKg: -5 });
  source.listings[0] = { ...listing, status: 'Archived', disposedAt: disposal.disposedAt, availableWeightKg: 0 };
  const result = buildHubOperations(source, [batch], admin, 'All time', now);
  assert.equal(result.summary.disposedKg, 20); assert.equal(result.summary.disposalRecords, 1);
  assert.equal(result.summary.collectedKg, null); assert.equal(result.records[0].state, 'Disposed');
  const quality = buildDataQuality(admin, [batch], [], 5, now, source);
  assert.ok(quality.issues.some(item => item.category === 'Incomplete disposal evidence'));
  const government = { ...admin, role: 'Government' as const };
  const aggregate = buildHubOperations(source, [batch], government, 'All time', now);
  assert.deepEqual(aggregate.records, []); assert.equal(aggregate.summary.disposedKg, 20);
  source.hubDisposals = { available: false, records: [] };
  assert.equal(buildHubOperations(source, [batch], hub, 'All time', now).summary.disposedKg, null);
});

test('Hub scope excludes other operators and direct exchange listings without handling evidence', async () => {
  const { source, hub, admin, batch, listing } = await fixture();
  source.users.push({ ...hub, id: 'OTHER-HUB' });
  source.listings.push({ ...listing, id: 'OTHER-LISTING', weighingHubId: 'OTHER-HUB' });
  assert.deepEqual(buildHubOperations(source, [batch], hub, 'All time', now).records.map(item => item.listingId), [listing.id]);
  assert.deepEqual(scopeBatches(hub, [batch, { ...batch, id: 'PRIVATE', sourceUserId: 'PRIVATE', sourceOrganizationId: null, currentCustodianId: 'PRIVATE' }], source).map(item => item.id), [batch.id]);
  source.listings = [{ ...listing, deliveryRoute: 'direct', weighingHubId: null }];
  assert.equal(buildHubOperations(source, [batch], admin, 'All time', now).summary.assigned, 0);
});

test('consumer Hub submissions count declared batch weight once and stay cumulative after partial or full disposal', async () => {
  const {source,hub,admin,batch,listing}=await fixture(), original=structuredClone(source);
  source.listings.push({...listing},{...listing,id:'SAME-BATCH-SECOND-LISTING'});
  let result=buildHubOperations(source,[batch],admin,'All time',now);
  assert.equal(result.summary.sentKg,100);assert.equal(result.summary.sentBatches,1);assert.equal(result.summary.sentMissingWeights,0);
  assert.equal(result.records.filter(row=>row.sentKg!==null).length,1);
  assert.equal(result.summary.collectedKg,null,'Submission weights must not become physical receipts.');
  assert.equal(result.records.length,2,'Duplicate listing IDs must not create extra table records.');
  source.hubDisposals!.records=[{id:'SENT-DISPOSAL',listingId:listing.id,operatorId:hub.id,weightKg:20,reason:'Fixture disposal',disposedAt:'2026-10-18T01:00:00Z',listingTitle:listing.title,category:listing.textileType}];
  source.listings[0]={...listing,availableWeightKg:80,disposedWeightKg:20};
  result=buildHubOperations(source,[batch],admin,'All time',now);
  assert.equal(result.summary.sentKg,100);assert.equal(result.summary.disposedKg,20);
  source.hubDisposals!.records[0].weightKg=100;
  source.listings=source.listings.map(item=>({...item,status:'Archived',disposedAt:'2026-10-18T01:00:00Z',availableWeightKg:0}));
  result=buildHubOperations(source,[{...batch,currentStatus:'Archived',currentWeightKg:0}],admin,'All time',now);
  assert.equal(result.summary.sentKg,100);assert.equal(result.summary.disposedKg,100);
  assert.equal(result.regions.reduce((sum,row)=>sum+(row.sentKg??0),0),100);
  const aggregate=buildHubOperations(source,[batch],{...admin,role:'Government'},'All time',now);
  assert.deepEqual(aggregate.records,[]);assert.equal(aggregate.summary.sentKg,100);
  assert.deepEqual(source.allBatches,original.allBatches,'Analytics must never rewrite material data.');
});

test('Hub submission totals exclude direct exchanges, drafts, remainders and non-consumers, and disclose unknown weights', async () => {
  const {source,hub,admin,batch,listing}=await fixture();
  for(const excluded of [{...listing,deliveryRoute:'direct' as const},{...listing,status:'Draft' as const,canonicalStatus:'draft'},{...listing,remainderOfId:'ORIGINAL'}]){
    const result=buildHubOperations({...source,listings:[excluded]},[batch],admin,'All time',now);
    assert.equal(result.summary.sentKg,0);assert.equal(result.summary.sentBatches,0);
  }
  const producer=source.users.find(item=>item.role==='Producer')!;
  const nonConsumer=buildHubOperations({...source,listings:[{...listing,ownerId:producer.id}]},[{...batch,sourceUserId:producer.id}],admin,'All time',now);
  assert.equal(nonConsumer.summary.sentKg,0);
  for(const weight of [null,Number.NaN,-1]){
    const result=buildHubOperations(source,[{...batch,declaredWeightKg:weight}],admin,'All time',now);
    assert.equal(result.summary.sentKg,null);assert.equal(result.summary.sentMissingWeights,1);
  }
  const missing={...batch,id:'MISSING-SENT',declaredWeightKg:null};
  const mixed=buildHubOperations({...source,listings:[listing,{...listing,id:'MISSING-LISTING',batchId:missing.id}]},[batch,missing],admin,'All time',now);
  assert.equal(mixed.summary.sentKg,100);assert.equal(mixed.summary.sentBatches,2);assert.equal(mixed.summary.sentMissingWeights,1);
  const future=buildHubOperations({...source,listings:[{...listing,createdAt:'2027-01-01T00:00:00Z'}]},[batch],hub,'All time',now);
  assert.equal(future.summary.sentBatches,0);
});

test('Hub sent totals respect operator scope and withhold ambiguous multi-Hub batch attribution', async () => {
  const {source,hub,admin,batch,listing}=await fixture();
  const other={...hub,id:'OTHER-SENT-HUB'};
  source.users.push(other);
  const otherBatch={...batch,id:'OTHER-SENT-BATCH',declaredWeightKg:70};
  source.listings.push({...listing,id:'OTHER-SENT-LISTING',batchId:otherBatch.id,weighingHubId:other.id});
  const batches=[batch,otherBatch];
  assert.equal(buildHubOperations(source,batches,admin,'All time',now).summary.sentKg,170);
  assert.equal(buildHubOperations(source,batches,hub,'All time',now).summary.sentKg,100);
  assert.equal(buildHubOperations(source,batches,other,'All time',now).summary.sentKg,70);
  source.listings.push({...listing,id:'AMBIGUOUS-SENT-LISTING',weighingHubId:other.id});
  const conflict=buildHubOperations(source,batches,hub,'All time',now);
  assert.equal(conflict.summary.sentKg,null);assert.equal(conflict.summary.sentMissingWeights,1);
  assert.equal(conflict.records[0].sentWeightBasis,'Hub assignment needs review');
});

test('Hub operations API denies legacy Recycler sessions independently of client type and preserves mobile identity', async () => {
  const { source, hub, batch } = await fixture(), data = await createSeedData();
  const legacy = { ...hub, role: 'Recycler' as const };
  const store = new MemoryStore({ ...data, users: [...data.users, legacy], materialBatches: source.allBatches, listings: source.listings,
    measurements: [], recoveryRecords: [], transfers: [] });
  const sessionId = 'HUB-POLICY-SESSION';
  await store.createSession({ id: sessionId, userId: hub.id, client: 'api', tokenHash: 'fixture', usedTokenHashes: [], csrfHash: 'fixture',
    expiresAt: new Date(Date.now() + 60000).toISOString(), revokedAt: null, createdAt: now.toISOString(), updatedAt: now.toISOString() });
  const app = express(); registerHubRoutes(app, store);
  app.post('/api/processing-test', requireAuth, authorize(store, 'recovery.create'), (_req, res) => res.json({ accepted: true }));
  app.use((error: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(error.status ?? 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const headers = { authorization: `Bearer ${issueToken(hub.id, legacy.role, sessionId)}` };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/hub-operations`)).status, 401);
    const response = await fetch(`${base}/api/hub-operations?dateRange=All%20time`, { headers });
    assert.equal(response.status, 403); assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const body = await response.json(); assert.equal(body.code, 'WEB_ACCESS_DENIED'); assert.equal(body.records, undefined);
    assert.equal((await fetch(`${base}/api/hub-operations?region[]=private`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/api/processing-test`, { method: 'POST', headers })).status, 403);
    assert.equal((await fetch(`${base}/api/weighing`, { headers })).status, 403);
    assert.equal((await store.findById('users', hub.id))?.role, 'Recycler');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
