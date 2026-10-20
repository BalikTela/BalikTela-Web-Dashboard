import { isApprovedHub, isHubProfile, isHubWeighingMeasurement } from '../shared/hubs.js';
import { isCompletedTransfer, isTerminalTransfer } from '../shared/workflows.js';
import { percentage } from '../shared/metrics.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { FacilityRecord, MaterialBatchRecord, TransferRecord, UserRecord } from './types.js';
import type { aggregateMaterialEvidence } from './materialEvidence.js';
import { hubCollectionEvidence } from './hubEvidence.js';
import { hubDisposalEvidence } from './hubDisposals.js';

type Sources = Pick<DashboardSourceSnapshot, 'users' | 'listings' | 'measurements' | 'hubDisposals'>;

export function identifyHubOperators(source: Sources, now = new Date()) {
  // Legacy Recycler profiles need explicit Hub metadata or workflow evidence, never a name-based guess.
  const assigned = new Set(source.listings.filter(item => Date.parse(item.createdAt) <= now.getTime()).map(item => item.weighingHubId));
  const measured = new Set(source.measurements.filter(item => isHubWeighingMeasurement(item) && Date.parse(item.timestamp) <= now.getTime()).map(item => item.recordedBy));
  const disposed = new Set(source.hubDisposals?.records.filter(item => Date.parse(item.disposedAt) <= now.getTime()).map(item => item.operatorId));
  return new Set(source.users.filter(user => isHubProfile(user) || user.role === 'Recycler'
    && (assigned.has(user.id) || measured.has(user.id) || disposed.has(user.id))).map(user => user.id));
}

