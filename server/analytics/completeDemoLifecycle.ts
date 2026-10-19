import { encodeFlowEvent } from '../database/codecs.js';
import type { DatabaseShape, LifecycleEventRecord, MeasurementRecord, RecoveryRecord } from '../types.js';

export interface OperationalDemoData {
  domainTables: Array<[keyof DatabaseShape, DatabaseShape[keyof DatabaseShape]]>;
  flowEvents: Array<Record<string, unknown>>;
}

const round = (value: number) => Number(value.toFixed(6));

export function completeDemoLifecycle(source: OperationalDemoData): OperationalDemoData {
  const data = structuredClone(source);
  const table = <K extends keyof DatabaseShape>(name: K) => data.domainTables.find(([key]) => key === name)![1] as DatabaseShape[K];
  const batches = table('materialBatches'), transfers = table('transfers'), measurements = table('measurements');
  const listings = table('listings'), recovery = table('recoveryRecords');
  const originalBatches = batches.map(item => ({ ...item }));
  const completedRecovery: RecoveryRecord[] = [];
  for (const original of originalBatches) {
    if (!original.isDemo || !original.id.startsWith('SYN-BAT-')) throw new Error('Lifecycle completion only accepts generated SYN demo batches.');
    const portions = transfers.filter(item => item.batchId === original.id);
    const collection = recovery.find(item => item.batchId === original.id && item.stage === 'Collection');
    const sorting = recovery.find(item => item.batchId === original.id && item.stage === 'Sorting');
    const declaration = measurements.find(item => item.batchId === original.id && item.stage === 'Declaration');
    if (!collection || !sorting || !declaration || !portions.length || portions.length > 2
      || portions.some(item => !item.isDemo || !['Reuse', 'Recycling'].includes(item.circularOutcome ?? '') || item.verifiedWeightKg === null)
      || new Set(portions.map(item => item.circularOutcome)).size !== portions.length) throw new Error('Unexpected synthetic lifecycle layout.');
    const totalOutput = portions.reduce((sum, item) => sum + item.verifiedWeightKg!, 0);
    if (totalOutput <= 0 || totalOutput > sorting.outputWeightKg! || sorting.outputWeightKg! > collection.outputWeightKg!
      || collection.outputWeightKg! > original.declaredWeightKg!) throw new Error('Synthetic source mass does not reconcile.');
    let allocatedDeclared = 0, allocatedCollected = 0, allocatedSorted = 0;
    portions.forEach((transfer, index) => {
      const code = transfer.circularOutcome === 'Reuse' ? 'REU' : 'REC';
      const share = transfer.verifiedWeightKg! / totalOutput;
      // The last portion receives the arithmetic remainder, so splitting cannot create material.
      const declared = index === portions.length - 1 ? round(original.declaredWeightKg! - allocatedDeclared) : round(original.declaredWeightKg! * share);
      const collected = index === portions.length - 1 ? round(collection.outputWeightKg! - allocatedCollected) : round(collection.outputWeightKg! * share);
      const sorted = index === portions.length - 1 ? round(sorting.outputWeightKg! - allocatedSorted) : round(sorting.outputWeightKg! * share);
      allocatedDeclared += declared; allocatedCollected += collected; allocatedSorted += sorted;
      const batchId = index === 0 ? original.id : `${original.id}-${code}`;
      const note = `Synthetic lifecycle v2 (demo only). Disjoint ${code} portion of ${original.id}; not an additional copy of the source mass.`;
      const portion = { ...original, id: batchId, declaredWeightKg: declared,
        currentWeightKg: round(sorted - transfer.verifiedWeightKg!),
        circularPathway: transfer.circularOutcome!, condition: transfer.circularOutcome === 'Reuse' ? 'Reusable' as const : 'Recyclable' as const,
        currentStatus: sorted > transfer.verifiedWeightKg! ? 'Processing' as const : 'Recovered' as const };
      if (index === 0) Object.assign(batches.find(item => item.id === original.id)!, portion);
      else batches.push(portion);
      transfer.batchId = batchId;
      const listing = listings.find(item => item.id === transfer.listingId);
      if (!listing?.isDemo) throw new Error('Missing generated demo listing.');
      listing.batchId = batchId; listing.description = note;
      for (const measurement of measurements.filter(item => item.transferId === transfer.id)) measurement.batchId = batchId;
      const declaredMeasurement: MeasurementRecord = { ...declaration, id: index === 0 ? declaration.id : `${declaration.id}-${code}`, batchId, weightKg: declared, note };
      if (index === 0) Object.assign(declaration, declaredMeasurement); else measurements.push(declaredMeasurement);
      const collect: RecoveryRecord = { ...collection, id: index === 0 ? collection.id : `${collection.id}-${code}`, batchId, transferId: transfer.id,
        inputWeightKg: declared, outputWeightKg: collected, residualWeightKg: round(declared - collected), outcome: transfer.circularOutcome, note };
      const sort: RecoveryRecord = { ...sorting, id: index === 0 ? sorting.id : `${sorting.id}-${code}`, batchId, transferId: transfer.id,
        inputWeightKg: collected, outputWeightKg: sorted, residualWeightKg: round(collected - sorted), outcome: transfer.circularOutcome, note };
      const timestamp = new Date(Date.parse(transfer.updatedAt) - 30 * 60_000).toISOString();
      const outputId = `${transfer.id.replace('SYN-TRF-', 'SYN-MSR-')}-OUT`;
      const final: RecoveryRecord = { ...sort, id: `${transfer.id.replace('SYN-TRF-', 'SYN-RCV-')}-OUT`, stage: 'Recovery',
        inputWeightKg: transfer.verifiedWeightKg!, outputWeightKg: transfer.verifiedWeightKg!, residualWeightKg: 0, lossWeightKg: 0,
        timestamp, note: `${note} Validated final ${transfer.circularOutcome!.toLowerCase()} output; remaining collected stock is not a confirmed outcome.` };
      completedRecovery.push(collect, sort, final);
      measurements.push({ id: outputId, batchId, transferId: transfer.id, stage: 'Recovery', canonicalStage: 'recovery_output', facilityId: sort.facilityId,
        weightKg: final.outputWeightKg!, status: 'Verified', method: 'Synthetic final-output scale', recordedBy: final.recordedBy,
        verifiedBy: final.validatedBy, timestamp, note: final.note });
      const event: LifecycleEventRecord = { id: `${transfer.id.replace('SYN-TRF-', 'SYN-EVT-')}-OUT`, type: 'Processing', canonicalStage: 'processing',
        actorId: final.recordedBy, actorName: 'Synthetic recovery operator (demo)', timestamp, status: 'Completed',
        location: `${original.city}, ${original.region}`, note: final.note, measurementId: outputId, weightKg: final.outputWeightKg!, weightStatus: 'Verified' };
      transfer.events = [...transfer.events, event].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    });
  }
  data.domainTables = data.domainTables.map(([name, rows]) => name === 'recoveryRecords' ? [name, completedRecovery] : [name, rows]);
  data.flowEvents = transfers.flatMap(transfer => transfer.events.map((event, index) => {
    const { _id, ...row } = encodeFlowEvent(transfer.id, transfer.batchId, transfer.listingId, event, index + 1);
    return { id: String(_id), ...row };
  }));
  return data;
}
