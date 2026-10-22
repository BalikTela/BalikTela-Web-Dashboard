import type { DashboardSourceSnapshot } from './store.js';
import type { ListingRecord, MaterialBatchRecord, UserRecord } from './types.js';
import type { HubOperationsMonitoring } from '../shared/hubs.js';
import { isHubProfile, isHubWeighingMeasurement } from '../shared/hubs.js';
import { isTerminalTransfer, listingWorkflowStatus } from '../shared/workflows.js';
import { identifyHubOperators } from './stakeholders.js';
import { createHubCollectionEvidence } from './hubEvidence.js';
import { hubDisposalEvidence } from './hubDisposals.js';
import { hubDisposalBalance } from './hubBalance.js';
import { isHubSimulationBatch } from '../shared/hubStorage.js';

export function buildHubOperations(source: DashboardSourceSnapshot, batches: MaterialBatchRecord[], actor: UserRecord, periodLabel: string, now = new Date()): HubOperationsMonitoring {
  batches = batches.filter(item => !isHubSimulationBatch(item));
  const hubIds = identifyHubOperators(source, now), batchIds = new Set(batches.map(item => item.id));
  const users = new Map(source.users.map(item => [item.id, item]));
  const batchById = new Map(batches.map(item => [item.id,item]));
  const listings = [...new Map(source.listings.map(item => [item.id, item])).values()].filter(item => batchIds.has(item.batchId) && Date.parse(item.createdAt) <= now.getTime());
  const ledger = hubDisposalEvidence(source, batches, actor, now);
  const disposals = ledger.records;
  const listingById = new Map(listings.map(item => [item.id,item]));
  const recordedCollection = new Set<string>();
  const balances = new Map<string, ReturnType<typeof hubDisposalBalance>>();
  const records: HubOperationsMonitoring['records'] = [];
  const collectionFor = createHubCollectionEvidence(source, hubIds, now);
  for (const listing of listings.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const collection = collectionFor(listing.batchId);
    const disposal = disposals.filter(item => item.listingId === listing.id);
    const assignedId = listing.weighingHubId && hubIds.has(listing.weighingHubId) ? listing.weighingHubId : null;
    const operatorId = assignedId ?? collection?.operatorId ?? disposal[0]?.operatorId;
    if (!operatorId || listing.deliveryRoute === 'direct' && !collection && !disposal.length) continue;
    if (isHubProfile(actor) && actor.id !== operatorId && collection?.operatorId !== actor.id && !disposal.some(item => item.operatorId === actor.id)) continue;
    const batch = batchById.get(listing.batchId)!;
    const received = collection && (!isHubProfile(actor) || collection.operatorId === actor.id) && !recordedCollection.has(batch.id) ? collection : null;
    if (received) recordedCollection.add(batch.id);
    const firstBalance = !balances.has(batch.id);
    const scopedReceipt = collection && (!isHubProfile(actor) || collection.operatorId === actor.id) ? collection : null;
    if (firstBalance) balances.set(batch.id, hubDisposalBalance(source, batch.id, scopedReceipt, disposals, now));
    const balance = balances.get(batch.id)!;
    const disposedKg = disposal.filter(item => !isHubProfile(actor) || item.operatorId === actor.id).reduce((sum, item) => sum + item.weightKg, 0);
    const active = source.allTransfers.some(item => item.listingId === listing.id && !isTerminalTransfer(item.status));
    const state = listing.disposedAt ? 'Disposed' : disposedKg > 0 ? 'Partially disposed' : active ? 'Transfer active'
      : collection ? 'Collected' : ['Closed', 'Archived', 'Completed'].includes(listing.status) ? 'Closed' : 'Awaiting collection';
    records.push({ batchId: batch.id, listingId: listing.id, title: listing.title, owner: users.get(listing.ownerId)?.fullName ?? listing.ownerName,
      hub: users.get(operatorId)?.fullName ?? 'Hub not recorded', operatorId, region: batch.region || 'Not recorded', material: batch.materialCategory, state,
      collectionKg: received?.weightKg ?? null, collectionEvidence: received?.evidence ?? (collection ? 'Collection shown once per batch' : 'No collection receipt; listing weight is not intake'),
      disposedKg, remainingKg: listing.availableWeightKg === undefined ? null : listing.availableWeightKg,
      awaitingDisposalKg: firstBalance ? balance.awaitingDisposalKg : null,
      transferredOutKg: firstBalance ? balance.transferredOutKg : null,
      balanceStatus: firstBalance ? balance.balanceStatus : 'Shown once per batch',
      sentKg: null, sentWeightBasis: 'Not a consumer Hub submission',
      lastActivityAt: [listing.createdAt, collection?.at, ...disposal.map(item => item.disposedAt)].filter((item): item is string => Boolean(item)).sort().at(-1)! });
  }
  // Hub submissions are reported batch weights, separate from physical receipt evidence.
  const sent = new Map<string, { kg: number | null; listingId: string; basis: string }>();
  const validWeight = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value >= 0;
  const isConsumerSubmission = (listing: ListingRecord) => {
    const batch = batchById.get(listing.batchId)!;
    const workflow = listingWorkflowStatus(listing);
    return listing.deliveryRoute !== 'direct' && !listing.remainderOfId && workflow && workflow !== 'draft'
      && (users.get(batch.sourceUserId)?.role === 'Consumer' || users.get(listing.ownerId)?.role === 'Consumer');
  };
  const candidates = records.filter(row => isConsumerSubmission(listingById.get(row.listingId)!));
  const candidateIds = new Set(candidates.map(row => row.listingId));
  const assignments = new Map<string,Set<string>>();
  for (const listing of listings.filter(isConsumerSubmission)) {
    if (!listing.weighingHubId || !hubIds.has(listing.weighingHubId)) continue;
    if (!assignments.has(listing.batchId)) assignments.set(listing.batchId,new Set());
    assignments.get(listing.batchId)!.add(listing.weighingHubId);
  }
  for (const id of new Set(candidates.map(row => row.batchId))) {
    const matching = candidates.filter(row => row.batchId === id);
    const batch = batchById.get(id)!;
    const ambiguous = (assignments.get(id)?.size??0)>1 || new Set(matching.map(row => row.operatorId)).size>1;
    const kg = !ambiguous && validWeight(batch.declaredWeightKg) ? batch.declaredWeightKg : null;
    sent.set(id, { kg, listingId: matching[0].listingId, basis: ambiguous ? 'Hub assignment needs review' : kg === null ? 'Weight not recorded or needs review' : 'Declared batch weight' });
  }
  for (const row of records) {
    const contribution = sent.get(row.batchId);
    if (!contribution || !candidateIds.has(row.listingId)) continue;
    row.sentKg = contribution.listingId === row.listingId ? contribution.kg : null;
    row.sentWeightBasis = contribution.listingId === row.listingId ? contribution.basis : 'Shown once per batch';
  }
  const sentSummary = (ids: Set<string>) => {
    const values = [...sent].filter(([id]) => ids.has(id)).map(([,value]) => value.kg);
    const known = values.filter(validWeight);
    return { sentBatches: values.length, sentMissingWeights: values.length-known.length,
      sentKg: values.length && !known.length ? null : Number(known.reduce((sum,weight) => sum+weight,0).toFixed(6)) };
  };
  const measured = source.measurements.filter(item => batchIds.has(item.batchId) && isHubWeighingMeasurement(item) && Date.parse(item.timestamp) <= now.getTime()
    && (!isHubProfile(actor) || item.recordedBy === actor.id));
  const aggregateOnly = actor.scope.aggregateOnly || actor.role === 'Government' || actor.role === 'Researcher';
  return { aggregateOnly, periodLabel, disposalFeedAvailable: source.hubDisposals?.available ?? false,
    summary: { assigned: records.length, awaitingCollection: records.filter(item => item.state === 'Awaiting collection').length,
      collectedBatches: records.filter(item => item.collectionKg !== null).length,
      collectedKg: recordedCollection.size ? records.reduce((sum, item) => sum + (item.collectionKg ?? 0), 0) : null,
      disposedKg: ledger.available ? ledger.summary.disposedKg : null,
      disposalRecords: ledger.summary.records,
      legacyWeighings: measured.length, batches: balances.size,
      missingIntakeBatches: [...balances.values()].filter(item => item.balanceStatus === 'Intake not recorded').length,
      balancedBatches: [...balances.values()].filter(item => item.balanceStatus === 'Reconciled').length,
      awaitingDisposalKg: ledger.available && [...balances.values()].every(item => item.awaitingDisposalKg !== null)
        ? Number([...balances.values()].reduce((sum,item) => sum + item.awaitingDisposalKg!, 0).toFixed(6)) : null,
      invalidDisposalRecords: ledger.summary.invalidRecords, ...sentSummary(new Set(records.map(row => row.batchId))) },
    regions: [...new Set(records.map(item => item.region))].sort().map(region => {
      const rows = records.filter(item => item.region === region);
      const regionalBalances = [...new Set(rows.map(item => item.batchId))].map(id => balances.get(id)!);
      return { region, assigned: rows.length, ...sentSummary(new Set(rows.map(row => row.batchId))), collectedBatches: rows.filter(item => item.collectionKg !== null).length,
        collectedKg: rows.reduce((sum, item) => sum + (item.collectionKg ?? 0), 0), disposedKg: rows.reduce((sum, item) => sum + item.disposedKg, 0),
        awaitingDisposalKg: ledger.available && regionalBalances.every(item => item.awaitingDisposalKg !== null)
          ? Number(regionalBalances.reduce((sum,item) => sum + item.awaitingDisposalKg!, 0).toFixed(6)) : null };
    }), records: aggregateOnly ? [] : records.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)) };
}
