import { calculateOperationalMass } from './domain.js';
import { scopeAnalyticalBatches, scopeBatches, scopeFacilities } from './access-control.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { MaterialBatchRecord, RecoveryRecord, TransferRecord, UserRecord } from './types.js';
import { aggregateMaterialEvidence as aggregate } from './materialEvidence.js';
export { aggregateMaterialEvidence as aggregate } from './materialEvidence.js';
import { isCompletedTransfer, isTerminalTransfer, matchesTransferStatus } from '../shared/workflows.js';
import { buildStakeholderView, identifyHubOperators } from './stakeholders.js';
import { isHubWeighingMeasurement } from '../shared/hubs.js';
import { buildHubOperations } from './hubOperations.js';
import { aggregateHubDisposals, hubDisposalEvidence } from './hubDisposals.js';
import { buildPlatformActivity } from './platformActivity.js';
import { facilityCapacityStatus } from '../shared/facilityCapacity.js';
import { buildHubFacilityAnalytics, hubFacilityAttributions } from './hubFacilities.js';
import { buildHubStorageAnalytics } from './hubStorage.js';
import { isHubSimulationBatch } from '../shared/hubStorage.js';
import { recoveryMassBalance } from '../shared/recovery.js';
import { summaryActor } from './webPrivacy.js';
import { changeDescription, formatMass, MATERIAL_METRIC_LABELS, percentage as percent } from '../shared/metrics.js';
import { inReportingWindow, manilaDate, resolveReportingPeriod, type ReportingWindow } from '../shared/reporting.js';

const mapCoordinates: Record<string, [number, number]> = { 'Metro Manila': [51, 31], 'Central Visayas': [56, 58], 'Western Visayas': [45, 60], 'Davao Region': [67, 78] };

export async function loadDashboardAnalyticsSnapshot(store: Store): Promise<DashboardSourceSnapshot> {
  const stockConfirmations = store.loadHubStockConfirmations ? await store.loadHubStockConfirmations()
    : (await store.all('auditRecords')).filter(item => item.action === 'hub.stock.confirmed');
  const optimizedSnapshot = await store.loadDashboardSnapshot?.();
  if (optimizedSnapshot) return store.loadHubDisposals && !optimizedSnapshot.hubDisposals
    ? { ...optimizedSnapshot, stockConfirmations, hubDisposals: await store.loadHubDisposals() } : { ...optimizedSnapshot, stockConfirmations };
  const [allBatches, allTransfers, measurements, recoveryRecords, listings, offers, users, organizations, facilities, walletEntries, interactions] = await Promise.all([
    store.all('materialBatches'), store.all('transfers'), store.all('measurements'), store.all('recoveryRecords'), store.all('listings'), store.all('offers'),
    store.all('users'), store.all('organizations'), store.all('facilities'), store.all('walletEntries'), store.all('systemInteractions'),
  ]);
  return { allBatches, allTransfers, measurements, recoveryRecords, listings, offers, users, organizations, facilities, walletEntries, interactions, stockConfirmations,
    ...(store.loadHubDisposals ? { hubDisposals: await store.loadHubDisposals() } : {}) };
}

export type DashboardAnalyticsSnapshot = DashboardSourceSnapshot;

export function selectHubCohort(snapshot: DashboardSourceSnapshot, actor: UserRecord, query: Record<string, unknown>, now = new Date()) {
  const hubIds = identifyHubOperators(snapshot, now);
  if (hubIds.has(actor.id)) actor = { ...actor, webHubOperator: true };
  const scoped = (['Administrator', 'Government', 'Researcher'].includes(actor.role)
    ? snapshot.allBatches.filter(item => actor.role === 'Administrator' || !actor.scope.regions.length || actor.scope.regions.includes(item.region))
    : scopeBatches(actor, snapshot.allBatches, snapshot)).filter(item => !isHubSimulationBatch(item));
  const period = resolveReportingPeriod(query, now, scoped.map(item => item.createdAt).sort()[0]);
  const hubBatchIds = new Set([...snapshot.listings.filter(item => hubIds.has(item.weighingHubId ?? '')).map(item => item.batchId),
    ...hubDisposalEvidence(snapshot, scoped, actor, now).records.map(item => item.batchId),
    ...snapshot.measurements.filter(item => hubIds.has(item.recordedBy) && Date.parse(item.timestamp) <= now.getTime()).map(item => item.batchId)]);
  return { period, actor, batches: filterBatches(scoped, period, query, { transfers: snapshot.allTransfers, recoveryRecords: snapshot.recoveryRecords,
    users: snapshot.users, organizations: snapshot.organizations, hubBatchIds,
    hubFacilityIdsByBatch: query.facilityId && query.facilityId !== 'All facilities' ? hubFacilityAttributions(snapshot, scoped, actor, now).batchSites : undefined }) };
}

