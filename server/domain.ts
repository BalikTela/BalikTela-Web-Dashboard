import type { MaterialBatchRecord, TransferRecord, TransferStatus } from './types.js';

export function uniqueBatches(batches: MaterialBatchRecord[]) {
  return [...new Map(batches.map((batch) => [batch.id, batch])).values()];
}

export function calculateOperationalMass(batches: MaterialBatchRecord[], transfers: TransferRecord[]) {
  const unique = uniqueBatches(batches);
  const completed = transfers.filter((transfer) => ['Completed', 'Processed'].includes(transfer.status));
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const declaredKg = sum(unique.map((batch) => batch.declaredWeightKg));
  const verifiedKg = sum(completed.map((transfer) => transfer.verifiedWeightKg));
  return {
    declaredKg,
    handedOverKg: sum(transfers.map((transfer) => transfer.handoverWeightKg)),
    receivedKg: sum(transfers.map((transfer) => transfer.receiptWeightKg)),
    verifiedKg,
    discrepancyKg: sum(transfers.map((transfer) => transfer.discrepancyKg)),
    diversionRate: declaredKg ? Number((verifiedKg / declaredKg * 100).toFixed(1)) : 0,
  };
}

export function canIssueReward(previousStatus: TransferStatus, nextStatus: TransferStatus, rewardIssuedAt: string | null) {
  return previousStatus === 'Validated' && nextStatus === 'Completed' && rewardIssuedAt === null;
}

export function nextLifecycleStatus(current: TransferStatus, action: string): TransferStatus | null {
  const transitions: Record<string, Partial<Record<string, TransferStatus>>> = {
    Reserved: { handover: 'Handed over', cancel: 'Cancelled', dispute: 'Disputed' },
    'Handed over': { receipt: 'Received', reject: 'Rejected', dispute: 'Disputed' },
    Received: { validate: 'Validated', reject: 'Rejected', dispute: 'Disputed' },
    Validated: { complete: 'Completed', dispute: 'Disputed' },
  };
  return transitions[current]?.[action] ?? null;
}
