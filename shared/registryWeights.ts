export const REGISTRY_WEIGHT_STATUSES = ['Estimated', 'Measured'] as const;
export type RegistryWeightStatus = typeof REGISTRY_WEIGHT_STATUSES[number];

export function registryWeightStatus(status: string | null | undefined): RegistryWeightStatus | null {
  if (status === 'Estimated') return 'Estimated';
  if (status === 'Measured' || status === 'Verified') return 'Measured';
  return null;
}

export function registryWeightFilter(status: string) {
  return registryWeightStatus(status) ?? 'All weight statuses';
}

export function matchesRegistryWeightStatus(status: string | null | undefined, selected: string) {
  const filter = registryWeightFilter(selected);
  return filter === 'All weight statuses' || registryWeightStatus(status) === filter;
}

export function registryBatchPayload(values: Record<string, unknown>, previous?: { weightStatus: string | null; declaredWeightKg: number | null }) {
  const payload = { ...values };
  // A two-label form must not downgrade existing verification during an unrelated edit.
  if (previous?.weightStatus === 'Verified' && payload.weightStatus === 'Measured'
    && payload.declaredWeightKg === previous.declaredWeightKg) delete payload.weightStatus;
  return payload;
}
