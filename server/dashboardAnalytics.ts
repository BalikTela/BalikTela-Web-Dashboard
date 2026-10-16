import { calculateOperationalMass } from './domain.js';
import { scopeAnalyticalBatches } from './access-control.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { MaterialBatchRecord, TransferRecord, UserRecord } from './types.js';
import { changeDescription, formatMass, percentage as percent, pointsDescription } from '../shared/metrics.js';
import { inReportingWindow, manilaDate, resolveReportingPeriod, type ReportingWindow } from '../shared/reporting.js';

const mapCoordinates: Record<string, [number, number]> = { 'Metro Manila': [51, 31], 'Central Visayas': [56, 58], 'Western Visayas': [45, 60], 'Davao Region': [67, 78] };

export async function loadDashboardAnalyticsSnapshot(store: Store): Promise<DashboardSourceSnapshot> {
  const optimizedSnapshot = await store.loadDashboardSnapshot?.();
  if (optimizedSnapshot) return optimizedSnapshot;
  const [allBatches, allTransfers, measurements, recoveryRecords, listings, offers, users, organizations, facilities, walletEntries, interactions] = await Promise.all([
    store.all('materialBatches'), store.all('transfers'), store.all('measurements'), store.all('recoveryRecords'), store.all('listings'), store.all('offers'),
    store.all('users'), store.all('organizations'), store.all('facilities'), store.all('walletEntries'), store.all('systemInteractions'),
  ]);
  return { allBatches, allTransfers, measurements, recoveryRecords, listings, offers, users, organizations, facilities, walletEntries, interactions };
}

export type DashboardAnalyticsSnapshot = DashboardSourceSnapshot;

