export const HUB_ROLE = 'BalikTela Hub' as const;
export const COMPATIBLE_HUB_ROLE = 'Recycler' as const;

export function isHubCandidate(user: { role: string }) {
  return user.role === HUB_ROLE || user.role === COMPATIBLE_HUB_ROLE;
}

export function isApprovedHub(user: { role: string; accountStatus: string; organizationVerified?: boolean; canonicalVerification?: string }) {
  return isHubCandidate(user) && user.accountStatus === 'Active'
    && user.organizationVerified === true && !['rejected', 'suspended'].includes(user.canonicalVerification ?? '');
}

export const MEASUREMENT_STAGES = ['declaration', 'listing', 'handover', 'collection', 'receipt', 'processing_input', 'recovery_output', 'rejection', 'loss', 'validation'] as const;
export type CanonicalMeasurementStage = typeof MEASUREMENT_STAGES[number];

export function measurementStageLabel(stage: string) {
  return ({ listing: 'Hub weighing', declaration: 'Declaration', handover: 'Handover', collection: 'Collection', receipt: 'Receipt',
    processing_input: 'Processing input', recovery_output: 'Recovery output', rejection: 'Rejection', loss: 'Loss', validation: 'Transfer validation' } as Record<string, string>)[stage] ?? stage;
}

export interface HubAccount {
  id: string; name: string; email: string; role: string; organization: string; organizationId: string | null; city: string; region: string; location: string;
  state: 'Approved' | 'Pending approval' | 'Suspended' | 'Rejected'; emailVerified: boolean; passwordInitialized: boolean;
  facilityIds: string[]; facilities: Array<{ id: string; name: string; status: string }>; assignedListings: number;
  awaitingWeighing: number; measurementCount: number; lastWeighedAt: string | null;
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
}