export function selectAnalyticsCohort(snapshot: DashboardAnalyticsSnapshot, actor: UserRecord, query: Record<string, unknown>, now = new Date()) {
  const hubIds = identifyHubOperators(snapshot, now);
  if (hubIds.has(actor.id)) actor = { ...actor, webHubOperator: true };
  const scoped = scopeAnalyticalBatches(actor, snapshot.allBatches.filter(item => item.currentStatus !== 'Archived'), snapshot);
  const first = scoped.filter(item => Date.parse(item.createdAt) <= now.getTime()).map(item => item.createdAt).sort()[0];
  const period = resolveReportingPeriod(query, now, first);
  const allTransfers = snapshot.allTransfers.filter(item => Date.parse(item.updatedAt) <= now.getTime());
  const recoveryRecords = snapshot.recoveryRecords.filter(item => item.status !== 'Reversed' && Date.parse(item.timestamp) <= now.getTime());
  const hubBatchIds = new Set([...snapshot.listings.filter(item => hubIds.has(item.weighingHubId ?? '')).map(item => item.batchId),
    ...snapshot.measurements.filter(item => hubIds.has(item.recordedBy) && isHubWeighingMeasurement(item) && Date.parse(item.timestamp) <= now.getTime()).map(item => item.batchId)]);
  const related = { transfers: allTransfers, recoveryRecords, users: snapshot.users, organizations: snapshot.organizations, hubBatchIds,
    hubFacilityIdsByBatch: query.facilityId && query.facilityId !== 'All facilities' ? hubFacilityAttributions(snapshot, scoped, actor, now).batchSites : undefined };
  const currentBatches = filterBatches(scoped, period, query, related);
  const previousBatches = period.comparison ? filterBatches(scoped, period.comparison, query, related) : [];
  const currentBatchIds = new Set(currentBatches.map(item => item.id));
  const matchingTransfers = allTransfers.filter(item => transferMatches(item, query));
  const currentTransfers = matchingTransfers.filter(item => currentBatchIds.has(item.batchId));
  const currentRecovery = recoveryRecords.filter(item => currentBatchIds.has(item.batchId));
  const currentMeasurements = snapshot.measurements.filter(item => currentBatchIds.has(item.batchId) && Date.parse(item.timestamp) <= now.getTime());
  return { period, currentBatches, previousBatches, currentBatchIds, matchingTransfers, currentTransfers, currentRecovery, currentMeasurements, recoveryRecords };
}