export function selectAnalyticsCohort(snapshot: DashboardAnalyticsSnapshot, actor: UserRecord, query: Record<string, unknown>, now = new Date()) {
  const scoped = scopeAnalyticalBatches(actor, snapshot.allBatches.filter(item => item.currentStatus !== 'Archived'));
  const first = scoped.filter(item => Date.parse(item.createdAt) <= now.getTime()).map(item => item.createdAt).sort()[0];
  const period = resolveReportingPeriod(query, now, first);
  const allTransfers = snapshot.allTransfers.filter(item => Date.parse(item.updatedAt) <= now.getTime());
  const recoveryRecords = snapshot.recoveryRecords.filter(item => item.status !== 'Reversed' && Date.parse(item.timestamp) <= now.getTime());
  const related = { transfers: allTransfers, recoveryRecords, users: snapshot.users, organizations: snapshot.organizations };
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
  const snapshot = suppliedSnapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const { listings, offers, users, walletEntries, interactions } = snapshot;
  const facilities=snapshot.facilities.filter(item=>item.status!=='Inactive');
  const { period, currentBatches, previousBatches, currentBatchIds, matchingTransfers, currentTransfers, currentRecovery, currentMeasurements, recoveryRecords } = selectAnalyticsCohort(snapshot, actor, query, now);
  const months = reportingMonths(period);
  const current = aggregate(currentBatches, matchingTransfers, recoveryRecords);
  const previous = aggregate(previousBatches, matchingTransfers, recoveryRecords);
  const engagementMetrics = engagement(interactions, period, query, actor);
  const comparisonPeriod = period.comparison?.label ?? '';
  const facilityMetrics = facilityView(currentBatches, currentTransfers, currentRecovery, facilities, period.capacityMonths);
  const regionalActivity = regions(currentBatches, currentTransfers, currentRecovery, facilities, users);
  const mass = calculateOperationalMass(currentBatches, currentTransfers);
  const completed = currentTransfers.filter((item) => item.status === 'Completed');
  const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

  return {
    metadata: {
      periodLabel: period.label,
      reportingCutoff: period.endDate,
      period,
      aggregateOnly: actor.scope.aggregateOnly,
      denominatorNote: `Diversion rate = verified completed reuse and recycling mass / unique declared batch mass. Asia/Manila batch-registration cohort; latest recorded outcomes through ${period.asOf}, not historical status snapshots. Capacity is prorated by the actual fraction of each calendar month. Comparison: ${period.comparisonBasis}.`,
      sampleDisclosure: 'All records with SYN- identifiers and all organizations labeled demo are synthetic sample data for development and presentation only.',
    },
    kpis: kpis(current, previous, engagementMetrics, regionalActivity, comparisonPeriod),
    wasteTrend: months.map((month) => {
      const value = aggregate(currentBatches.filter((batch) => manilaDate(new Date(batch.createdAt)).startsWith(month.key)), matchingTransfers, recoveryRecords);
      return { month: month.label, recorded: value.generatedKg, collected: value.collectedKg, recycled: value.recycledKg, reused: value.reusedKg };
    }),
    categoryShares: [...new Set(currentBatches.map((item) => item.materialCategory))].map((category) => {
      const value = aggregate(currentBatches.filter((item) => item.materialCategory === category), matchingTransfers, recoveryRecords);
      return { category, kilograms: value.collectedKg, recoveryRate: percent(value.reusedKg + value.recycledKg, value.collectedKg) };
    }).sort((a, b) => b.kilograms - a.kilograms),
    transactions: actor.scope.aggregateOnly ? [] : transactionsView(currentTransfers, currentBatches, users),
    stakeholders: actor.scope.aggregateOnly ? [] : stakeholderView(currentBatches, currentTransfers, users, facilities, facilityMetrics),
    facilities: actor.scope.aggregateOnly ? aggregateFacilities(facilityMetrics) : facilityMetrics,
    regionalActivity,
    circularFlow: { generatedKg: current.generatedKg, collectedKg: current.collectedKg, sortedKg: current.sortedKg, reusedKg: current.reusedKg, recycledKg: current.recycledKg, residualKg: Math.max(0, current.generatedKg - current.reusedKg - current.recycledKg) },
    impactMetrics: { landfillAvoidedKg: null, estimatedCo2eKg: null, estimatedWaterLiters: null, diversionRate: percent(current.reusedKg + current.recycledKg, current.generatedKg), sortingYield: percent(current.reusedKg + current.recycledKg, current.sortedKg), methodologyStatus: 'Disabled pending approved methodology' as const },
    barterMetrics: barter(currentBatchIds, listings, offers, currentTransfers, walletEntries),
    engagementMetrics,
    forecastData: forecast(months.map((month) => ({ month: month.label, ...aggregate(currentBatches.filter((batch) => manilaDate(new Date(batch.createdAt)).startsWith(month.key)), matchingTransfers, recoveryRecords) }))),
    operations: {
      period: { start: period.start, end: period.endExclusive, label: `${period.label} · Asia/Manila` },
      scope: { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, organizationIds: actor.scope.organizationIds },
      metrics: { batchCount: currentBatches.length, declaredKg: mass.declaredKg, measuredKg: sum(currentMeasurements.filter((item) => item.status === 'Measured').map((item) => item.weightKg)), verifiedKg: mass.verifiedKg, receivedKg: mass.receivedKg, completedTransfers: completed.length, activeTransfers: currentTransfers.filter((item) => !['Completed', 'Cancelled', 'Rejected'].includes(item.status)).length, diversionRate: mass.diversionRate, denominator: 'Verified kilograms in completed transfers / unique declared batch kilograms in scope' },
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
      processingTimeDays: 0, status: 'Aggregate only', isDemo: true as const };
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

export function filterBatches(batches: MaterialBatchRecord[], period: ReportingWindow, query: Record<string, unknown>, related: { transfers: TransferRecord[]; recoveryRecords: Array<{ batchId: string; facilityId: string }>; users: UserRecord[]; organizations: Array<{ id: string; name: string }> }) {
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
      && option(query.weightStatus, 'All weight statuses', batch.weightStatus)
      && option(query.organizationId, 'All organizations', batch.sourceOrganizationId ?? '')
      && (!producer || sourceName.includes(producer))
      && (!recycler || recipientNames.includes(recycler))
      && (stakeholderType === 'All stakeholders' || stakeholderType === 'Administrator' || source?.role === stakeholderType || batchTransfers.some((item) => users.get(item.recipientId)?.role === stakeholderType))
      && (String(query.facilityId ?? 'All facilities') === 'All facilities' || related.recoveryRecords.some((item) => item.batchId === batch.id && item.facilityId === query.facilityId))
      && (option(query.transactionType, 'All types', '') && option(query.transactionStatus, 'All statuses', batch.currentStatus) || batchTransfers.some((item) => transferMatches(item, query)));
  });
}
function option(value: unknown, all: string, actual: string) { const selected = String(value ?? all); return selected === all || selected === actual; }
function transferType(transfer: TransferRecord) { return transfer.circularOutcome === 'Recycling' ? 'Recycling' : transfer.circularOutcome === 'Redistribution' ? 'Redistribution' : 'Barter'; }
function transferStatus(transfer: TransferRecord) { if (transfer.status === 'Completed') return 'Completed'; if (transfer.status === 'Disputed' || transfer.status === 'Rejected') return 'Flagged'; if (transfer.status === 'Handed over') return 'In transit'; if (transfer.status === 'Received') return 'In sorting'; return 'Pending validation'; }
function transferMatches(transfer: TransferRecord, query: Record<string, unknown>) { return option(query.transactionType, 'All types', transferType(transfer)) && (option(query.transactionStatus, 'All statuses', transfer.status) || option(query.transactionStatus, 'All statuses', transferStatus(transfer))); }

