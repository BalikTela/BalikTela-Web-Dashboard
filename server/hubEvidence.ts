import type { DashboardSourceSnapshot } from './store.js';
import { isTerminalTransfer } from '../shared/workflows.js';
import { groupRecords } from './recordIndex.js';

const valid = (weight: number | null | undefined): weight is number => weight != null && Number.isFinite(weight) && weight >= 0;

export function hubCollectionEvidence(source: DashboardSourceSnapshot, batchId: string, hubIds: ReadonlySet<string>, now: Date) {
  return createHubCollectionEvidence(source, hubIds, now)(batchId);
}

export function createHubCollectionEvidence(source: DashboardSourceSnapshot, hubIds: ReadonlySet<string>, now: Date) {
  if (!hubIds.size) return (_batchId: string) => null;
  const cutoff = now.getTime();
  const collectionsByBatch = groupRecords([...new Map(source.recoveryRecords.map(item => [item.id, item])).values()].filter(item => item.stage === 'Collection'
    && item.status === 'Validated' && item.validatedBy && hubIds.has(item.recordedBy) && Date.parse(item.timestamp) <= cutoff), item => item.batchId);
  const allMeasurements = [...new Map(source.measurements.map(item => [item.id, item])).values()];
  const superseded = new Set(allMeasurements.filter(item => Date.parse(item.timestamp) <= cutoff).map(item => item.supersedesMeasurementId));
  const receivableTransfers = new Map<string, Set<string>>();
  for (const transfer of source.allTransfers) {
    if (isTerminalTransfer(transfer.status) && !['Completed', 'Processed'].includes(transfer.status)) continue;
    const key = JSON.stringify([transfer.batchId, transfer.recipientId]);
    if (!receivableTransfers.has(key)) receivableTransfers.set(key, new Set());
    receivableTransfers.get(key)!.add(transfer.id);
  }
  const measurementsByBatch = groupRecords(allMeasurements.filter(item => hubIds.has(item.recordedBy)
    && ['Measured', 'Verified'].includes(item.status) && valid(item.weightKg) && !superseded.has(item.id)
    && Date.parse(item.timestamp) <= cutoff && (item.canonicalStage === 'collection'
      || item.stage === 'Receipt' && item.transferId !== null
        && receivableTransfers.get(JSON.stringify([item.batchId, item.recordedBy]))?.has(item.transferId))), item => item.batchId);
  return (batchId: string) => {
    const collections = collectionsByBatch.get(batchId) ?? [];
    if (collections.length === 1) {
      const record = collections[0];
      if (valid(record.outputWeightKg) && valid(record.inputWeightKg) && record.outputWeightKg <= record.inputWeightKg + 0.001)
        return { weightKg: record.outputWeightKg, operatorId: record.recordedBy, facilityId: record.facilityId, evidence: 'Validated collection', at: record.timestamp };
    }
    if (collections.length) return null;
    const measurements = measurementsByBatch.get(batchId) ?? [];
    if (measurements.length !== 1) return null;
    const record = measurements[0];
    return { weightKg: record.weightKg, operatorId: record.recordedBy, facilityId: record.facilityId, evidence: `${record.status} collection receipt`, at: record.timestamp };
  };
}