export async function buildDashboardAnalytics(store: Store, actor: UserRecord, query: Record<string, unknown>, suppliedSnapshot?: DashboardAnalyticsSnapshot, now = new Date()) {
  actor = summaryActor(actor);
  const snapshot = suppliedSnapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const hubIds = identifyHubOperators(snapshot, now);
  if (hubIds.has(actor.id)) actor = { ...actor, webHubOperator: true };
  const { listings, offers, users, walletEntries } = snapshot;
  const facilities=scopeFacilities(actor, snapshot.facilities).filter(item=>item.status!=='Inactive'
    && option(query.region,'All regions',item.region) && option(query.facilityId,'All facilities',item.id)
    && option(query.organizationId,'All organizations',item.organizationId)
    && (!query.city || item.city.toLowerCase().includes(String(query.city).trim().toLowerCase()))
    && (!query.textileType || query.textileType==='All textiles' || item.acceptedMaterials.includes(String(query.textileType))));
  const { period, currentBatches, previousBatches, currentBatchIds, matchingTransfers, currentTransfers, currentRecovery, currentMeasurements, recoveryRecords } = selectAnalyticsCohort(snapshot, actor, query, now);
  const months = reportingMonths(period);
  const evidenceContext = { measurements: snapshot.measurements.filter(item => Date.parse(item.timestamp) <= now.getTime()), listings, users };
  const current = aggregate(currentBatches, matchingTransfers, recoveryRecords, evidenceContext);
  const previous = aggregate(previousBatches, matchingTransfers, recoveryRecords, evidenceContext);
  const comparisonPeriod = period.comparison?.label ?? '';
  const facilityMetrics = facilityView(currentBatches, currentRecovery, facilities, period.capacityMonths, current.confirmedOutputs,
    hubFacilityAttributions(snapshot, currentBatches, actor, now));
  const regionalActivity = regions(currentBatches, currentTransfers, currentRecovery, facilities, users, evidenceContext, hubIds);
  const mass = calculateOperationalMass(currentBatches, currentTransfers);
  const completed = [...new Map(currentTransfers.map(item => [item.id, item])).values()].filter((item) => isCompletedTransfer(item.status));
  const cohortListings = [...new Map(listings.map(item => [item.id, item])).values()].filter(item => currentBatchIds.has(item.batchId) && Date.parse(item.createdAt) <= now.getTime());
  const cohortListingIds = new Set(cohortListings.map(item => item.id));
  const cohortOffers = [...new Map(offers.map(item => [item.id, item])).values()].filter(item => cohortListingIds.has(item.listingId) && Date.parse(item.createdAt) <= now.getTime());
  const engagementMetrics = await buildPlatformActivity(store, snapshot, actor, query, period, cohortListings, cohortOffers, completed, now);
  const activeHubBatchIds = new Set(currentMeasurements.filter(isHubWeighingMeasurement).map(item => item.batchId));
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const hubCohort = selectHubCohort(snapshot, actor, query, now);
  const hubDisposal = aggregateHubDisposals(snapshot, hubCohort.batches, hubCohort.actor, now);
  const hubFacilities = buildHubFacilityAnalytics(snapshot, facilities, hubCohort.batches, hubCohort.actor, hubCohort.period.capacityMonths, now);

  return {
    hubStorage: buildHubStorageAnalytics(snapshot, facilities, actor, now),
    hubFacilities,
    hubOperations: buildHubOperations(snapshot, hubCohort.batches, hubCohort.actor, hubCohort.period.label, now).summary,
    hubDisposal: { available: hubDisposal.available, summary: hubDisposal.summary },
    metadata: {
      periodLabel: period.label,
      reportingCutoff: period.endDate,
      period,
      aggregateOnly: actor.scope.aggregateOnly,
      hubOperator: actor.webHubOperator === true || actor.role === 'BalikTela Hub',
      denominatorNote: `Total Textiles Declared sums reported batch weights entered into the platform. Textiles Physically Received separately measures supported physical intake. Confirmed recovery share = validated final reuse and recycling output linked to physically received batches / supported physical intake for the same batch cohort, not declared weight. Pending stock stays in the denominator; transfers, sorting and recyclable classifications are not final outcomes. Missing or conflicting evidence makes the rate unavailable. ${currentBatches.filter(item => item.declaredWeightKg === null).length} batches have no declared weight; missing weights are not measured zeros. Asia/Manila batch-registration cohort; latest recorded outcomes through ${period.asOf}, not receipt-month totals or historical status snapshots. Capacity is prorated by the actual fraction of each calendar month. Comparison: ${period.comparisonBasis}.`,
      sampleDisclosure: 'PoC reporting combines synthetic scenario records and shared operational records under the same metric rules. Source provenance is retained internally. Combined totals are illustrative, not independently measured real-world or national outcomes.',
      refreshedAt: now.toISOString(),
    },
    kpis: kpis(current, previous, engagementMetrics, regionalActivity, comparisonPeriod, hubDisposal),
    materialEvidence: {
      collectedBatches: current.collectedBatches, missingCollectionBatches: current.missingCollectionBatches,
      reuseRecords: current.reuseRecords, recyclingRecords: current.recyclingRecords,
      completedKg: current.completedKg, completedWithWeight: current.completedWithWeight,
      completedMissingWeight: current.completedMissingWeight, completedReportedWeight: current.completedReportedWeight,
      collectionConflicts: current.collectionConflicts, outcomeConflicts: current.outcomeConflicts,
      matchedDiversionKg: current.matchedDiversionKg, unlinkedOutcomeKg: current.unlinkedOutcomeKg,
      unresolvedCollectedKg: current.unresolvedCollectedKg,
    },
    sharedActivity: {
      transferCount: currentTransfers.length,
      listings: cohortListings.length,
      pendingRequests: cohortOffers.filter(item => ['Pending', 'Revised'].includes(item.status)).length,
      hubWeighedBatches: activeHubBatchIds.size,
      completedTransfers: completed.length,
      completionAwaitingVerification: completed.filter(item => item.verifiedWeightKg === null).length,
      operationalBatches: currentBatches.filter(item => !item.isDemo).length,
      demoBatches: currentBatches.filter(item => item.isDemo).length,
      missingGeography: currentBatches.filter(item => !item.city || !item.region).length,
    },
    wasteTrend: months.map((month) => {
      const value = aggregate(currentBatches.filter((batch) => manilaDate(new Date(batch.createdAt)).startsWith(month.key)), matchingTransfers, recoveryRecords, evidenceContext);
      return { month: month.label, recorded: value.generatedKg, collected: value.collectedKg, recycled: value.recycledKg, reused: value.reusedKg, hasCollectionEvidence: value.collectedBatches > 0, hasRecyclingEvidence: value.recyclingRecords > 0, hasReuseEvidence: value.reuseRecords > 0 };
    }),
    categoryShares: [...new Set(currentBatches.map((item) => item.materialCategory))].map((category) => {
      const value = aggregate(currentBatches.filter((item) => item.materialCategory === category), matchingTransfers, recoveryRecords, evidenceContext);
      return { category, kilograms: value.collectedKg, recoveryRate: value.diversionRate ?? 0, recoveryRateAvailable: value.diversionRate !== null };
    }).sort((a, b) => b.kilograms - a.kilograms),
    transactions: actor.scope.aggregateOnly ? [] : transactionsView(currentTransfers, currentBatches, users),
    stakeholders: actor.scope.aggregateOnly || actor.role === 'Government' ? [] : buildStakeholderView(currentBatches, currentTransfers, snapshot, facilities, facilityMetrics, current.confirmedOutputs, actor, query, now),
    facilities: actor.scope.aggregateOnly ? aggregateFacilities(facilityMetrics) : facilityMetrics,
    regionalActivity,
    circularFlow: { generatedKg: current.generatedKg, collectedKg: current.collectedKg, sortedKg: current.sortedKg, reusedKg: current.reusedKg, recycledKg: current.recycledKg, residualKg: current.unresolvedCollectedKg, collectedAvailable: current.collectedBatches > 0, sortedAvailable: current.sortedBatches > 0, reusedAvailable: current.reuseRecords > 0, recycledAvailable: current.recyclingRecords > 0 },
    impactMetrics: { landfillAvoidedKg: null, estimatedCo2eKg: null, estimatedWaterLiters: null, diversionRate: current.diversionRate, sortingYield: current.sortingYield, methodologyStatus: 'Disabled pending approved methodology' as const },
    barterMetrics: barter(currentBatchIds, listings, offers, currentTransfers, walletEntries),
    engagementMetrics,
    forecastData: forecast(months.map((month) => ({ month: month.label, ...aggregate(currentBatches.filter((batch) => manilaDate(new Date(batch.createdAt)).startsWith(month.key)), matchingTransfers, recoveryRecords, evidenceContext) }))),
    operations: {
      period: { start: period.start, end: period.endExclusive, label: `${period.label} · Asia/Manila` },
      scope: { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, organizationIds: actor.scope.organizationIds },
      metrics: { batchCount: currentBatches.length, declaredKg: mass.declaredKg, measuredKg: sum(currentMeasurements.filter((item) => item.status === 'Measured').map((item) => item.weightKg)), verifiedKg: mass.verifiedKg, receivedKg: mass.receivedKg, completedTransfers: completed.length, activeTransfers: currentTransfers.filter((item) => !isTerminalTransfer(item.status)).length, diversionRate: mass.diversionRate, denominator: 'Verified transfer mass / declared mass is a transfer-activity ratio, not a diversion rate; repeated custody transfers can overlap' },
      massBalance: { declaredKg: mass.declaredKg, handedOverKg: mass.handedOverKg, receivedKg: mass.receivedKg, verifiedKg: mass.verifiedKg, discrepancyKg: mass.discrepancyKg },
      quality: { estimatedBatches: currentBatches.filter((item) => item.weightStatus === 'Estimated').length, measuredBatches: currentBatches.filter((item) => item.weightStatus === 'Measured').length, verifiedBatches: currentBatches.filter((item) => item.weightStatus === 'Verified').length, discrepancyFlags: currentTransfers.filter((item) => Math.abs(item.discrepancyKg ?? 0) > 0.01).length },
      environmentalImpact: { status: 'Disabled pending approved methodology' as const, co2eKg: null, waterLiters: null, landfillAvoidedKg: null },
    },
  };
}

