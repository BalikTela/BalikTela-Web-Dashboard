import { isDeepStrictEqual } from 'node:util';
import { isHubProfile, type HubDisposalMonitoring, type HubDisposalRecord } from '../shared/hubs.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { MaterialBatchRecord, UserRecord } from './types.js';
import { isHubSimulationBatch } from '../shared/hubStorage.js';

export function hubDisposalEvidence(source: DashboardSourceSnapshot, selected: MaterialBatchRecord[], actor: UserRecord, now = new Date(), siteTotals = false) {
  const available = source.hubDisposals?.available ?? false;
  const batches = new Map(selected.map(item => [item.id, item]));
  const listings = new Map(source.listings.map(item => [item.id, item]));
  const users = new Map(source.users.map(item => [item.id, item]));
  const unique = new Map<string, HubDisposalRecord>(), conflicts = new Set<string>();
  const businessEvidence = (item: HubDisposalRecord) => [item.listingId, item.operatorId, item.weightKg, Date.parse(item.disposedAt), item.reason.trim()];
  for (const item of available ? source.hubDisposals!.records : []) {
    if (!siteTotals && isHubProfile(actor) && item.operatorId !== actor.id) continue;
    const previous = unique.get(item.id);
    if (previous && !isDeepStrictEqual(businessEvidence(previous), businessEvidence(item))) conflicts.add(item.id);
    if (!previous) unique.set(item.id, item);
  }
  const records: HubDisposalMonitoring['records'] = [];
  let invalidRecords = 0, missingLinks = 0;
  for (const item of unique.values()) {
    const at = Date.parse(item.disposedAt);
    if (Number.isFinite(at) && at > now.getTime()) continue;
    const listing = listings.get(item.listingId), batch = listing && batches.get(listing.batchId);
    if (!listing) { if (actor.role === 'Administrator') missingLinks++; continue; }
    if (!batch) continue;
    // Historical disposal survives role/approval changes; the ledger records authority at write time.
    if (conflicts.has(item.id) || !item.id.trim() || !Number.isFinite(at) || !Number.isFinite(item.weightKg) || item.weightKg <= 0
      || !item.reason.trim() || !users.has(item.operatorId) || !Number.isFinite(Date.parse(listing.createdAt)) || Date.parse(listing.createdAt) > now.getTime()) {
      invalidRecords++; continue;
    }
    records.push({ ...item, batchId: batch.id, operator: users.get(item.operatorId)!.fullName,
      region: batch.region || 'Not recorded', isDemo: batch.isDemo });
  }
  return { available,
    summary: { records: records.length, disposedKg: Number(records.reduce((sum, item) => sum + item.weightKg, 0).toFixed(6)),
      listings: new Set(records.map(item => item.listingId)).size, missingLinks, invalidRecords },
    records: records.sort((a, b) => Date.parse(b.disposedAt) - Date.parse(a.disposedAt)) };
}

export function aggregateHubDisposals(source: DashboardSourceSnapshot, selected: MaterialBatchRecord[], actor: UserRecord, now = new Date()): HubDisposalMonitoring {
  const ledger = hubDisposalEvidence(source, selected.filter(item => !isHubSimulationBatch(item)), actor, now);
  const aggregateOnly = actor.scope.aggregateOnly || actor.role === 'Government' || actor.role === 'Researcher';
  return { ...ledger, aggregateOnly, landfillAvoidedKg: null, records: aggregateOnly ? [] : ledger.records };
}