export function aggregate(batches: MaterialBatchRecord[], transfers: TransferRecord[], recoveryRecords: Array<{ batchId: string; stage: string; outputWeightKg: number | null }>) {
  const ids = new Set(batches.map((item) => item.id));
  const scopedTransfers = transfers.filter((item) => ids.has(item.batchId) && item.status === 'Completed');
  const scopedRecovery = recoveryRecords.filter((item) => ids.has(item.batchId));
  return {
    generatedKg: round(batches.reduce((sum, item) => sum + item.declaredWeightKg, 0)),
    collectedKg: round(scopedRecovery.filter((item) => item.stage === 'Collection').reduce((sum, item) => sum + (item.outputWeightKg ?? 0), 0)),
    sortedKg: round(scopedRecovery.filter((item) => item.stage === 'Sorting').reduce((sum, item) => sum + (item.outputWeightKg ?? 0), 0)),
    reusedKg: round(scopedTransfers.filter((item) => ['Reuse', 'Repair', 'Redistribution', 'Upcycling'].includes(item.circularOutcome ?? '')).reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0)),
    recycledKg: round(scopedTransfers.filter((item) => item.circularOutcome === 'Recycling').reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0)),
    transactionCount: scopedTransfers.length,
  };
}

function kpis(current: ReturnType<typeof aggregate>, previous: ReturnType<typeof aggregate>, currentEngagement: ReturnType<typeof engagement>, regional: ReturnType<typeof regions>, comparisonPeriod: string) {
  const diverted = current.reusedKg + current.recycledKg; const previousDiverted = previous.reusedKg + previous.recycledKg;
  const comparison = (value: number, prior: number) => comparisonPeriod ? changeDescription(value, prior, comparisonPeriod) : 'No prior-period comparison';
  return [
    { label: 'Textile Waste Collected', value: formatMass(current.collectedKg), delta: comparison(current.collectedKg, previous.collectedKg), tone: 'moss' as const },
    { label: 'Textile Waste Recycled', value: formatMass(current.recycledKg), delta: comparison(current.recycledKg, previous.recycledKg), tone: 'ocean' as const },
    { label: 'Reused / Bartered', value: formatMass(current.reusedKg), delta: comparison(current.reusedKg, previous.reusedKg), tone: 'clay' as const },
    { label: 'Diverted from Landfill', value: formatMass(diverted), delta: `${percent(diverted, current.generatedKg)}% of generated waste`, tone: 'denim' as const },
    { label: 'Diversion Rate', value: current.generatedKg ? `${percent(diverted, current.generatedKg)}%` : 'Not available', delta: comparisonPeriod ? pointsDescription(diverted, current.generatedKg, previousDiverted, previous.generatedKg, comparisonPeriod) : 'Reused + recycled / generated', tone: 'moss' as const },
    { label: 'Monthly Active Users', value: currentEngagement.monthlyActiveUsersAvailable ? currentEngagement.monthlyActiveUsers.toLocaleString() : 'Not available', delta: currentEngagement.monthlyActiveUsersAvailable ? 'Reported summaries in final selected month' : 'No active-user summary for final selected month', tone: 'ocean' as const },
    { label: 'Active Producers', value: regional.reduce((sum, item) => sum + item.producers, 0).toString(), delta: 'Participants in selected cohort and scope', tone: 'clay' as const },
    { label: 'Active Recyclers', value: regional.reduce((sum, item) => sum + item.recyclers, 0).toString(), delta: 'Participants in selected cohort and scope', tone: 'denim' as const },
    { label: 'Total Transactions', value: current.transactionCount.toLocaleString(), delta: comparison(current.transactionCount, previous.transactionCount), tone: 'moss' as const },
  ];
}

