export type FacilityCapacityStatus = 'Available' | 'Near capacity' | 'At capacity' | 'Over capacity' | 'Capacity not configured' | 'Maintenance' | 'Inactive' | 'Pilot onboarding' | 'Aggregate only';

export function facilityCapacityStatus(utilization: number, capacityKg: number, operatingStatus: string): FacilityCapacityStatus {
  if (operatingStatus === 'Maintenance' || operatingStatus === 'Inactive' || operatingStatus === 'Pilot onboarding') return operatingStatus;
  if (!Number.isFinite(capacityKg) || capacityKg <= 0) return 'Capacity not configured';
  if (utilization > 100) return 'Over capacity';
  if (utilization === 100) return 'At capacity';
  if (utilization >= 85) return 'Near capacity';
  return 'Available';
}
