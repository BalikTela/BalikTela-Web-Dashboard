import { hubStorageCapacity, storageAvailability, HUB_STORAGE_THRESHOLD_PERCENT, HUB_SIMULATION_PREFIX, isStorageSimulationOperator, type HubStorageAnalytics, type HubStorageRow } from '../shared/hubStorage.js';
import { isApprovedHub } from '../shared/hubs.js';
import { listingWorkflowStatus } from '../shared/workflows.js';
import { hubDisposalBalance } from './hubBalance.js';
import { hubFacilityAttributions } from './hubFacilities.js';
import type { DashboardSourceSnapshot } from './store.js';
import type { FacilityRecord, UserRecord } from './types.js';

const round = (value: number) => Number(value.toFixed(6));

// Current storage spans all history and material types; reporting filters must never free space.
export function buildHubStorageAnalytics(source: DashboardSourceSnapshot, facilities: FacilityRecord[], actor: UserRecord, now = new Date()): HubStorageAnalytics {
  const batches = [...new Map(source.allBatches.filter(item => Date.parse(item.createdAt) <= now.getTime()).map(item => [item.id, item])).values()];
  const { operators, ledger, relevant, batchSites } = hubFacilityAttributions(source, batches, actor, now, true);
  const users = new Map(source.users.map(item => [item.id, item]));
  const listings = [...new Map(source.listings.filter(item => Date.parse(item.createdAt) <= now.getTime()).map(item => [item.id, item])).values()];
  const batchMap = new Map(batches.map(item => [item.id, item]));
  const visibleIds = new Set(facilities.map(item => item.id));
  const uncertainSites = new Set<string>();
  let unattributedBatches = 0;
  for (const [batchId, evidence] of relevant) if (!batchSites.has(batchId)) {
    const candidates = [...evidence.operatorIds].flatMap(id => operators.find(item => item.id === id)?.scope.facilityIds ?? []);
    if (candidates.some(id => visibleIds.has(id))) {
      unattributedBatches++;
      candidates.filter(id => visibleIds.has(id)).forEach(id => uncertainSites.add(id));
    }
  }
  const rows: HubStorageRow[] = facilities.map(site => {
    const linked = operators.filter(item => item.scope.facilityIds.includes(site.id));
    const approved = linked.some(isApprovedHub);
    const simulationOnly = !approved && linked.some(isStorageSimulationOperator);
    const containsSimulation = [...relevant.keys()].some(id => batchSites.get(id) === site.id && id.startsWith(HUB_SIMULATION_PREFIX));
    let storedKg: number | null = ledger.available && !uncertainSites.has(site.id) ? 0 : null;
    let reservedKg: number | null = uncertainSites.has(site.id) ? null : 0;
    let disposedKg = 0;
    for (const [batchId, evidence] of relevant) {
      if (batchSites.get(batchId) !== site.id) continue;
      const disposals = ledger.records.filter(item => item.batchId === batchId);
      disposedKg += disposals.reduce((sum, item) => sum + item.weightKg, 0);
      if (evidence.receipt) {
        const balance = hubDisposalBalance(source, batchId, evidence.receipt, ledger.records, now);
        storedKg = storedKg !== null && balance.awaitingDisposalKg !== null ? storedKg + balance.awaitingDisposalKg : null;
        continue;
      }
      const batch = batchMap.get(batchId)!;
      const listingIds = new Set(listings.filter(item => item.batchId === batchId).map(item => item.id));
      const physicalHistory = source.measurements.some(item => item.batchId === batchId && Date.parse(item.timestamp) <= now.getTime()
        && (item.canonicalStage === 'collection' || item.stage === 'Receipt'))
        || source.recoveryRecords.some(item => item.batchId === batchId && item.stage === 'Collection' && Date.parse(item.timestamp) <= now.getTime())
        || source.hubDisposals?.records.some(item => listingIds.has(item.listingId) && !(Date.parse(item.disposedAt) > now.getTime()));
      const roots = listings.filter(item => item.batchId === batchId && item.deliveryRoute !== 'direct' && !item.remainderOfId
        && (users.get(item.ownerId)?.role === 'Consumer' || users.get(batch.sourceUserId)?.role === 'Consumer'));
      const active = roots.filter(item => ['available','matched','reserved'].includes(listingWorkflowStatus(item) ?? ''));
      // Unreceived submissions reserve their original declaration once. A disposal without
      // intake, terminal handling, or an unfamiliar state cannot establish an empty store.
      if (physicalHistory || disposals.length || !roots.length || roots.some(item => !['draft','available','matched','reserved'].includes(listingWorkflowStatus(item) ?? ''))) storedKg = null;
      if (active.length) reservedKg = reservedKg !== null && batch.declaredWeightKg !== null && Number.isFinite(batch.declaredWeightKg) && batch.declaredWeightKg >= 0
        ? reservedKg + batch.declaredWeightKg : null;
    }
    storedKg = storedKg === null ? null : round(storedKg);
    reservedKg = reservedKg === null ? null : round(reservedKg);
    const { capacityKg, capacitySource } = hubStorageCapacity(site);
    const availability = storageAvailability(capacityKg, storedKg, reservedKg, site.status, approved || simulationOnly);
    return { id: site.id, name: site.name, location: site.city, region: site.region, acceptedTypes: site.acceptedMaterials,
      capacityKg, capacitySource, storedKg, reservedKg, disposedKg: ledger.available ? round(disposedKg) : null,
      ...availability, containsSimulation, simulationOnly,
      selectable: availability.selectable && !simulationOnly && !containsSimulation };
  });
  const aggregateOnly = actor.scope.aggregateOnly || actor.role === 'Government';
  return { illustrativeCapacity: rows.some(item => item.capacitySource === 'Illustrative'), thresholdPercent: HUB_STORAGE_THRESHOLD_PERCENT, asOf: now.toISOString(), aggregateOnly,
    rows: aggregateOnly ? aggregateRows(rows) : rows, summary: { unattributedBatches } };
}

function aggregateRows(rows: HubStorageRow[]): HubStorageRow[] {
  return [...new Set(rows.map(item => item.region))].map((region, index) => {
    const sites = rows.filter(item => item.region === region);
    const sum = (key: 'storedKg' | 'reservedKg' | 'disposedKg') => sites.every(item => item[key] !== null)
      ? round(sites.reduce((total, item) => total + item[key]!, 0)) : null;
    const capacityKg = round(sites.reduce((total, item) => total + item.capacityKg, 0));
    const capacitySource = sites.every(item => item.capacitySource === sites[0].capacitySource) ? sites[0].capacitySource : 'Mixed';
    const storedKg = sum('storedKg'), reservedKg = sum('reservedKg');
    const allocation = storageAvailability(capacityKg, sites.every(item => item.capacityKg > 0) ? storedKg : null, reservedKg, 'Available', true);
    return { id: `storage-region-${index}`, name: `${region} Hubs`, location: region, region,
      acceptedTypes: [...new Set(sites.flatMap(item => item.acceptedTypes))], capacityKg, capacitySource,
      storedKg, reservedKg, disposedKg: sum('disposedKg'), ...allocation,
      availableToReceiveKg: sites.every(item => item.availableToReceiveKg !== null)
        ? round(sites.filter(item => item.status === 'Available').reduce((sum, item) => sum + item.availableToReceiveKg!, 0)) : null,
      status: 'Aggregate only', selectable: false, containsSimulation: sites.some(item => item.containsSimulation),
      simulationOnly: sites.every(item => item.simulationOnly) };
  });
}
