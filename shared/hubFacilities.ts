import type { FacilityCapacityStatus } from './facilityCapacity.js';

export interface HubFacilityMetric {
  id: string;
  name: string;
  location: string;
  region: string;
  acceptedTypes: string[];
  operators: number;
  capacityKg: number;
  receivedKg: number | null;
  disposedKg: number | null;
  awaitingDisposalKg: number | null;
  utilization: number | null;
  remainingCapacityKg: number | null;
  batches: number;
  missingIntakeBatches: number;
  unattributedBatches: number;
  status: FacilityCapacityStatus | 'No operator assigned' | 'Intake incomplete';
}

export interface HubFacilityAnalytics {
  aggregateOnly: boolean;
  rows: HubFacilityMetric[];
  summary: {
    hubs: number;
    unassignedOperators: number;
    unattributedBatches: number;
    unattributedReceivedKg: number;
    unattributedDisposedKg: number | null;
  };
}