function engagement(records: DashboardSourceSnapshot['interactions'], period: ReportingWindow | null, query: Record<string, unknown>, actor: UserRecord) {
  const region = String(query.region ?? 'All regions'); const city = String(query.city ?? '').trim().toLowerCase();
  const selected = records.filter(item => period && inReportingWindow(item.occurredAt, period)
    && (region === 'All regions' || item.properties.region === region) && (!city || item.properties.city?.toLowerCase().includes(city))
    && (actor.role === 'Administrator' || (['Government', 'Researcher'].includes(actor.role)
      ? !actor.scope.regions.length || actor.scope.regions.includes(item.properties.region ?? '')
      : item.userId === actor.id || Boolean(item.organizationId && [actor.organizationId, ...actor.scope.organizationIds].includes(item.organizationId)))));
  const count = (event: string) => selected.filter((item) => item.eventName === event).reduce((sum, item) => sum + Number(item.properties.count ?? 0), 0);
  const latest = period ? manilaDate(new Date(Date.parse(period.endExclusive) - 1)).slice(0, 7) : '';
  const sessions = selected.filter((item) => item.eventName === 'sessions');
  const sessionCount = count('sessions');
  const activeUsers = selected.filter(item => item.eventName === 'active_users' && manilaDate(new Date(item.occurredAt)).startsWith(latest));
  return { monthlyActiveUsers: activeUsers.reduce((sum, item) => sum + Number(item.properties.count ?? 0), 0), monthlyActiveUsersAvailable: activeUsers.length > 0, sessions: sessionCount, wasteSubmissions: count('waste_submissions'), barterActions: count('barter_actions'), reportExports: count('report_exports'), averageSessionMinutes: sessionCount ? Number((sessions.reduce((sum, item) => sum + Number(item.properties.averageSessionMinutes ?? 0) * Number(item.properties.count ?? 0), 0) / sessionCount).toFixed(1)) : 0 };
}

function transactionsView(transfers: TransferRecord[], batches: MaterialBatchRecord[], users: UserRecord[]) {
  const userMap = new Map(users.map((item) => [item.id, item])); const batchMap = new Map(batches.map((item) => [item.id, item]));
  return [...transfers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
    const batch = batchMap.get(item.batchId)!; const source = userMap.get(item.providerId); const destination = userMap.get(item.recipientId); const weight = item.verifiedWeightKg ?? item.receiptWeightKg ?? item.agreedWeightKg;
    return { id: item.id, date: item.updatedAt.slice(0, 10), source: source?.organization || source?.fullName || 'Synthetic source', destination: destination?.organization || destination?.fullName || 'Synthetic destination', type: transferType(item), textileCategory: item.materialCategory, weightKg: weight, location: `${batch.city}, ${batch.region}`, region: batch.region, status: transferStatus(item), impact: item.status === 'Completed' ? `${formatMass(weight)} verified circular outcome` : 'Outcome pending', estimatedImpactKg: undefined, sourceStakeholderId: item.providerId, destinationStakeholderId: item.recipientId, lifecycle: item.events.map((event) => ({ id: event.id, stage: event.type, actor: event.actorName, timestamp: event.timestamp, status: event.status, location: event.location, note: event.note })), isDemo: true as const };
  });
}

function stakeholderView(batches: MaterialBatchRecord[], transfers: TransferRecord[], users: UserRecord[], facilities: Array<{ id: string; organizationId: string }>, facilityMetrics: ReturnType<typeof facilityView>) {
  const ids = new Set([...batches.map((item) => item.sourceUserId), ...transfers.flatMap((item) => [item.providerId, item.recipientId])]);
  return users.filter((item) => ids.has(item.id)).map((user) => {
    const produced = batches.filter((item) => item.sourceUserId === user.id).reduce((sum, item) => sum + item.declaredWeightKg, 0);
    const recovered = transfers.filter((item) => item.recipientId === user.id && item.status === 'Completed').reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0);
    const relatedTransfers = transfers.filter((item) => item.providerId === user.id || item.recipientId === user.id);
    const ownedIds = new Set(facilities.filter(item => user.organizationId && item.organizationId === user.organizationId).map(item => item.id));
    const owned = facilityMetrics.filter(item => ownedIds.has(item.id));
    const capacity = owned.reduce((sum, item) => sum + item.capacityKg, 0), intake = owned.reduce((sum, item) => sum + item.intakeKg, 0);
    return { id: user.id, name: user.organization || user.fullName, type: user.role, city: user.city, region: user.region, recoveredKg: round(recovered), generatedKg: round(produced), capacityKg: capacity || undefined, utilization: capacity ? percent(intake, capacity) : undefined, participation: percent(relatedTransfers.filter(item => item.status === 'Completed').length, relatedTransfers.length), transactions: relatedTransfers.length, verification: user.verification, reliabilityPlaceholder: user.trustPlaceholder, sustainabilityActivities: user.profile.sustainabilityInterests, joinedAt: user.joinedAt.slice(0, 10), isDemo: true as const };
  }).sort((a, b) => b.transactions - a.transactions);
}