function aggregateFacilities(facilities: ReturnType<typeof facilityView>) {
  return [...new Set(facilities.map(item => item.region))].map((region, index) => {
    const rows = facilities.filter(item => item.region === region);
    const sum = (key: 'capacityKg' | 'intakeKg' | 'processedKg') => round(rows.reduce((total, item) => total + item[key], 0));
    const capacityKg = sum('capacityKg'), intakeKg = sum('intakeKg');
    return { id: `aggregate-region-${index}`, name: `${region} facility aggregate`, location: region, region,
      acceptedTypes: [...new Set(rows.flatMap(item => item.acceptedTypes))], capacityKg, intakeKg,
      processedKg: sum('processedKg'), utilization: percent(intakeKg, capacityKg),
      processedAvailable: rows.some(item => item.processedAvailable),
      processingTimeDays: 0, status: 'Aggregate only', isDemo: rows.length > 0 && rows.every(item=>item.isDemo) };
  });
}

function reportingMonths(period: ReportingWindow) {
  const months: Array<{ key: string; label: string }> = [];
  const first = new Date(`${period.startDate.slice(0, 7)}-01T00:00:00Z`);
  for (let cursor = first; cursor.toISOString().slice(0, 7) <= period.endDate.slice(0, 7); cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))) {
    months.push({ key: cursor.toISOString().slice(0, 7), label: cursor.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) });
  }
  return months;
}

