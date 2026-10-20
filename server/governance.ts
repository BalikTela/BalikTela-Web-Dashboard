import type { Express } from 'express';
import { authorize, hasPermission, scopeFacilities } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { loadDashboardAnalyticsSnapshot, selectAnalyticsCohort } from './dashboardAnalytics.js';
import { aggregateMaterialEvidence } from './materialEvidence.js';
import { buildDataQuality } from './dataQuality.js';
import { buildHubDisposalMonitoring } from './hubs.js';
import { identifyHubOperators } from './stakeholders.js';
import { validateReportQuery } from './reports.js';
import { isApprovedHub, isHubWeighingMeasurement } from '../shared/hubs.js';
import { percentage } from '../shared/metrics.js';
import type { GovernanceMonitoring, PolicyMetrics, ProducerPolicyRow } from '../shared/governance.js';
import type { DashboardSourceSnapshot, Store } from './store.js';
import type { ConfigurationRecord, MaterialBatchRecord, UserRecord } from './types.js';

export function buildGovernance(actor: UserRecord, configuration: ConfigurationRecord | null) {
  const aggregateOnly = actor.role === 'Government' || actor.scope.aggregateOnly;
  return {
    methodology: {
      massAccounting: 'Total Textiles Declared sums reported batch weights entered into the platform. Textiles Physically Received is separately supported physical intake. Confirmed recovery share = matched validated final reuse and recycling output / physically received weight in the same registration cohort, not declared weight. Transfers and stage weights are not additive.',
      environmentalImpact: 'CO2e, water savings and landfill avoidance are not calculated without an approved methodology. Hub disposal is reported separately from recovered output.',
      predictiveAnalytics: 'Bundled synthetic training data; chronological holdout evaluation and regional history gates. Forecasts are estimates, not measured operational outcomes.',
      version: configuration?.methodologyVersion ?? 'Not approved',
    },
    privacy: { role: actor.role, aggregateOnly, exportAllowed: hasPermission(actor, 'reports.export'), policy: aggregateOnly ? 'Aggregate/de-identified access' : actor.role === 'Administrator' ? 'Authorized system administration' : 'Authorized regional, organization or individual scope' },
    policyIndicators: [
      { label: 'PoC reporting scope', status: 'Combined', caveat: 'Synthetic scenario records and shared operational records appear together under the same calculations. Original source classifications remain in the database and audit history. Combined totals illustrate the PoC and are not independently measured real-world outcomes. Engagement uses reported summaries; the fixed predictive dataset is separate from imported lifecycle records.' },
      { label: 'Collection and recovery evidence', status: 'Available', caveat: 'Validated intake and final output are separate. Missing evidence is not an observed zero; the reporting window selects batch registration.' },
      { label: 'Hub disposal oversight', status: 'Monitoring', caveat: 'Hubs collect and dispose textiles, not certify recycling output. Consumer listings are assumed recyclable. Web monitors collection evidence and mobile disposal records separately; a disposal record alone does not prove landfill avoidance.' },
      { label: 'Data quality', status: 'Available', caveat: 'Rule-based findings use scoped batch, listing, transfer, measurement and recovery records; they are not an independent accuracy certification.' },
      { label: 'EPR reporting support', status: 'Preparation only', caveat: 'Requires approved definitions, reporting boundaries and review. No statutory compliance certification is issued by this dashboard.' },
      { label: 'Environmental equivalents', status: 'Disabled', caveat: 'No approved conversion factors, counterfactual landfill baseline or final-destination verification.' },
    ],
  };
}

