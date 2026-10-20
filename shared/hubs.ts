export const HUB_ROLE = 'BalikTela Hub' as const;
export const COMPATIBLE_HUB_ROLE = 'Recycler' as const;

export function isHubProfile(user: { role: string; stakeholder?: string; webHubOperator?: boolean }) {
  return user.role === HUB_ROLE || user.role === COMPATIBLE_HUB_ROLE && (user.webHubOperator === true
    || ['hub', 'baliktela hub', 'collecting hub', 'collection personnel'].includes((user.stakeholder ?? '').trim().toLowerCase()));
}

export function isHubCandidate(user: { role: string }) {
  return user.role === HUB_ROLE || user.role === COMPATIBLE_HUB_ROLE;
}

export function isHubWeighingMeasurement(item: { canonicalStage?: string; transferId: string | null; method: string; status: string; weightKg: number }) {
  return Number.isFinite(item.weightKg) && item.weightKg > 0 && ['Measured', 'Verified'].includes(item.status)
    && (item.canonicalStage === 'listing' || item.canonicalStage === 'declaration' && item.transferId === null && /hub.*scale/i.test(item.method));
}

export function isApprovedHub(user: { role: string; accountStatus: string; organizationVerified?: boolean; canonicalVerification?: string }) {
  return isHubCandidate(user) && user.accountStatus === 'Active'
    && user.organizationVerified === true && !['rejected', 'suspended'].includes(user.canonicalVerification ?? '');
}

export const MEASUREMENT_STAGES = ['declaration', 'listing', 'handover', 'collection', 'receipt', 'processing_input', 'recovery_output', 'rejection', 'loss', 'validation'] as const;
export type CanonicalMeasurementStage = typeof MEASUREMENT_STAGES[number];

export function measurementStageLabel(stage: string) {
  return ({ listing: 'Listing weighing (legacy Hub history)', declaration: 'Declaration', handover: 'Handover', collection: 'Collection', receipt: 'Receipt',
    processing_input: 'Processing input', recovery_output: 'Recovery output', rejection: 'Rejection', loss: 'Loss', validation: 'Transfer validation' } as Record<string, string>)[stage] ?? stage;
}

export interface HubAccount {
  id: string; name: string; email: string; role: string; organization: string; organizationId: string | null; city: string; region: string; location: string;
  state: 'Approved' | 'Pending approval' | 'Suspended' | 'Rejected'; emailVerified: boolean; passwordInitialized: boolean;
  facilityIds: string[]; facilities: Array<{ id: string; name: string; status: string }>; assignedListings: number;
  awaitingWeighing: number; measurementCount: number; lastWeighedAt: string | null;
  awaitingCollection?: number; collectedKg?: number | null; disposedKg?: number | null; disposalRecords?: number;
}
export interface HubDirectory {
  aggregateOnly: boolean; hubs: HubAccount[]; regions: Array<{ region: string; operators: number; approved: number; pending: number }>;
  summary: { operators: number; approved: number; pending: number; suspended: number; awaitingWeighing: number; unassignedFacilities: number };
}
export interface WeighingTask {
  id: string; batchId: string; title: string; owner: string; hubId: string | null; hub: string; region: string; city: string;
  quantityKg: number | null; weightStatus: string | null; eligible: boolean; state: 'Awaiting weighing' | 'Weighed' | 'Locked'; createdAt: string;
}
export interface WeighingEntry {
  id: string; batchId: string; listingId: string | null; title: string; owner: string; operatorId: string; operator: string;
  facility: string; facilityId: string | null; weightKg: number; weightStatus: string; stage: string; measuredAt: string;
  note: string; current: boolean; listingStatus: string; recipients: Array<{ id: string; name: string; weightKg: number }>;
}
export interface WeighingMonitoring {
  aggregateOnly: boolean; tasks: WeighingTask[]; history: WeighingEntry[];
  regions: Array<{ region: string; awaiting: number; measurements: number; latestWeighedKg: number }>;
  summary: { awaiting: number; locked: number; measurements: number; latestWeighedKg: number; verifiedBatches: number; unweighedBatches: number };
}

export interface HubDisposalRecord {
  id: string; listingId: string; operatorId: string; listingTitle: string; category: string;
  weightKg: number; reason: string; disposedAt: string;
}
export interface HubDisposalMonitoring {
  available: boolean; aggregateOnly: boolean;
  summary: { records: number; disposedKg: number; listings: number; missingLinks: number; invalidRecords: number };
  records: Array<HubDisposalRecord & { batchId: string; operator: string; region: string; isDemo: boolean }>;
  landfillAvoidedKg: null;
  handling?: HubOperationsMonitoring['summary'];
}

export type HubBalanceStatus = 'Reconciled' | 'Intake not recorded' | 'Disposal feed unavailable' | 'Incomplete disposal records' | 'Transfer evidence incomplete' | 'Conflicting movements' | 'Shown once per batch';

export interface HubOperationsMonitoring {
  aggregateOnly: boolean;
  periodLabel: string;
  disposalFeedAvailable: boolean;
  summary: { assigned: number; awaitingCollection: number; collectedBatches: number; collectedKg: number | null; disposedKg: number | null; disposalRecords: number; legacyWeighings: number;
    batches: number; missingIntakeBatches: number; balancedBatches: number; awaitingDisposalKg: number | null; invalidDisposalRecords: number;
    sentKg: number | null; sentBatches: number; sentMissingWeights: number };
  records: Array<{ batchId: string; listingId: string; title: string; owner: string; hub: string; operatorId: string;
    region: string; material: string; state: 'Awaiting collection' | 'Collected' | 'Partially disposed' | 'Disposed' | 'Transfer active' | 'Closed';
    collectionKg: number | null; collectionEvidence: string; disposedKg: number; remainingKg: number | null; lastActivityAt: string;
    awaitingDisposalKg: number | null; transferredOutKg: number | null; balanceStatus: HubBalanceStatus;
    sentKg: number | null; sentWeightBasis: string }>;
  regions: Array<{ region: string; assigned: number; collectedBatches: number; collectedKg: number; disposedKg: number; awaitingDisposalKg: number | null;
    sentKg: number | null; sentBatches: number; sentMissingWeights: number }>;
}