export function filterBatches(batches: MaterialBatchRecord[], period: ReportingWindow, query: Record<string, unknown>, related: { transfers: TransferRecord[]; recoveryRecords: Array<{ batchId: string; facilityId: string }>; users: UserRecord[]; organizations: Array<{ id: string; name: string }>; hubBatchIds?: ReadonlySet<string>; hubFacilityIdsByBatch?: ReadonlyMap<string,string> }) {
  const users = new Map(related.users.map((item) => [item.id, item]));
  const organizations = new Map(related.organizations.map((item) => [item.id, item]));
  const city = String(query.city ?? '').trim().toLowerCase();
  const producer = String(query.producer ?? '').trim().toLowerCase();
  const recycler = String(query.recycler ?? '').trim().toLowerCase();
  return batches.filter((batch) => {
    const batchTransfers = related.transfers.filter((item) => item.batchId === batch.id);
    const source = users.get(batch.sourceUserId);
    const sourceName = `${source?.fullName ?? ''} ${source?.organization ?? ''} ${organizations.get(batch.sourceOrganizationId ?? '')?.name ?? ''}`.toLowerCase();
    const recipientNames = batchTransfers.map((item) => { const user = users.get(item.recipientId); return `${user?.fullName ?? ''} ${user?.organization ?? ''}`; }).join(' ').toLowerCase();
    const stakeholderType = String(query.stakeholderType ?? 'All stakeholders');
    return inReportingWindow(batch.createdAt, period)
      && option(query.region, 'All regions', batch.region)
      && (!city || batch.city.toLowerCase().includes(city))
      && option(query.textileType ?? query.materialCategory, 'All textiles', batch.materialCategory)
      && option(query.wasteSource, 'All sources', batch.wasteSource)
      && option(query.circularPathway, 'All pathways', batch.circularPathway)
      && option(query.weightStatus, 'All weight statuses', batch.weightStatus ?? 'Awaiting weighing')
      && option(query.organizationId, 'All organizations', batch.sourceOrganizationId ?? '')
      && (!producer || sourceName.includes(producer))
      && (!recycler || recipientNames.includes(recycler))
      && (stakeholderType === 'All stakeholders' || stakeholderType === 'Administrator' || source?.role === stakeholderType || batchTransfers.some((item) => users.get(item.recipientId)?.role === stakeholderType)
        || stakeholderType === 'BalikTela Hub' && related.hubBatchIds?.has(batch.id))
      && (String(query.facilityId ?? 'All facilities') === 'All facilities' || related.hubFacilityIdsByBatch?.get(batch.id) === query.facilityId || related.recoveryRecords.some((item) => item.batchId === batch.id && item.facilityId === query.facilityId))
      && (option(query.transactionType, 'All types', '') && option(query.transactionStatus, 'All statuses', batch.currentStatus) || batchTransfers.some((item) => transferMatches(item, query)));
  });
}
function option(value: unknown, all: string, actual: string) { const selected = String(value ?? all); return selected === all || selected === actual; }
function transferType(transfer: TransferRecord) { return transfer.circularOutcome === 'Recycling' ? 'Recycling' : transfer.circularOutcome === 'Redistribution' ? 'Redistribution' : 'Barter'; }
function transferMatches(transfer: TransferRecord, query: Record<string, unknown>) { return option(query.transactionType, 'All types', transferType(transfer)) && matchesTransferStatus(transfer.status, query.transactionStatus); }

