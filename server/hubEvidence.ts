import type { DashboardSourceSnapshot } from './store.js';
import { isTerminalTransfer } from '../shared/workflows.js';

const valid = (weight: number | null | undefined): weight is number => weight != null && Number.isFinite(weight) && weight >= 0;

export function hubCollectionEvidence(source: DashboardSourceSnapshot, batchId: string, hubIds: ReadonlySet<string>, now: Date) {
  const collections = [...new Map(source.recoveryRecords.map(item => [item.id, item])).values()].filter(item => item.batchId === batchId && item.stage === 'Collection'
    && item.status === 'Validated' && item.validatedBy && hubIds.has(item.recordedBy) && Date.parse(item.timestamp) <= now.getTime());
  if (collections.length === 1) {
    const record = collections[0];
    if (valid(record.outputWeightKg) && valid(record.inputWeightKg) && record.outputWeightKg <= record.inputWeightKg + 0.001)
      return { weightKg: record.outputWeightKg, operatorId: record.recordedBy, facilityId: record.facilityId, evidence: 'Validated collection', at: record.timestamp };
  }
  if (collections.length) return null;
  const allMeasurements = [...new Map(source.measurements.map(item => [item.id, item])).values()];
  const superseded = new Set(allMeasurements.filter(item => Date.parse(item.timestamp) <= now.getTime()).map(item => item.supersedesMeasurementId));
  const measurements = allMeasurements.filter(item => item.batchId === batchId && hubIds.has(item.recordedBy)
    && ['Measured', 'Verified'].includes(item.status) && valid(item.weightKg) && !superseded.has(item.id)
    && Date.parse(item.timestamp) <= now.getTime() && (item.canonicalStage === 'collection'
      || item.stage === 'Receipt' && source.allTransfers.some(transfer => transfer.id === item.transferId && transfer.batchId === batchId
        && transfer.recipientId === item.recordedBy && (!isTerminalTransfer(transfer.status) || ['Completed', 'Processed'].includes(transfer.status)))));
  if (measurements.length !== 1) return null;
  const record = measurements[0];
  return { weightKg: record.weightKg, operatorId: record.recordedBy, facilityId: record.facilityId, evidence: `${record.status} collection receipt`, at: record.timestamp };
}