export async function buildGovernanceDashboard(store: Store, actor: UserRecord, query: Record<string, unknown> = {}, suppliedSnapshot?: DashboardSourceSnapshot, now = new Date()) {
  validateReportQuery(query);
  const snapshot = suppliedSnapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const configuration = await store.findOne('configurations', item => item.id === 'platform');
  const base = buildGovernance(actor, configuration);
  const cohort = selectAnalyticsCohort(snapshot, actor, query, now);
  const { currentBatches, previousBatches, currentTransfers, currentMeasurements, matchingTransfers, recoveryRecords, period } = cohort;
  const context = { measurements: snapshot.measurements.filter(item => Date.parse(item.timestamp) <= now.getTime()), listings: snapshot.listings, users: snapshot.users };
  const summarize = (batches: MaterialBatchRecord[]): PolicyMetrics => {
    const value = aggregateMaterialEvidence(batches, matchingTransfers, recoveryRecords, context);
    return { batches: batches.length, declaredKg: value.generatedKg,
      collectedKg: value.collectedBatches ? value.collectedKg : null,
      recyclableCollectedKg: value.collectedBatches ? value.recyclableCollectedKg : null,
      reusedKg: value.reuseRecords ? value.reusedKg : null, recycledKg: value.recyclingRecords ? value.recycledKg : null,
      recoveryShare: value.diversionRate, matchedRecoveryKg: value.matchedDiversionKg,
      unconfirmedCollectedKg: value.unresolvedCollectedKg, missingIntake: value.missingCollectionBatches,
      conflicts: value.collectionConflicts + value.outcomeConflicts, completedTransfers: value.transactionCount,
      intakeCoverage: batches.length ? percentage(value.collectedBatches, batches.length) : null };
  };
  const evidence = aggregateMaterialEvidence(currentBatches, matchingTransfers, recoveryRecords, context);
  const summary = summarize(currentBatches), previous = summarize(previousBatches);
  const quality = buildDataQuality(actor, currentBatches, currentTransfers, configuration?.discrepancyThresholdPercent ?? 5, now, snapshot);
  const hubs = identifyHubOperators(snapshot, now);
  const approvedHubIds = new Set(snapshot.users.filter(user => hubs.has(user.id) && isApprovedHub(user)).map(user => user.id));
  const facilities = scopeFacilities(actor, snapshot.facilities).filter(item => item.status !== 'Inactive'
    && (!query.facilityId || query.facilityId === 'All facilities' || item.id === query.facilityId)
    && (!query.organizationId || query.organizationId === 'All organizations' || item.organizationId === query.organizationId)
    && (!query.city || item.city.toLowerCase().includes(String(query.city).trim().toLowerCase()))
    && (!query.textileType || query.textileType === 'All textiles' || item.acceptedMaterials.includes(String(query.textileType))));
  const regions = [...new Set(currentBatches.map(item => item.region))].sort().map(region => {
    const batches = currentBatches.filter(item => item.region === region), ids = new Set(batches.map(item => item.id));
    const readings = currentMeasurements.filter(item => ids.has(item.batchId) && isHubWeighingMeasurement(item));
    const operators = new Set([...snapshot.listings.filter(item => ids.has(item.batchId)).map(item => item.weighingHubId), ...readings.map(item => item.recordedBy)]);
    const metrics = summarize(batches), prior = summarize(previousBatches.filter(item => item.region === region));
    return { ...metrics, region: region || 'Location not recorded', previousCollectedKg: prior.collectedKg,
      collectionChangePercent: metrics.collectedKg !== null && prior.collectedKg !== null && prior.collectedKg > 0
        ? Number(((metrics.collectedKg - prior.collectedKg) / prior.collectedKg * 100).toFixed(1)) : null,
      participatingSources: new Set(batches.map(item => item.sourceUserId)).size,
      approvedHubs: [...operators].filter(id => id && approvedHubIds.has(id)).length,
      hubWeighedBatches: new Set(readings.map(item => item.batchId)).size,
      facilities: facilities.filter(item => item.region === region).length };
  });
  const users = new Map(snapshot.users.map(item => [item.id, item])), organizations = new Map(snapshot.organizations.map(item => [item.id, item]));
  const producerBatches = currentBatches.filter(item => users.get(item.sourceUserId)?.role === 'Producer');
  const producerNamesRestricted = base.privacy.aggregateOnly;
  const groups = new Map<string, MaterialBatchRecord[]>();
  for (const batch of producerBatches) {
    const key = producerNamesRestricted ? batch.region : JSON.stringify([batch.sourceOrganizationId ?? batch.sourceUserId, batch.region]);
    groups.set(key, [...groups.get(key) ?? [], batch]);
  }
  const producers: ProducerPolicyRow[] = [...groups.values()].map((batches, index) => {
    const first = batches[0];
    return { ...summarize(batches), key: `producer-group-${index}`, region: first.region || 'Location not recorded',
      name: producerNamesRestricted ? 'Producer regional aggregate' : organizations.get(first.sourceOrganizationId ?? '')?.name || users.get(first.sourceUserId)?.organization || 'Producer account',
      sources: new Set(batches.map(item => item.sourceUserId)).size };
  }).sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
  const disposals = await buildHubDisposalMonitoring(store, actor, query, now, snapshot);
  const monitoring: GovernanceMonitoring = {
    periodLabel: period.label, comparisonLabel: period.comparison?.label ?? null, asOf: period.asOf, summary, previous, regions, producers, producerNamesRestricted,
    participatingOrganizations: new Set(currentBatches.map(item => item.sourceOrganizationId).filter(Boolean)).size,
    quality: { ...quality.summary, thresholdPercent: quality.thresholdPercent },
    evidence: { reportedReceiptTransfers: evidence.completedReportedWeight, missingTransferWeights: evidence.completedMissingWeight,
      unlinkedOutcomeKg: evidence.unlinkedOutcomeKg, missingGeography: currentBatches.filter(item => !item.city.trim() || !item.region.trim()).length },
    hubDisposals: { available: disposals.available, records: disposals.summary.records, disposedKg: disposals.available ? disposals.summary.disposedKg : null, invalidRecords: disposals.summary.invalidRecords },
    notes: ['Dates select batch registration in Asia/Manila; outcomes are the latest recorded through the reporting timestamp, not historical status snapshots.',
      'Collection, transfers, sorting and final outcomes describe overlapping stages. Do not add their masses. Recyclable classification does not establish recycling output.',
      'Recovery share uses matched validated final reuse/recycling output divided by physically received weight, not declared weight. Missing evidence is not an observed zero.',
      'Regional activity describes participating platform records, not national waste generation. Missing locations are retained as an unattributed group.',
      'Producer evidence follows the source batch, not downstream ownership; roles and approvals reflect current account records. Regional producer groups may overlap in participants.',
      'Approved Hub participation follows assignments and historical handling evidence. Listing weighings are legacy history, not proof of physical collection. Facility counts are registered matching sites, not proof of service coverage.',
      'Hub disposal includes archived batch history under the same registration filters. Disposal is separate from recovery and does not establish landfill diversion.',
      'Synthetic scenario and shared operational records are combined for this PoC; provenance is retained. Combined totals are not independently measured real-world outcomes.'],
  };
  return { ...base, monitoring };
}

export function registerGovernanceRoutes(app: Express, store: Store, readSnapshot = () => loadDashboardAnalyticsSnapshot(store), clock = () => new Date()) {
  app.get('/api/governance', requireAuth, authorize(store, 'governance.read'), async (req: AuthenticatedRequest, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    validateReportQuery(req.query);
    res.json(await buildGovernanceDashboard(store, req.actor!, req.query, await readSnapshot(), clock()));
  });
}