export function buildStakeholderView(batches: MaterialBatchRecord[], transfers: TransferRecord[], source: DashboardSourceSnapshot,
  facilities: FacilityRecord[], facilityMetrics: Array<{ id: string; capacityKg: number; intakeKg: number }>,
  outputs: ReturnType<typeof aggregateMaterialEvidence>['confirmedOutputs'], actor: UserRecord, query: Record<string, unknown>, now: Date) {
  const hubIds = identifyHubOperators(source,now), batchIds = new Set(batches.map(item => item.id));
  const listings = source.listings.filter(item => batchIds.has(item.batchId));
  const measurements = source.measurements.filter(item => batchIds.has(item.batchId) && Date.parse(item.timestamp) <= now.getTime());
  const history = measurements.filter(isHubWeighingMeasurement).sort((a,b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
  const superseded = new Set(measurements.map(item => item.supersedesMeasurementId).filter(Boolean));
  const latest = new Map<string, typeof history[number]>();
  for (const entry of history) if (!superseded.has(entry.id) && !latest.has(entry.batchId)) latest.set(entry.batchId, entry);
  const collections = batches.map(batch => ({ batchId: batch.id, evidence: hubCollectionEvidence(source, batch.id, hubIds, now) }));
  const scopedDisposals = hubDisposalEvidence(source, batches, actor, now).records;
  const participants = new Set([...batches.map(item => item.sourceUserId), ...transfers.flatMap(item => [item.providerId, item.recipientId]),
    ...listings.map(item => item.weighingHubId), ...history.map(item => item.recordedBy),
    ...collections.map(item => item.evidence?.operatorId), ...scopedDisposals.map(item => item.operatorId)]);
  const activeTransferListings = new Set(source.allTransfers.filter(item => !isTerminalTransfer(item.status)).map(item => item.listingId));
  const noMaterialFilter = (!query.textileType || query.textileType === 'All textiles') && (!query.materialCategory || query.materialCategory === 'All textiles')
    && ['producer','recycler'].every(key => !String(query[key] ?? '').trim())
    && [['wasteSource','All sources'],['circularPathway','All pathways'],['weightStatus','All weight statuses'],['transactionType','All types'],['transactionStatus','All statuses']].every(([key,all]) => !query[key] || query[key] === all);
  const registeredHubVisible = (user: UserRecord) => {
    if (!hubIds.has(user.id) || !noMaterialFilter) return false;
    if (actor.role !== 'Administrator' && actor.role !== 'Researcher' && actor.id !== user.id) return false;
    if (actor.role !== 'Administrator' && actor.scope.regions.length && !actor.scope.regions.includes(user.region)) return false;
    return (!query.region || query.region === 'All regions' || query.region === user.region)
      && (!query.city || user.city.toLowerCase().includes(String(query.city).trim().toLowerCase()))
      && (!query.organizationId || query.organizationId === 'All organizations' || query.organizationId === user.organizationId)
      && (!query.facilityId || query.facilityId === 'All facilities' || user.scope.facilityIds.includes(String(query.facilityId)))
      && (!query.stakeholderType || ['All stakeholders','Administrator','BalikTela Hub'].includes(String(query.stakeholderType)));
  };
  return source.users.filter(user => participants.has(user.id) || registeredHubVisible(user)).map(user => {
    const assigned = listings.filter(item => item.weighingHubId === user.id);
    const userHistory = history.filter(item => item.recordedBy === user.id);
    const disposalHistory = scopedDisposals.filter(item => item.operatorId === user.id);
    const collection = collections.filter(item => item.evidence?.operatorId === user.id).map(item => item.evidence!);
    const hubBatchIds = new Set([...assigned.map(item => item.batchId), ...userHistory.map(item => item.batchId),
      ...collections.filter(item => item.evidence?.operatorId === user.id).map(item => item.batchId),
      ...listings.filter(item => disposalHistory.some(record => record.listingId === item.id)).map(item => item.batchId)]);
    const isHub = hubIds.has(user.id);
    const relatedTransfers = transfers.filter(item => item.providerId === user.id || item.recipientId === user.id || isHub && hubBatchIds.has(item.batchId));
    const recipientIds = new Set(transfers.filter(item => item.recipientId === user.id).map(item => item.id));
    const userOutputs = outputs.filter(item => recipientIds.has(item.transferId));
    const owned = isHub ? facilityMetrics.filter(item => user.scope.facilityIds.includes(item.id)) : [];
    const capacity = owned.reduce((sum,item) => sum + item.capacityKg,0), intake = owned.reduce((sum,item) => sum + item.intakeKg,0);
    const capacityComplete = owned.length > 0 && owned.every(item => item.capacityKg > 0);
    const current = [...latest.values()].filter(item => item.recordedBy === user.id);
    const hubFacilities = facilities.filter(item => user.scope.facilityIds.includes(item.id));
    const state = ['Suspended','Deactivated'].includes(user.accountStatus) || user.canonicalVerification === 'suspended' ? 'Suspended' as const
      : user.canonicalVerification === 'rejected' ? 'Rejected' as const : isApprovedHub(user) ? 'Approved' as const : 'Pending approval' as const;
    return { id:user.id,name:isHub ? user.fullName : user.organization || user.fullName,type:isHub ? 'BalikTela Hub' as const : user.role,accountRole:user.role,
      city:user.city,region:user.region,recoveredKg:round(userOutputs.reduce((sum,item) => sum + item.kilograms,0)),recoveredAvailable:userOutputs.length>0,
      generatedKg:round(batches.filter(item => item.sourceUserId === user.id).reduce((sum,item) => sum + (item.declaredWeightKg ?? 0),0)),
      capacityKg:capacity || undefined,utilization:capacityComplete ? percentage(intake,capacity) : undefined,
      participation:percentage(relatedTransfers.filter(item => isCompletedTransfer(item.status)).length,relatedTransfers.length),transactions:relatedTransfers.length,
      linkedTransferIds:relatedTransfers.map(item => item.id),verification:user.verification,reliabilityPlaceholder:user.trustPlaceholder,
      sustainabilityActivities:user.profile.sustainabilityInterests,joinedAt:user.joinedAt.slice(0,10),
      hubActivity:isHub ? {state,assignedListings:assigned.length,awaitingWeighing:assigned.filter(item => item.quantityKg === null && !item.disposedAt && !(item.disposedWeightKg ?? 0)
        && !item.remainderPending && !(item.reservedKg ?? 0) && !activeTransferListings.has(item.id)
        && (item.canonicalStatus ? ['draft','available','archived'].includes(item.canonicalStatus) : item.status === 'Open')).length,
        measurements:userHistory.length,latestWeighedKg:current.length ? round(current.reduce((sum,item) => sum + item.weightKg,0)) : null,
        lastWeighedAt:userHistory[0]?.timestamp ?? null,facilities:hubFacilities.map(item => ({id:item.id,name:item.name})),
        collectedBatches:collection.length,collectedKg:collection.length ? round(collection.reduce((sum,item) => sum + item!.weightKg,0)) : null,
        disposalRecords:disposalHistory.length,disposedKg:source.hubDisposals?.available ? round(disposalHistory.reduce((sum,item) => sum + item.weightKg,0)) : null} : undefined,
      isDemo:source.organizations.some(item => item.id === user.organizationId && item.recordLabel === 'Demo') };
  }).sort((a,b) => b.transactions-a.transactions || a.name.localeCompare(b.name));
}

function round(value:number){return Number(value.toFixed(6));}
