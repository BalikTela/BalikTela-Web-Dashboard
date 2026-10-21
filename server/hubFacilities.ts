import type { HubFacilityAnalytics, HubFacilityMetric } from '../shared/hubFacilities.js';
import { facilityCapacityStatus } from '../shared/facilityCapacity.js';
import { isHubProfile } from '../shared/hubs.js';
import { isStorageSimulationOperator } from '../shared/hubStorage.js';
import { percentage } from '../shared/metrics.js';
import { createHubCollectionEvidence, hubCollectionEvidence } from './hubEvidence.js';
import { hubDisposalEvidence } from './hubDisposals.js';
import { hubDisposalBalance } from './hubBalance.js';
import { identifyHubOperators } from './stakeholders.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { FacilityRecord, MaterialBatchRecord, UserRecord } from './types.js';
import { groupRecords } from './recordIndex.js';

const round = (value: number) => Number(value.toFixed(6));

// Every existing facility record represents a Hub; login accounts never create extra Hub records.
export function buildHubFacilityAnalytics(source: DashboardSourceSnapshot, facilities: FacilityRecord[], batches: MaterialBatchRecord[],
  actor: UserRecord, capacityMonths: number, now = new Date()): HubFacilityAnalytics {
  const { operators, ledger, relevant, batchSites } = hubFacilityAttributions(source, batches, actor, now);
  const siteIds = new Set(facilities.map(item => item.id));
  const assigned = new Map<string, string[]>();
  const uncertainSites = new Map<string, Set<string>>();
  let unattributedBatches = 0, unattributedReceivedKg = 0, unattributedDisposedKg = 0;
  for (const [batchId, { receipt }] of relevant) {
    const site = batchSites.get(batchId);
    if (site && siteIds.has(site)) assigned.set(site, [...assigned.get(site) ?? [], batchId]);
    else {
      unattributedBatches++;
      unattributedReceivedKg += receipt?.weightKg ?? 0;
      unattributedDisposedKg += ledger.records.filter(item => item.batchId === batchId).reduce((sum, item) => sum + item.weightKg, 0);
      if (!site) for (const operatorId of relevant.get(batchId)!.operatorIds) {
        for (const id of operators.find(user => user.id === operatorId)?.scope.facilityIds ?? []) {
          if (siteIds.has(id)) uncertainSites.set(id, new Set([...(uncertainSites.get(id) ?? []), batchId]));
        }
      }
    }
  }
  const rows: HubFacilityMetric[] = facilities.map(site => {
    const ids = new Set(assigned.get(site.id) ?? []);
    const linkedOperators = operators.filter(user => user.scope.facilityIds.includes(site.id));
    const receipts = [...ids].map(id => relevant.get(id)!.receipt);
    const missingIntakeBatches = receipts.filter(item => !item).length;
    const unattributedAtSite = uncertainSites.get(site.id)?.size ?? 0;
    const linked = linkedOperators.length > 0 || receipts.some(Boolean);
    const receivedKg = linked && !missingIntakeBatches && !unattributedAtSite ? round(receipts.reduce((sum, item) => sum + (item?.weightKg ?? 0), 0)) : null;
    const disposal = ledger.records.filter(item => ids.has(item.batchId));
    const disposedKg = ledger.available ? round(disposal.reduce((sum, item) => sum + item.weightKg, 0)) : null;
    const balances = [...ids].map(id => hubDisposalBalance(source, id, relevant.get(id)!.receipt, ledger.records, now));
    const awaitingDisposalKg = linked && !unattributedAtSite && ledger.available && balances.every(item => item.awaitingDisposalKg !== null)
      ? round(balances.reduce((sum, item) => sum + item.awaitingDisposalKg!, 0)) : null;
    const capacityKg = Number.isFinite(site.monthlyCapacityKg) && site.monthlyCapacityKg > 0 ? round(site.monthlyCapacityKg * capacityMonths) : 0;
    const utilization = capacityKg > 0 && receivedKg !== null ? percentage(receivedKg, capacityKg) : null;
    const operating = ['Maintenance', 'Inactive', 'Pilot onboarding'].includes(site.status);
    return { id: site.id, name: site.name, location: site.city, region: site.region, acceptedTypes: site.acceptedMaterials,
      operators: linkedOperators.length, capacityKg, receivedKg, disposedKg, awaitingDisposalKg, utilization,
      remainingCapacityKg: capacityKg > 0 && receivedKg !== null ? round(capacityKg - receivedKg) : null,
      batches: ids.size, missingIntakeBatches, unattributedBatches: unattributedAtSite,
      status: operating ? facilityCapacityStatus(0, capacityKg, site.status) : !linked ? 'No operator assigned'
        : receivedKg === null ? 'Intake incomplete' : facilityCapacityStatus(utilization ?? 0, capacityKg, site.status) };
  });
  const aggregateOnly = actor.scope.aggregateOnly || actor.role === 'Government';
  return { aggregateOnly, rows: aggregateOnly ? aggregateRows(rows) : rows,
    summary: { hubs: rows.length, unassignedOperators: operators.filter(user => !user.scope.facilityIds.length
      && (['Administrator','Government','Researcher'].includes(actor.role) || user.id === actor.id
        || Boolean(user.organizationId && [actor.organizationId,...actor.scope.organizationIds].includes(user.organizationId)))
      && (actor.role === 'Administrator' || !actor.scope.regions.length || actor.scope.regions.includes(user.region))).length,
      unattributedBatches, unattributedReceivedKg: round(unattributedReceivedKg), unattributedDisposedKg: ledger.available ? round(unattributedDisposedKg) : null } };
}

