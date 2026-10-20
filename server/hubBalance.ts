import type { HubBalanceStatus, HubDisposalMonitoring } from '../shared/hubs.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { hubCollectionEvidence } from './hubEvidence.js';

const valid = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value >= 0;
const physicalStates = new Set(['Handed over', 'Collected', 'Received', 'Processing', 'Validated', 'Completed', 'Processed']);

export function hubDisposalBalance(source: DashboardSourceSnapshot, batchId: string,
  receipt: ReturnType<typeof hubCollectionEvidence>, disposals: HubDisposalMonitoring['records'], now: Date) {
  const unavailable = (status: HubBalanceStatus) => ({ awaitingDisposalKg: null, transferredOutKg: null, balanceStatus: status });
  if (!receipt) return unavailable('Intake not recorded');
  if (!source.hubDisposals?.available) return unavailable('Disposal feed unavailable');
  const cutoff = now.getTime(), receivedAt = Date.parse(receipt.at);
  const listings = source.listings.filter(item => item.batchId === batchId && Date.parse(item.createdAt) <= cutoff);
  const listingIds = new Set(listings.map(item => item.id));
  const ledger = disposals.filter(item => item.batchId === batchId);
  const accepted = new Set(ledger.map(item => item.id));
  if (source.hubDisposals.records.some(item => listingIds.has(item.listingId) && item.operatorId === receipt.operatorId
    && !(Date.parse(item.disposedAt) > cutoff) && !accepted.has(item.id))) return unavailable('Incomplete disposal records');
  const operators = new Set([receipt.operatorId, ...listings.map(item => item.weighingHubId).filter(Boolean), ...ledger.map(item => item.operatorId)]);
  if (operators.size > 1 || ledger.some(item => Date.parse(item.disposedAt) < receivedAt)) return unavailable('Conflicting movements');

  const measurements = source.measurements.filter(item => item.batchId === batchId && Date.parse(item.timestamp) <= cutoff);
  const superseded = new Set(measurements.map(item => item.supersedesMeasurementId).filter(Boolean));
  const current = [...new Map(measurements.map(item => [item.id, item])).values()].filter(item => !superseded.has(item.id));
  const transfers = [...new Map(source.allTransfers.filter(item => item.batchId === batchId).map(item => [item.id, item])).values()];
  if (current.some(item => item.recordedBy === receipt.operatorId && (item.stage === 'Handover' || item.canonicalStage === 'handover')
    && Date.parse(item.timestamp) < receivedAt)) return unavailable('Conflicting movements');
  if (current.some(item => item.recordedBy === receipt.operatorId && (item.stage === 'Handover' || item.canonicalStage === 'handover')
    && Date.parse(item.timestamp) >= receivedAt && !transfers.some(transfer => transfer.id === item.transferId))) return unavailable('Transfer evidence incomplete');
  let transferredOutKg = 0;
  for (const transfer of transfers) {
    if (transfer.recipientId === receipt.operatorId) continue;
    if (transfer.providerId === receipt.operatorId && physicalStates.has(transfer.status) && valid(transfer.handoverWeightKg)
      && Date.parse(transfer.updatedAt) < receivedAt) return unavailable('Conflicting movements');
    const readings = current.filter(item => item.transferId === transfer.id && item.recordedBy === receipt.operatorId
      && (item.stage === 'Handover' || item.canonicalStage === 'handover') && Date.parse(item.timestamp) >= receivedAt);
    const events = [...new Map(transfer.events.map(item => [item.id, item])).values()].filter(item => item.type === 'Handover'
      && item.actorId === receipt.operatorId && item.status === 'Completed' && Date.parse(item.timestamp) >= receivedAt && Date.parse(item.timestamp) <= cutoff);
    const reported = transfer.providerId === receipt.operatorId && Date.parse(transfer.updatedAt) >= receivedAt
      && Date.parse(transfer.updatedAt) <= cutoff && physicalStates.has(transfer.status);
    const physical = physicalStates.has(transfer.status) && Date.parse(transfer.updatedAt) >= receivedAt && Date.parse(transfer.updatedAt) <= cutoff;
    if (!readings.length && !events.length && !reported && !physical) continue;
    // Agreed quantities, listing stock and a completed flag alone cannot establish Hub outflow.
    if (['Cancelled', 'Rejected', 'Expired', 'Closed', 'Disputed', 'Unknown'].includes(transfer.status)) return unavailable('Transfer evidence incomplete');
    const reading = readings.length === 1 ? readings[0] : null;
    let weight: number | null = null;
    if (readings.length) {
      if (!reading || !['Measured', 'Verified'].includes(reading.status) || !valid(reading.weightKg)) return unavailable('Transfer evidence incomplete');
      weight = reading.weightKg;
    } else if (events.length) {
      if (events.length !== 1 || !['Measured', 'Verified'].includes(events[0].weightStatus ?? '') || !valid(events[0].weightKg)) return unavailable('Transfer evidence incomplete');
      weight = events[0].weightKg;
    } else if (reported && valid(transfer.handoverWeightKg)) weight = transfer.handoverWeightKg;
    if (weight === null) return unavailable('Transfer evidence incomplete');
    transferredOutKg += weight;
  }
  const disposedKg = ledger.reduce((sum, item) => sum + item.weightKg, 0);
  const remaining = Number((receipt.weightKg - disposedKg - transferredOutKg).toFixed(6));
  if (remaining < 0) return unavailable('Conflicting movements');
  return { awaitingDisposalKg: remaining, transferredOutKg: Number(transferredOutKg.toFixed(6)), balanceStatus: 'Reconciled' as const };
}
