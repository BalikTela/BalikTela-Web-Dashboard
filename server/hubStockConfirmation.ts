import { createHash } from 'node:crypto';
import { HUB_STOCK_CONFIRMATION_ACTION } from '../shared/hubStorage.js';
import { hubOutboundMovements } from './hubBalance.js';
import { hubFacilityAttributions } from './hubFacilities.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { AuditRecord, UserRecord } from './types.js';

interface StockEvent { at: string; kg: number; signature: string }
interface StockCheckpoint {
  version: 1; facilityId: string; stockKg: number; countedAt: string; reason: string;
  events: Record<string, StockEvent>; unresolved: Record<string, string>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const round = (kg: number) => Number(kg.toFixed(6));

export function latestStockConfirmation(source: DashboardSourceSnapshot, facilityId: string) {
  return (source.stockConfirmations ?? []).filter(item => item.action === HUB_STOCK_CONFIRMATION_ACTION && item.entityId === facilityId)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id))[0];
}

// The audit entry is the checkpoint itself: append-only, with no fabricated receipt or disposal.
export function createStockConfirmation(source: DashboardSourceSnapshot, actor: UserRecord, facilityId: string,
  stockKg: number, countedAt: string, reason: string, recordedAt: string): AuditRecord {
  const state = stockEvents(source, actor, facilityId, new Date(countedAt));
  const previous = latestStockConfirmation(source, facilityId);
  const checkpoint: StockCheckpoint = { version: 1, facilityId, stockKg, countedAt, reason, events: state.events, unresolved: state.unresolved };
  const previousCount = previous ? JSON.parse(previous.details) as StockCheckpoint : null;
  return { id: `HSC-${hash([facilityId, previous?.id ?? null])}`, actorId: actor.id, action: HUB_STOCK_CONFIRMATION_ACTION,
    entityType: 'facilities', entityId: facilityId, timestamp: recordedAt,
    details: JSON.stringify({ ...checkpoint, previousConfirmationId: previous?.id ?? null, changes: [{ collection: 'Hub stock count',
      before: previousCount ? { stockKg: previousCount.stockKg, countedAt: previousCount.countedAt } : null, after: { stockKg, countedAt } }] }) };
}

export function confirmedStock(source: DashboardSourceSnapshot, actor: UserRecord, facilityId: string, now: Date) {
  const record = latestStockConfirmation(source, facilityId);
  if (!record) return undefined;
  let checkpoint: StockCheckpoint;
  try { checkpoint = JSON.parse(record.details); } catch { return { storedKg: null, record }; }
  const at = Date.parse(checkpoint.countedAt);
  if (checkpoint.version !== 1 || checkpoint.facilityId !== facilityId || !Number.isFinite(checkpoint.stockKg)
    || checkpoint.stockKg < 0 || !Number.isFinite(at) || at > now.getTime() || !checkpoint.events || !checkpoint.unresolved
    || !source.hubDisposals?.available) return { storedKg: null, record };
  const state = stockEvents(source, actor, facilityId, now);
  if (state.ambiguous) return { storedKg: null, record };
  // Changes to old evidence need review; new backdated receipts must not add stock already counted.
  for (const [id, event] of Object.entries(checkpoint.events)) {
    if (state.events[id]?.signature !== event.signature) return { storedKg: null, record };
  }
  for (const [id, signature] of Object.entries(checkpoint.unresolved)) {
    if (state.unresolved[id] !== signature) return { storedKg: null, record };
  }
  if (Object.entries(state.unresolved).some(([id, signature]) => checkpoint.unresolved[id] !== signature)) return { storedKg: null, record };
  let kg = checkpoint.stockKg;
  for (const [id, event] of Object.entries(state.events)) {
    if (checkpoint.events[id]) continue;
    if (Date.parse(event.at) <= at) return { storedKg: null, record };
    kg += event.kg;
  }
  kg = round(kg);
  return { storedKg: kg >= 0 ? kg : null, record, countedAt: checkpoint.countedAt, reason: checkpoint.reason };
}