function kpis(current: ReturnType<typeof aggregate>, previous: ReturnType<typeof aggregate>, currentEngagement: Awaited<ReturnType<typeof buildPlatformActivity>>, regional: ReturnType<typeof regions>, comparisonPeriod: string, disposal: ReturnType<typeof aggregateHubDisposals>) {
  const comparison = (value: number, prior: number) => comparisonPeriod ? changeDescription(value, prior, comparisonPeriod) : 'No prior-period comparison';
  return [
    { label: MATERIAL_METRIC_LABELS.declared, value: formatMass(current.generatedKg), delta: 'Reported batch weights in the selected scope', description: 'Sum of declared weights counted once per registered material batch in the selected scope and registration period. Includes estimated and measured declarations; missing weights are excluded. This is material entered into the platform, not proof of physical receipt or a completed transfer.', tone: 'moss' as const },
    { label: MATERIAL_METRIC_LABELS.recyclableReceived, value: current.collectedBatches ? formatMass(current.recyclableCollectedKg) : 'Pending evidence', delta: `${current.recyclableCollectedBatches} recyclable ${current.recyclableCollectedBatches === 1 ? 'batch' : 'batches'} · ${current.assumedRecyclableCollectedBatches} assumed from consumer listings`, description: 'Physically received weight of unique recyclable batches, supported by validated intake evidence. Posted consumer listings are assumed recyclable under the workflow, not technically certified. Posting, estimates and legacy listing weighing alone do not prove physical receipt or recycling output.', tone: 'ocean' as const },
    { label: 'Completed Textile Transfers', value: current.completedWithWeight ? formatMass(current.completedKg) : 'Pending evidence', delta: `${current.completedWithWeight} weighted · ${current.completedMissingWeight} missing final weight`, description: `${current.completedReportedWeight} completed transfers use reported receipt weight; others use approved validation weight. Transfer activity can include repeated custody movements and is not unique recovered material. Agreed quantities are never substituted.`, tone: 'clay' as const },
    { label: 'Recorded Hub Disposal', value: !disposal.available ? 'Not available' : !disposal.summary.records && disposal.summary.invalidRecords ? 'Pending evidence' : formatMass(disposal.summary.disposedKg),
      delta: !disposal.available ? 'Disposal ledger unavailable' : `${disposal.summary.records} disposal ${disposal.summary.records === 1 ? 'record' : 'records'} · batch cohort${disposal.summary.invalidRecords ? ` · ${disposal.summary.invalidRecords} excluded` : ''}`,
      description: 'Sum of unique Hub disposal ledger weights for the selected batch-registration cohort, including archived materials, through the current as-of time. Partial disposals are added once per record; listing stock and cumulative disposal counters are never added. Invalid or conflicting evidence is excluded. Recorded disposal does not establish recycling, independently verified final destination or landfill diversion.', tone: 'denim' as const },
    { label: 'Confirmed Recovery Share', value: current.diversionRate === null ? 'Not available' : `${current.diversionRate}%`, delta: current.diversionRate === null ? 'Physical receipt + final outcome required' : `Reuse + recycling: ${formatMass(current.matchedDiversionKg)} / ${formatMass(current.collectedKg)} physically received`, description: 'Uses only final outcomes linked to physically received batches, divided by their supported intake weight in the selected batch cohort. Declared weights and Hub disposal are excluded from this numerator. Pending stock remains in the denominator; no denominator or unresolved conflicts means no published rate.', tone: 'moss' as const },
    { label: 'Registered Accounts', value: currentEngagement.registeredAccounts.toLocaleString(), delta: 'Auth-linked profiles in scope; not active users', tone: 'ocean' as const },
    { label: 'Active Producers', value: regional.reduce((sum, item) => sum + item.producers, 0).toString(), delta: 'Participants in selected cohort and scope', tone: 'clay' as const },
    { label: 'Active Recyclers', value: regional.reduce((sum, item) => sum + item.recyclers, 0).toString(), delta: 'Participants in selected cohort and scope', tone: 'denim' as const },
    { label: 'Completed Transactions', value: current.transactionCount.toLocaleString(), delta: comparison(current.transactionCount, previous.transactionCount), tone: 'moss' as const },
  ];
}

