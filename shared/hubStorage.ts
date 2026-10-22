export const HUB_STORAGE_THRESHOLD_PERCENT = 90;
export const HUB_STOCK_ESTIMATE_METHOD = 'Administrative stock estimate';
export const HUB_SIMULATION_PREFIX = 'SYN-HUBSIM-V1-';
export const HUB_SIMULATION_PROFILE_NOTE = 'No physical activity. Disabled non-login simulation profile.';

export function isHubSimulationBatch(batch: { id: string; isDemo: boolean }) {
  return batch.isDemo && batch.id.startsWith(`${HUB_SIMULATION_PREFIX}BAT-`);
}

export function isStorageSimulationOperator(user: { id: string; authUserId: string | null; passwordHash: string | null; email: string; accountStatus: string; role: string; profile: { recyclingPractices: string } }) {
  return user.id.startsWith(`${HUB_SIMULATION_PREFIX}OP-`) && user.authUserId === null && user.passwordHash === null
    && user.accountStatus === 'Deactivated' && user.role === 'Recycler' && user.profile.recyclingPractices === HUB_SIMULATION_PROFILE_NOTE
    && user.email.endsWith('@simulation.baliktela.invalid');
}

// PoC storage limits, not monthly throughput targets or surveyed building capacities.
const illustrativeCapacities: Record<string, number> = {
  'FAC-001': 2000, 'FAC-002': 1500, 'FAC-003': 500,
  'SYN-FAC-CENTRAL-VISAYAS': 8000, 'SYN-FAC-DAVAO-REGION': 7500,
  'SYN-FAC-METRO-MANILA': 12000, 'SYN-FAC-WESTERN-VISAYAS': 7000,
};

export function illustrativeStorageCapacityKg(hubId: string) {
  return Object.prototype.hasOwnProperty.call(illustrativeCapacities, hubId) ? illustrativeCapacities[hubId] : 1000;
}

export function hubStorageCapacity(hub: { id: string; isDemo: boolean; storageCapacityKg?: number | null }) {
  if (hub.storageCapacityKg !== null && hub.storageCapacityKg !== undefined && Number.isFinite(hub.storageCapacityKg) && hub.storageCapacityKg > 0)
    return { capacityKg: hub.storageCapacityKg, capacitySource: 'Configured' as const };
  if (hub.isDemo && (hub.storageCapacityKg === null || hub.storageCapacityKg === undefined))
    return { capacityKg: illustrativeStorageCapacityKg(hub.id), capacitySource: 'Illustrative' as const };
  return { capacityKg: 0, capacitySource: 'Not configured' as const };
}

export type HubStorageStatus = 'Available' | 'Intake paused' | 'Stock not established' | 'Capacity not configured' | 'No approved operator' | 'Maintenance' | 'Inactive' | 'Pilot onboarding' | 'Aggregate only';
export interface HubStorageRow {
  id: string; name: string; location: string; region: string; acceptedTypes: string[];
  capacityKg: number; storedKg: number | null; reservedKg: number | null; disposedKg: number | null;
  capacitySource: 'Configured' | 'Illustrative' | 'Not configured' | 'Mixed';
  utilization: number | null; allocatedPercent: number | null; availableToReceiveKg: number | null;
  status: HubStorageStatus; selectable: boolean;
  containsSimulation: boolean; simulationOnly: boolean;
  estimatedStock?: boolean;
}
export interface HubStorageAnalytics {
  illustrativeCapacity: boolean; thresholdPercent: number; asOf: string; aggregateOnly: boolean;
  rows: HubStorageRow[];
  summary: { unattributedBatches: number };
}

export function storageAvailability(capacityKg: number, storedKg: number | null, reservedKg: number | null,
  operatingStatus: string, approved: boolean) {
  const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0;
  const known = valid(storedKg) && valid(reservedKg) && Number.isFinite(capacityKg) && capacityKg > 0;
  const thresholdKg = capacityKg * HUB_STORAGE_THRESHOLD_PERCENT / 100;
  const utilization = known ? Number((storedKg / capacityKg * 100).toFixed(1)) : null;
  const allocatedPercent = known ? Number(((storedKg + reservedKg) / capacityKg * 100).toFixed(1)) : null;
  const availableToReceiveKg = known ? Number(Math.max(0, thresholdKg - storedKg - reservedKg).toFixed(6)) : null;
  const operating = ['Maintenance', 'Inactive', 'Pilot onboarding'].includes(operatingStatus);
  // Compare kilograms, never rounded display percentages, at the admission boundary.
  const status: HubStorageStatus = operating ? operatingStatus as HubStorageStatus : !approved ? 'No approved operator'
    : !Number.isFinite(capacityKg) || capacityKg <= 0 ? 'Capacity not configured'
    : !known ? 'Stock not established' : storedKg + reservedKg >= thresholdKg ? 'Intake paused' : 'Available';
  return { utilization, allocatedPercent, availableToReceiveKg, status, selectable: status === 'Available' };
}
