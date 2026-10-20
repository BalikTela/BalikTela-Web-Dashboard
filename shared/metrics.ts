export const MATERIAL_METRIC_LABELS = {
  declared: 'Total Textiles Declared',
  received: 'Textiles Physically Received',
  recyclableReceived: 'Recyclable Textiles Received',
} as const;

export function toTons(kilograms: number) { return kilograms / 1000; }
export function toKilograms(tons: number) { return Number((tons * 1000).toFixed(6)); }

export function formatMass(kilograms: number | null | undefined, missing = 'Pending'): string {
  if (kilograms == null || !Number.isFinite(kilograms)) return missing;
  const tons = toTons(kilograms);
  return `${tons.toLocaleString('en-PH', { maximumFractionDigits: Math.abs(kilograms) < 1 ? 6 : 3 })} t`;
}

export function percentage(numerator: number, denominator: number) {
  return denominator > 0 && Number.isFinite(numerator) && Number.isFinite(denominator)
    ? Number((numerator / denominator * 100).toFixed(1)) : 0;
}

export function hasDiscrepancy(discrepancyKg: number | null, referenceKg: number, thresholdPercent: number) {
  return referenceKg > 0 && Math.abs(discrepancyKg ?? 0) > 0 && Math.abs(discrepancyKg ?? 0) / referenceKg * 100 >= thresholdPercent;
}

export function changeDescription(current: number, previous: number, period: string) {
  if (previous <= 0) return current > 0 ? `No baseline activity · ${period}` : `No change · ${period}`;
  const change = Number(((current - previous) / previous * 100).toFixed(1));
  return `${change > 0 ? '+' : ''}${change}% vs ${period}`;
}

export function pointsDescription(current: number, total: number, previous: number, previousTotal: number, period: string) {
  if (total <= 0 || previousTotal <= 0) return `No comparable denominator · ${period}`;
  const points = Number(((current / total - previous / previousTotal) * 100).toFixed(1));
  return `${points > 0 ? '+' : ''}${points} pts vs ${period}`;
}
