import { formatMass, hasDiscrepancy, percentage } from '../shared/metrics.js';
import type { MaterialBatchRecord, TransferRecord, UserRecord } from './types.js';
import type { DashboardSourceSnapshot } from './store.js';
import { isCompletedTransfer } from '../shared/workflows.js';

export const QUALITY_CHECKS = [
  { label: 'Weight readiness', source: 'material_batches', meaning: 'Missing, estimated, negative and incomplete current weights.' },
  { label: 'Location completeness', source: 'material_batches', meaning: 'Missing structured city or region; text addresses are not inferred.' },
  { label: 'Custody and references', source: 'transfers / listings', meaning: 'Stale reservations and missing batch or listing links.' },
  { label: 'Weight discrepancies', source: 'transfers / configuration_versions', meaning: 'Absolute variance against handover weight, or agreed weight when handover is missing, using the configured threshold.' },
  { label: 'Completion evidence', source: 'transfers', meaning: 'Completed activity without independently verified weight; not a claim of final recycling.' },
  { label: 'Stage mass balance', source: 'recovery_records', meaning: 'Input must equal output plus rejects and processing loss; reversed records are excluded.' },
] as const;

export function buildDataQuality(actor: UserRecord, batches: MaterialBatchRecord[], transfers: TransferRecord[], threshold: number, now = new Date(), snapshot?: DashboardSourceSnapshot) {
  const issues = [
    ...batches.filter(item => item.declaredWeightKg === null || item.weightStatus === null).map(item => ({ id: `DQ-${item.id}-WEIGH`, severity: 'Warning', category: item.declaredWeightKg === null ? 'Awaiting weighing' : 'Incomplete weight evidence', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: item.declaredWeightKg === null ? `${item.materialCategory} has no declared material weight and is excluded from declared-mass totals until weighing evidence is available.` : `${item.materialCategory} has a declared weight but no evidence status. Its declared mass is retained; it is not verified mass.`, status: 'Open' })),
    ...batches.filter(item => item.weightStatus === 'Estimated').map(item => ({ id: `DQ-${item.id}-EST`, severity: 'Warning', category: 'Unverified measurement', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: `${item.materialCategory} has an estimated weight without measured or verified evidence.`, status: 'Open' })),
    ...batches.filter(item => item.currentStatus === 'Reserved' && now.getTime() - Date.parse(item.updatedAt) > 7 * 86400000).map(item => ({ id: `DQ-${item.id}-STALE`, severity: 'Warning', category: 'Stale workflow', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: 'Reserved material has no lifecycle update for more than seven days.', status: 'Open' })),
    ...transfers.filter(item => hasDiscrepancy(item.discrepancyKg, item.handoverWeightKg ?? item.agreedWeightKg, threshold)).map(item => ({ id: `DQ-${item.id}-VAR`, severity: 'Critical', category: 'Mass discrepancy', entityType: 'Transfer', entityId: actor.scope.aggregateOnly ? 'De-identified transfer' : item.id, description: `${formatMass(Math.abs(item.discrepancyKg ?? 0))} discrepancy meets or exceeds the ${threshold}% threshold of handover mass (agreed mass when handover is absent).`, status: item.discrepancyReason.trim() ? 'Documented' : 'Open' })),
    ...transfers.filter(item => isCompletedTransfer(item.status) && item.verifiedWeightKg === null).map(item => ({ id: `DQ-${item.id}-VERIFY`, severity: 'Warning', category: 'Transfer verification pending', entityType: 'Transfer', entityId: actor.scope.aggregateOnly ? 'De-identified transfer' : item.id, description: 'Transfer completion is recorded without an independently verified transfer weight. Final reuse or recycling requires separate validated outcome evidence.', status: 'Open' })),
    ...batches.filter(item => !item.city.trim() || !item.region.trim()).map(item => ({ id: `DQ-${item.id}-GEO`, severity: 'Warning', category: 'Location incomplete', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: 'Structured city or region is missing. Geographic attribution cannot be inferred from a free-text address.', status: 'Open' })),
    ...batches.filter(item => [item.declaredWeightKg,item.currentWeightKg].some(weight => weight !== null && (!Number.isFinite(weight) || weight < 0))).map(item => ({ id: `DQ-${item.id}-MASS`, severity: 'Critical', category: 'Invalid weight', entityType: 'Material batch', entityId: actor.scope.aggregateOnly ? 'De-identified batch' : item.id, description: 'Recorded weights must be finite, non-negative quantities.', status: 'Open' })),
  ];
  if (snapshot) {
    const batchIds = new Set(batches.map(item => item.id)), allBatchIds = new Set(snapshot.allBatches.map(item => item.id)), listingIds = new Set(snapshot.listings.map(item => item.id));
    for (const transfer of transfers) if (!allBatchIds.has(transfer.batchId) || !listingIds.has(transfer.listingId)) issues.push({ id: `DQ-${transfer.id}-LINK`, severity: 'Critical', category: 'Broken lifecycle reference', entityType: 'Transfer', entityId: actor.scope.aggregateOnly ? 'De-identified transfer' : transfer.id, description: 'The linked material batch or original listing is missing. Review the source history; do not recreate or silently replace the original record.', status: 'Open' });
    for (const record of snapshot.recoveryRecords.filter(item => batchIds.has(item.batchId) && item.status !== 'Reversed')) {
      const weights = [record.inputWeightKg,record.outputWeightKg,record.residualWeightKg,record.lossWeightKg ?? 0];
      if (weights.some(weight => weight === null || !Number.isFinite(weight) || weight < 0) || Math.abs(record.inputWeightKg - (record.outputWeightKg ?? 0) - (record.residualWeightKg ?? 0) - (record.lossWeightKg ?? 0)) > 0.01) issues.push({ id: `DQ-${record.id}-BALANCE`, severity: 'Critical', category: 'Stage mass imbalance', entityType: 'Recovery record', entityId: actor.scope.aggregateOnly ? 'De-identified recovery record' : record.id, description: 'Input, output, rejects and processing loss are missing, negative or do not balance within 0.01 kg.', status: 'Open' });
    }
  }
  const visibleIssues = actor.scope.aggregateOnly ? issues.map((item, index) => ({ ...item,
    id: `DQ-aggregate-${index}`,
    description: item.category === 'Mass discrepancy' ? `A scoped discrepancy meets or exceeds the ${threshold}% threshold. Record-level weights are restricted.` : item.description,
  })) : issues;
  return { thresholdPercent: threshold, checkedBatches: batches.length, checks: QUALITY_CHECKS, summary: { totalIssues: issues.length, critical: issues.filter(item => item.severity === 'Critical').length, warnings: issues.filter(item => item.severity === 'Warning').length, validationCoveragePercent: percentage(batches.filter(item => item.weightStatus === 'Verified').length, batches.length) }, issues: visibleIssues };
}