export function hubFacilityAttributions(source: DashboardSourceSnapshot, batches: MaterialBatchRecord[], actor: UserRecord, now: Date, siteTotals = false) {
  const hubIds = identifyHubOperators(source, now);
  if (siteTotals) source.users.filter(isStorageSimulationOperator).forEach(user => hubIds.add(user.id));
  const operators = source.users.filter(user => hubIds.has(user.id) && (siteTotals || !isHubProfile(actor) || user.id === actor.id));
  const byOperator = new Map(operators.map(user => [user.id, [...new Set(user.scope.facilityIds)]]));
  const ledger = hubDisposalEvidence(source, batches, actor, now, siteTotals);
  const collectionFor = createHubCollectionEvidence(source, hubIds, now);
  const listingsByBatch = groupRecords(source.listings, item => item.batchId);
  const disposalsByBatch = groupRecords(ledger.records, item => item.batchId);
  const relevant = new Map<string, { receipt: ReturnType<typeof hubCollectionEvidence>; operatorIds: Set<string> }>();
  for (const batch of batches) {
    const receipt = collectionFor(batch.id);
    const operatorIds = new Set([
      ...(listingsByBatch.get(batch.id) ?? []).filter(item => Date.parse(item.createdAt) <= now.getTime()
        && hubIds.has(item.weighingHubId ?? '') && item.deliveryRoute !== 'direct').map(item => item.weighingHubId!),
      ...(disposalsByBatch.get(batch.id) ?? []).map(item => item.operatorId),
      ...(receipt ? [receipt.operatorId] : []),
    ].filter(id => siteTotals || !isHubProfile(actor) || id === actor.id));
    if (operatorIds.size) relevant.set(batch.id, { receipt: receipt && (siteTotals || !isHubProfile(actor) || receipt.operatorId === actor.id) ? receipt : null, operatorIds });
  }
  const batchSites = new Map<string, string>();
  for (const [batchId, { receipt, operatorIds }] of relevant) {
    // An explicit receipt site is authoritative. A current single-site assignment is a disclosed fallback.
    // Never split one operator's weight between multiple sites or select a site by name/region.
    let candidates: string[] = [];
    if (receipt?.facilityId) {
      const compatible = operatorIds.size === 1 || [...operatorIds].every(id => {
        const sites = byOperator.get(id); return sites?.length === 1 && sites[0] === receipt.facilityId;
      });
      if (compatible) candidates = [receipt.facilityId];
    } else if (operatorIds.size === 1) candidates = byOperator.get([...operatorIds][0]) ?? [];
    const site = candidates.length === 1 ? candidates[0] : null;
    if (site) batchSites.set(batchId, site);
  }
  return { operators, ledger, relevant, batchSites };
}

function aggregateRows(rows: HubFacilityMetric[]): HubFacilityMetric[] {
  return [...new Set(rows.map(item => item.region))].map((region, index) => {
    const sites = rows.filter(item => item.region === region);
    const complete = sites.every(item => item.receivedKg !== null);
    const capacityKg = round(sites.reduce((sum, item) => sum + item.capacityKg, 0));
    const receivedKg = complete ? round(sites.reduce((sum, item) => sum + item.receivedKg!, 0)) : null;
    const sumIfKnown = (key: 'disposedKg' | 'awaitingDisposalKg') => sites.every(item => item[key] !== null)
      ? round(sites.reduce((sum, item) => sum + item[key]!, 0)) : null;
    return { id: `hub-region-${index}`, name: `${region} Hubs`, location: region, region,
      acceptedTypes: [...new Set(sites.flatMap(item => item.acceptedTypes))], operators: sites.reduce((sum, item) => sum + item.operators, 0),
      capacityKg, receivedKg, disposedKg: sumIfKnown('disposedKg'), awaitingDisposalKg: sumIfKnown('awaitingDisposalKg'),
      utilization: capacityKg > 0 && sites.every(item => item.capacityKg > 0) && receivedKg !== null ? percentage(receivedKg, capacityKg) : null,
      remainingCapacityKg: capacityKg > 0 && sites.every(item => item.capacityKg > 0) && receivedKg !== null ? round(capacityKg - receivedKg) : null,
      batches: sites.reduce((sum, item) => sum + item.batches, 0), missingIntakeBatches: sites.reduce((sum, item) => sum + item.missingIntakeBatches, 0),
      unattributedBatches: sites.reduce((sum, item) => sum + item.unattributedBatches, 0), status: 'Aggregate only' };
  });
}