function facilityView(batches: MaterialBatchRecord[], transfers: TransferRecord[], recovery: Array<{ facilityId: string; batchId: string; stage: string; inputWeightKg: number; outputWeightKg: number | null; timestamp: string }>, facilities: Array<{ id: string; name: string; city: string; region: string; acceptedMaterials: string[]; monthlyCapacityKg: number; status: string }>, capacityMonths: number) {
  const batchIds = new Set(batches.map((item) => item.id));
  const latestFacility = new Map<string, string>();
  for (const record of [...recovery].sort((a,b) => a.timestamp.localeCompare(b.timestamp) || b.facilityId.localeCompare(a.facilityId))) latestFacility.set(record.batchId, record.facilityId);
  return facilities.filter((facility) => recovery.some((item) => item.facilityId === facility.id && batchIds.has(item.batchId))).map((facility) => {
    const records = recovery.filter((item) => item.facilityId === facility.id && batchIds.has(item.batchId));
    const entries = [...new Set(records.map(item => item.batchId))].map(id => records.filter(item => item.batchId === id).sort((a,b) => a.timestamp.localeCompare(b.timestamp))[0]);
    const intake = entries.reduce((sum, item) => sum + (item.stage === 'Collection' ? item.outputWeightKg ?? 0 : item.inputWeightKg), 0);
    // Attribute a batch's verified outcome to its latest recorded facility, not every facility it visited.
    const linked = new Set(records.filter(item => latestFacility.get(item.batchId) === facility.id).map(item => item.batchId));
    const processed = transfers.filter(item => linked.has(item.batchId) && item.status === 'Completed').reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0);
    const capacityKg = round(facility.monthlyCapacityKg * capacityMonths);
    return { id: facility.id, name: facility.name, location: facility.city, region: facility.region, acceptedTypes: facility.acceptedMaterials, capacityKg, utilization: percent(intake, capacityKg), intakeKg: round(intake), processedKg: round(processed), processingTimeDays: 2.4, status: facility.status, isDemo: true as const };
  });
}

function regions(batches: MaterialBatchRecord[], transfers: TransferRecord[], recovery: Array<{ batchId: string; stage: string; outputWeightKg: number | null }>, facilities: Array<{ region: string; type: string }>, users: UserRecord[]) {
  return [...new Set(batches.map((item) => item.region))].map((region) => {
    const regionBatches = batches.filter((item) => item.region === region); const ids = new Set(regionBatches.map((item) => item.id)); const regionTransfers = transfers.filter((item) => ids.has(item.batchId)); const regionRecovery = recovery.filter((item) => ids.has(item.batchId)); const value = aggregate(regionBatches, regionTransfers, regionRecovery); const [x, y] = mapCoordinates[region] ?? [50, 50];
    const role = new Map(users.map(user => [user.id, user.role]));
    return { region, city: regionBatches[0]?.city ?? '', collectionKg: value.collectedKg, recyclingKg: value.recycledKg, wasteGapKg: Math.max(0, value.generatedKg - value.reusedKg - value.recycledKg), producers: new Set(regionBatches.filter(item => role.get(item.sourceUserId) === 'Producer').map(item => item.sourceUserId)).size, collectionPoints: facilities.filter((item) => item.region === region && item.type === 'Collection point').length, recyclers: new Set(regionTransfers.filter(item => role.get(item.recipientId) === 'Recycler').map(item => item.recipientId)).size, x, y };
  }).sort((a, b) => b.collectionKg - a.collectionKg);
}

function barter(batchIds: Set<string>, listings: Array<{ id: string; batchId: string; status: string }>, offers: Array<{ listingId: string; status: string }>, transfers: TransferRecord[], wallet: Array<{ transferId: string | null; credits: number; type: string }>) {
  const scopedListings = listings.filter((item) => batchIds.has(item.batchId)); const listingIds = new Set(scopedListings.map((item) => item.id)); const scopedOffers = offers.filter((item) => listingIds.has(item.listingId)); const transferIds = new Set(transfers.filter((item) => batchIds.has(item.batchId)).map((item) => item.id));
  return { listings: scopedListings.length, matches: scopedOffers.length, validated: transfers.filter((item) => batchIds.has(item.batchId) && ['Validated', 'Completed'].includes(item.status)).length, completed: transfers.filter((item) => batchIds.has(item.batchId) && item.status === 'Completed').length, rewardCredits: wallet.filter((item) => item.type === 'Earned' && item.transferId && transferIds.has(item.transferId)).reduce((sum, item) => sum + item.credits, 0) };
}

function forecast(points: Array<{ month: string; generatedKg: number }>) { return points.map((point) => ({ month: point.month, historical: point.generatedKg, forecast: null as number | null })); }
function round(value: number) { return Number(value.toFixed(6)); }