function transactionsView(transfers: TransferRecord[], batches: MaterialBatchRecord[], users: UserRecord[]) {
  const userMap = new Map(users.map((item) => [item.id, item])); const batchMap = new Map(batches.map((item) => [item.id, item]));
  return [...transfers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
    const batch = batchMap.get(item.batchId)!; const source = userMap.get(item.providerId); const destination = userMap.get(item.recipientId);
    const weight = item.verifiedWeightKg ?? item.receiptWeightKg ?? (isCompletedTransfer(item.status) ? null : item.agreedWeightKg);
    const weightEvidence = item.verifiedWeightKg !== null ? 'Recorded validation' : item.receiptWeightKg !== null ? 'Reported receipt' : isCompletedTransfer(item.status) ? 'Final weight missing' : 'Agreed quantity';
    return { id: item.id, date: item.updatedAt.slice(0, 10), source: source?.organization || source?.fullName || 'Unknown source', destination: destination?.organization || destination?.fullName || 'Unknown destination', type: transferType(item), textileCategory: item.materialCategory || batch.materialCategory, weightKg: weight, weightEvidence, location: [batch.city, batch.region].filter(Boolean).join(', ') || 'Location not recorded', region: batch.region, status: item.status, impact: isCompletedTransfer(item.status) ? 'Completed transfer; final recovery evidence assessed separately' : 'Outcome pending', estimatedImpactKg: undefined, sourceStakeholderId: item.providerId, destinationStakeholderId: item.recipientId, lifecycle: item.events.map((event) => ({ id: event.id, stage: event.type, actor: event.actorName, timestamp: event.timestamp, status: event.status, location: event.location, note: event.note })), isDemo: item.isDemo };
  });
}

