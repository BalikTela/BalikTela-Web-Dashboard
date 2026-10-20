import { percentage } from '../shared/metrics.js';
import { isCompletedTransfer, isTerminalTransfer } from '../shared/workflows.js';
import type { ListingRecord, MaterialBatchRecord, MeasurementRecord, RecoveryRecord, TransferRecord } from './types.js';
import { textileRecyclability } from '../shared/materialClassification.js';
import { recoveryMassBalance } from '../shared/recovery.js';

const validMass = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value >= 0;
const round = (value: number) => Number(value.toFixed(6));
const unique = <T extends { id: string }>(items: T[]) => [...new Map(items.map(item => [item.id, item])).values()];
const reuseOutcomes = new Set(['Reuse', 'Repair', 'Redistribution', 'Upcycling']);

export interface EvidenceContext { measurements?: MeasurementRecord[]; listings?: ListingRecord[]; users?: Array<{ id: string; role: string }> }

export function aggregateMaterialEvidence(batches: MaterialBatchRecord[], transfers: TransferRecord[], recovery: RecoveryRecord[], context: EvidenceContext = {}) {
  const selected = unique(batches);
  const ids = new Set(selected.map(item => item.id));
  const linked = unique(transfers).filter(item => ids.has(item.batchId));
  const completed = linked.filter(item => isCompletedTransfer(item.status));
  const records = unique(recovery).filter(item => ids.has(item.batchId) && item.status === 'Validated' && item.validatedBy);
  const measurements = unique(context.measurements ?? []);
  const superseded = new Set(measurements.map(item => item.supersedesMeasurementId).filter(Boolean));
  const listings = context.listings ?? [];
  // Cross-batch remainders need a root-lot allocation contract before they can be added as new material.
  const remainderBatches = new Set(listings.filter(item => item.remainderOfId).map(item => item.batchId));
  let generatedKg = 0, collectedKg = 0, sortedKg = 0, reusedKg = 0, recycledKg = 0;
  let recyclableCollectedKg = 0, recyclableCollectedBatches = 0;
  let assumedRecyclableCollectedBatches = 0;
  let matchedDiversionKg = 0, matchedSortedKg = 0, matchedSortedOutcomeKg = 0;
  let collectedBatches = 0, sortedBatches = 0, reuseRecords = 0, recyclingRecords = 0, collectionConflicts = 0, outcomeConflicts = 0;
  let unlinkedOutcomeKg = 0, unresolvedCollectedKg = 0, outcomeEvidenceBatches = 0, matchedOutcomeBatches = 0;
  const confirmedOutputs: Array<{ batchId: string; transferId: string; facilityId: string; kilograms: number }> = [];

  for (const batch of selected) {
    generatedKg += validMass(batch.declaredWeightKg) ? batch.declaredWeightKg : 0;
    const batchRecords = records.filter(item => item.batchId === batch.id);
    const batchTransfers = linked.filter(item => item.batchId === batch.id);
    const collection = batchRecords.filter(item => item.stage === 'Collection');
    let intake: number | null = null;
    if (collection.length === 1 && !remainderBatches.has(batch.id)) {
      const record = collection[0];
      if (validMass(record.outputWeightKg) && validMass(record.inputWeightKg) && record.outputWeightKg <= record.inputWeightKg + 0.001) intake = record.outputWeightKg;
      else if (record.outputWeightKg !== null) collectionConflicts++;
    }
    else if (collection.length > 1 || remainderBatches.has(batch.id)) collectionConflicts++;
    else {
      // A verified receipt proves physical intake; a declaration, listing weighing or completion flag does not.
      const receipts = measurements.filter(item => item.batchId === batch.id && !superseded.has(item.id)
        && (item.stage === 'Receipt' || item.canonicalStage === 'collection')
        && item.status === 'Verified' && item.verifiedBy && validMass(item.weightKg)
        && batchTransfers.some(transfer => transfer.id === item.transferId
          && (!isTerminalTransfer(transfer.status) || isCompletedTransfer(transfer.status))));
      if (receipts.length === 1 && batchTransfers.length === 1) intake = receipts[0].weightKg;
      else if (receipts.length) collectionConflicts++;
    }
    if (intake !== null) {
      collectedKg += intake; collectedBatches++;
      const recyclability = textileRecyclability(batch, context);
      if (recyclability.eligible) {
        recyclableCollectedKg += intake; recyclableCollectedBatches++;
        if (recyclability.basis === 'Consumer listing assumption') assumedRecyclableCollectedBatches++;
      }
    }
    const sorting = batchRecords.filter(item => item.stage === 'Sorting');
    const sorted = sorting.length === 1 && validMass(sorting[0].inputWeightKg) && validMass(sorting[0].outputWeightKg)
      && sorting[0].outputWeightKg! <= sorting[0].inputWeightKg + 0.001 ? sorting[0].outputWeightKg : null;
    if (sorted !== null) sortedBatches++;
    sortedKg += sorted ?? 0;

    const finalRecords = batchRecords.filter(item => ['Processing', 'Recovery'].includes(item.stage)
      && (item.outcome === 'Recycling' || reuseOutcomes.has(item.outcome ?? '')));
    const groups = new Map<string, RecoveryRecord[]>();
    for (const record of finalRecords) {
      const key = JSON.stringify([record.transferId, record.outcome]);
      groups.set(key, [...groups.get(key) ?? [], record]);
    }
    const outcomes: RecoveryRecord[] = [];
    let conflict = false;
    for (const group of groups.values()) {
      // Recovery is the final output when both processing and recovery describe the same portion.
      const final = group.some(item => item.stage === 'Recovery') ? group.filter(item => item.stage === 'Recovery') : group;
      if (final.length !== 1) { conflict = true; continue; }
      const record = final[0];
      const transfer = completed.find(item => item.id === record.transferId && item.batchId === batch.id);
      if (!transfer) continue;
      if (record.outputWeightKg === null) continue;
      if (!validMass(record.outputWeightKg)) { conflict = true; continue; }
      const loss = record.lossWeightKg ?? 0;
      if (!validMass(record.inputWeightKg) || !validMass(loss) || !validMass(record.residualWeightKg)
        || recoveryMassBalance(record) !== 'Balanced'
        || validMass(transfer.verifiedWeightKg) && record.inputWeightKg > transfer.verifiedWeightKg + 0.001) {
        conflict = true; continue;
      }
      outcomes.push(record);
    }
    // Distinct transfers/listings do not prove distinct portions of the original material.
    if (outcomes.length > 1 || remainderBatches.has(batch.id)) conflict = outcomes.length > 0 || conflict;
    const input = outcomes.reduce((sum, item) => sum + item.inputWeightKg, 0);
    const output = outcomes.reduce((sum, item) => sum + item.outputWeightKg!, 0);
    if (intake !== null && input > intake + 0.001) conflict = true;
    if (conflict) { outcomeConflicts++; if (intake !== null) unresolvedCollectedKg += intake; continue; }
    if (outcomes.length) outcomeEvidenceBatches++;
    for (const record of outcomes) {
      confirmedOutputs.push({ batchId: batch.id, transferId: record.transferId, facilityId: record.facilityId, kilograms: record.outputWeightKg! });
      if (record.outcome === 'Recycling') { recycledKg += record.outputWeightKg!; recyclingRecords++; }
      else { reusedKg += record.outputWeightKg!; reuseRecords++; }
    }
    if (intake !== null) {
      if (outcomes.length) matchedOutcomeBatches++;
      matchedDiversionKg += output;
      unresolvedCollectedKg += intake - output;
      if (sorted !== null && sorted > 0 && input <= sorted + 0.001 && outcomes.length) {
        matchedSortedKg += sorted; matchedSortedOutcomeKg += output;
      }
    } else unlinkedOutcomeKg += output;
  }
  const approvedWeight = (transfer: TransferRecord) => {
    const readings = measurements.filter(item => item.transferId === transfer.id && item.batchId === transfer.batchId
      && item.stage === 'Validation' && !superseded.has(item.id));
    const reading = readings.length === 1 ? readings[0] : null;
    return reading?.status === 'Verified' && reading.verifiedBy && validMass(reading.weightKg) ? reading.weightKg : null;
  };
  const finalWeights = completed.map(transfer => {
    const approved = approvedWeight(transfer);
    return { approved, value: approved ?? (validMass(transfer.receiptWeightKg) ? transfer.receiptWeightKg : null) };
  });
  const knownCompleted = finalWeights.filter(item => item.value !== null);
  const completedKg = knownCompleted.reduce((sum, item) => sum + item.value!, 0);
  return {
    generatedKg: round(generatedKg), collectedKg: round(collectedKg), sortedKg: round(sortedKg),
    recyclableCollectedKg: round(recyclableCollectedKg), recyclableCollectedBatches, assumedRecyclableCollectedBatches,
    reusedKg: round(reusedKg), recycledKg: round(recycledKg), transactionCount: completed.length,
    completedKg: round(completedKg), completedWithWeight: knownCompleted.length,
    completedMissingWeight: completed.length - knownCompleted.length,
    completedReportedWeight: knownCompleted.filter(item => item.approved === null).length,
    collectedBatches, sortedBatches, missingCollectionBatches: selected.length - collectedBatches,
    reuseRecords, recyclingRecords, outcomeEvidenceBatches, collectionConflicts, outcomeConflicts,
    matchedDiversionKg: round(matchedDiversionKg), unlinkedOutcomeKg: round(unlinkedOutcomeKg),
    unresolvedCollectedKg: round(unresolvedCollectedKg),
    diversionRate: collectedKg > 0 && matchedOutcomeBatches > 0 && !collectionConflicts && !outcomeConflicts
      ? percentage(matchedDiversionKg, collectedKg) : null,
    sortingYield: matchedSortedKg > 0 ? percentage(matchedSortedOutcomeKg, matchedSortedKg) : null,
    confirmedOutputs,
  };
}
