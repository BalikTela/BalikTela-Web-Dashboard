import type { RegionActivity } from '../types.js';

export type GeographicMetric = 'collectionKg' | 'recyclingKg' | 'wasteGapKg';
export const geographicMetrics: Array<{ key: GeographicMetric; label: string; description: string }> = [
  { key: 'collectionKg', label: 'Collected', description: 'Collected material' },
  { key: 'recyclingKg', label: 'Recycled', description: 'Verified recycled material' },
  { key: 'wasteGapKg', label: 'Recovery gap', description: 'Mass outside reuse or recycling outcomes' },
];

export function geographicValue(region: RegionActivity, metric: GeographicMetric) {
  return Number.isFinite(region[metric]) ? Math.max(0, region[metric]) : 0;
}

export function rankedRegions(regions: RegionActivity[], metric: GeographicMetric) {
  return [...regions].sort((a, b) => geographicValue(b, metric) - geographicValue(a, metric) || a.region.localeCompare(b.region));
}

export function markerDiameter(value: number, maximum: number) {
  return maximum > 0 && value > 0 ? 16 + 12 * Math.sqrt(Math.min(value / maximum, 1)) : 14;
}