function facilityView(batches: MaterialBatchRecord[], recovery: RecoveryRecord[], facilities: Array<{ id: string; name: string; city: string; region: string; acceptedMaterials: string[]; monthlyCapacityKg: number; status: string }>, capacityMonths: number, outputs: ReturnType<typeof aggregate>['confirmedOutputs'], hubEvidence: ReturnType<typeof hubFacilityAttributions>) {
  recovery = [...new Map(recovery.map(item => [item.id,item])).values()].filter(item => item.status === 'Validated' && item.validatedBy && recoveryMassBalance(item) === 'Balanced');
  const batchIds = new Set(batches.map((item) => item.id));
  return facilities.map((facility) => {
    const records = recovery.filter((item) => item.facilityId === facility.id && batchIds.has(item.batchId));
    const entries = [...new Set(records.map(item => item.batchId))].map(id => records.filter(item => item.batchId === id).sort((a,b) => a.timestamp.localeCompare(b.timestamp))[0]);
    const intakeByBatch = new Map(entries.map(item => [item.batchId, item.stage === 'Collection' ? item.outputWeightKg! : item.inputWeightKg]));
    // Receipt evidence replaces the operation's input for the same batch; it is never added twice.
    for (const [batchId, item] of hubEvidence.relevant) if (item.receipt && hubEvidence.batchSites.get(batchId) === facility.id)
      intakeByBatch.set(batchId, item.receipt.weightKg);
    const intake = [...intakeByBatch.values()].reduce((sum, weight) => sum + weight, 0);
    const facilityOutputs = outputs.filter(item => item.facilityId === facility.id);
    const processed = facilityOutputs.reduce((sum, item) => sum + item.kilograms, 0);
    const capacityKg = round(facility.monthlyCapacityKg * capacityMonths);
    const utilization = percent(intake, capacityKg);
    return { id: facility.id, name: facility.name, location: facility.city, region: facility.region, acceptedTypes: facility.acceptedMaterials, capacityKg, utilization, intakeKg: round(intake), processedKg: round(processed), processedAvailable: facilityOutputs.length > 0, processingTimeDays: 0, status: facilityCapacityStatus(utilization, capacityKg, facility.status), isDemo: 'isDemo' in facility && facility.isDemo === true };
  });
}

function regions(batches: MaterialBatchRecord[], transfers: TransferRecord[], recovery: RecoveryRecord[], facilities: Array<{ region: string; type: string }>, users: UserRecord[], context: import('./materialEvidence.js').EvidenceContext, hubIds: ReadonlySet<string> = new Set()) {
  return [...new Set(batches.map((item) => item.region))].map((region) => {
    const regionBatches = batches.filter((item) => item.region === region); const ids = new Set(regionBatches.map((item) => item.id)); const regionTransfers = transfers.filter((item) => ids.has(item.batchId)); const regionRecovery = recovery.filter((item) => ids.has(item.batchId)); const value = aggregate(regionBatches, regionTransfers, regionRecovery, context); const [x, y] = mapCoordinates[region] ?? [50, 50];
    const role = new Map(users.map(user => [user.id, hubIds.has(user.id) ? 'BalikTela Hub' : user.role]));
    return { region, city: regionBatches[0]?.city ?? '', collectionKg: value.collectedKg, recyclingKg: value.recycledKg, collectionAvailable: value.collectedBatches > 0, recyclingAvailable: value.recyclingRecords > 0, wasteGapKg: Math.max(0, value.generatedKg - value.reusedKg - value.recycledKg), producers: new Set(regionBatches.filter(item => role.get(item.sourceUserId) === 'Producer').map(item => item.sourceUserId)).size, collectionPoints: facilities.filter((item) => item.region === region).length, recyclers: new Set(regionTransfers.filter(item => role.get(item.recipientId) === 'Recycler').map(item => item.recipientId)).size, x, y };
  }).sort((a, b) => b.collectionKg - a.collectionKg);
}

function barter(batchIds: Set<string>, listings: Array<{ id: string; batchId: string; status: string }>, offers: Array<{ listingId: string; status: string }>, transfers: TransferRecord[], wallet: Array<{ transferId: string | null; credits: number; type: string }>) {
  const scopedListings = listings.filter((item) => batchIds.has(item.batchId)); const listingIds = new Set(scopedListings.map((item) => item.id)); const scopedOffers = offers.filter((item) => listingIds.has(item.listingId)); const transferIds = new Set(transfers.filter((item) => batchIds.has(item.batchId)).map((item) => item.id));
  return { listings: scopedListings.length, matches: scopedOffers.length, validated: transfers.filter((item) => batchIds.has(item.batchId) && item.verifiedWeightKg !== null && (item.status === 'Validated' || isCompletedTransfer(item.status))).length, completed: transfers.filter((item) => batchIds.has(item.batchId) && isCompletedTransfer(item.status)).length, rewardCredits: wallet.filter((item) => item.type !== 'Redeemed' && item.transferId && transferIds.has(item.transferId)).reduce((sum, item) => sum + item.credits, 0) };
}

function forecast(points: Array<{ month: string; generatedKg: number }>) { return points.map((point) => ({ month: point.month, historical: point.generatedKg, forecast: null as number | null })); }
function round(value: number) { return Number(value.toFixed(6)); }