function stockEvents(source: DashboardSourceSnapshot, actor: UserRecord, facilityId: string, now: Date) {
  const batches = source.allBatches.filter(item => Date.parse(item.createdAt) <= now.getTime());
  const { operators, relevant, batchSites, ledger } = hubFacilityAttributions(source, batches, actor, now, true);
  const events: Record<string, StockEvent> = {}, unresolved: Record<string, string> = {};
  const siteOperators = new Set(operators.filter(item => item.scope.facilityIds.includes(facilityId)).map(item => item.id));
  let ambiguous = false;
  const add = (id: string, at: string, kg: number, evidence: unknown) => {
    events[id] = { at, kg, signature: hash([at, kg, evidence]) };
  };
  for (const [batchId, evidence] of relevant) {
    if (!batchSites.has(batchId) && [...evidence.operatorIds].some(id => siteOperators.has(id))) ambiguous = true;
    if (batchSites.get(batchId) !== facilityId) continue;
    const receipt = evidence.receipt;
    if (receipt) add(`receipt:${batchId}`, receipt.at, receipt.weightKg, receipt);
    else {
      const readings = source.measurements.filter(item => item.batchId === batchId && Date.parse(item.timestamp) <= now.getTime()
        && (item.canonicalStage === 'collection' || item.stage === 'Receipt' || evidence.operatorIds.has(item.recordedBy)
          && ['Measured', 'Verified'].includes(item.status) && item.canonicalStage === 'listing'));
      for (const reading of readings) unresolved[`measurement:${reading.id}`] = hash(reading);
      for (const item of source.recoveryRecords.filter(item => item.batchId === batchId && item.stage === 'Collection' && Date.parse(item.timestamp) <= now.getTime()))
        unresolved[`collection:${item.id}`] = hash(item);
      const listings = source.listings.filter(item => item.batchId === batchId && Date.parse(item.createdAt) <= now.getTime());
      if (!readings.length && listings.some(item => !['draft', 'available', 'matched', 'reserved'].includes(item.canonicalStatus ?? '')))
        unresolved[`handling:${batchId}`] = hash(listings.filter(item => !item.remainderOfId).map(item => [item.id, item.createdAt]).sort());
    }
    const batchDisposals = ledger.records.filter(item => item.batchId === batchId);
    for (const item of batchDisposals) add(`disposal:${item.id}`, item.disposedAt, -item.weightKg,
      [batchId, item.listingId, item.operatorId, item.reason]);
    const listingIds = new Set(source.listings.filter(item => item.batchId === batchId).map(item => item.id));
    for (const item of source.hubDisposals?.records ?? []) {
      if (listingIds.has(item.listingId) && !(Date.parse(item.disposedAt) > now.getTime()) && !batchDisposals.some(accepted => accepted.id === item.id))
        unresolved[`disposal:${item.id}`] = hash(item);
    }
    const transferIds = new Set(source.allTransfers.filter(item => item.batchId === batchId).map(item => item.id));
    for (const item of source.measurements.filter(item => item.batchId === batchId && evidence.operatorIds.has(item.recordedBy)
      && (item.canonicalStage === 'handover' || item.stage === 'Handover') && Date.parse(item.timestamp) <= now.getTime() && !transferIds.has(item.transferId ?? '')))
      unresolved[`handover:${item.id}`] = hash(item);
    for (const transfer of source.allTransfers.filter(item => item.batchId === batchId)) {
      for (const operatorId of evidence.operatorIds) {
        const selected = { ...source, allTransfers: [transfer], measurements: source.measurements.filter(item => item.transferId === transfer.id) };
        const outbound = hubOutboundMovements(selected, batchId, operatorId, 0, now);
        if (outbound.balanceStatus !== 'Reconciled') unresolved[`transfer:${transfer.id}:${operatorId}`] = hash([transfer, selected.measurements]);
        else for (const movement of outbound.movements) add(`outbound:${movement.id}`, movement.timestamp, -movement.weightKg, [batchId, operatorId]);
      }
    }
  }
  return { events, unresolved, ambiguous };
}
