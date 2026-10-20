import { randomUUID } from 'node:crypto';
import { isCompletedTransfer } from '../shared/workflows.js';
import type { Express, Response } from 'express';
import { authorize, hasPermission } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { aggregate, buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort, type DashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildDataQuality } from './dataQuality.js';
import type { Store } from './store.js';
import type { UserRecord } from './types.js';
import { formatMass, MATERIAL_METRIC_LABELS, percentage, toTons } from '../shared/metrics.js';
import { ReportingInputError, type ReportDocument } from '../shared/reporting.js';

export const REPORT_DEFINITIONS = [
  { id: 'material-flow', name: 'Material Flow Summary', description: 'Declared textiles, physical receipts, reuse and recycling, by region and material. Includes reconciled cohort totals.', formats: ['CSV', 'Print / PDF'], available: true },
  { id: 'data-quality', name: 'Data Quality Summary', description: 'Measurement evidence, validation coverage and discrepancy findings using the configured threshold.', formats: ['CSV', 'Print / PDF'], available: true },
  { id: 'organizations', name: 'Organization Participation', description: 'Source and recipient participation, with de-identified regional summaries for aggregate-only accounts.', formats: ['CSV', 'Print / PDF'], available: true },
];
export function reportScope(actor: UserRecord) {
  return { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, canExport: hasPermission(actor, 'reports.export'), description: actor.scope.aggregateOnly ? `Aggregate/de-identified; ${actor.scope.regions.join(', ') || 'all authorized regions'}` : actor.role === 'Administrator' ? 'All authorized platform records' : 'Assigned organization, facility and individual scope' };
}
const filterNames: Record<string, string> = { dateRange: 'Date range', startDate: 'Custom start', endDate: 'Custom end', region: 'Region', city: 'City', textileType: 'Textile type', materialCategory: 'Material category', transactionType: 'Transaction type', stakeholderType: 'Stakeholder', producer: 'Producer search', recycler: 'Recycler search', wasteSource: 'Waste source', circularPathway: 'Circular pathway', weightStatus: 'Weight evidence', facilityId: 'Hub', organizationId: 'Organization', transactionStatus: 'Workflow status' };
export function validateReportQuery(query: Record<string, unknown>) {
  for (const [key, value] of Object.entries(query)) if (!filterNames[key] || typeof value !== 'string' || value.length > 200) throw new ReportingInputError('Unsupported or invalid report filter.');
  if (query.textileType && query.materialCategory && query.textileType !== query.materialCategory) throw new ReportingInputError('Material filters must agree.');
}
const tons = (kg: number) => String(Number(toTons(kg).toFixed(6)));
const count = (value: number) => value.toLocaleString('en-PH');

export async function buildReport(store: Store, actor: UserRecord, id: string, query: Record<string, unknown>, snapshot?: DashboardAnalyticsSnapshot, now = new Date()): Promise<ReportDocument> {
  const definition = REPORT_DEFINITIONS.find(item => item.id === id);
  if (!definition) throw Object.assign(new Error('Report not found.'), { status: 404 });
  validateReportQuery(query);
  const source = snapshot ?? await loadDashboardAnalyticsSnapshot(store);
  const context = selectAnalyticsCohort(source, actor, query, now);
  const { currentBatches: batches, currentTransfers: transfers, currentRecovery: recovery, period } = context;
  const data = await buildDashboardAnalytics(store, actor, query, source, now);
  const configuration = await store.findOne('configurations', item => item.id === 'platform');
  const quality = buildDataQuality(actor, batches, transfers, configuration?.discrepancyThresholdPercent ?? 5, now, source);
  const report: ReportDocument = {
    id, title: definition.name, generatedAt: period.asOf, period, scope: reportScope(actor),
    filters: Object.entries(query).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => ({ label: filterNames[key], value: actor.scope.aggregateOnly && ['producer', 'recycler', 'organizationId', 'facilityId'].includes(key) && !String(value).startsWith('All ') ? 'Applied (identifier withheld)' : String(value) })),
    summary: [], interpretation: [], definitions: [], columns: [], rows: [], notes: [data.metadata.denominatorNote,
      'Mass is expressed in metric tons (t); 1 t = 1,000 kg. Detailed data retains up to six decimal places; summary values are rounded for reading. Missing evidence is not a measured zero.',
      data.metadata.sampleDisclosure,
      'Consumer-posted textiles are assumed recyclable, not technically certified. Posting and listing-scale weights do not establish collection. Hub collection/disposal is separate from recycler processing output.',
      'The selected dates filter batch registration, not completion events. Latest recorded outcomes are not a reconstruction of status at the end of a historical period.',
      'The separate synthetic predictive dataset and its fixed cutoff are not used in these operational reports.'],
  };
  if (id === 'material-flow') {
    report.columns = ['Region', 'Material', 'Unique batches', `${MATERIAL_METRIC_LABELS.declared} (t)`, `${MATERIAL_METRIC_LABELS.received} (t)`, 'Confirmed reuse (t)', 'Confirmed recycling (t)', 'Received outcome unconfirmed (t)', 'Confirmed recovery share (%)', 'Completed transfer mass (t)', 'Completed transfers missing weight'];
    const keys = [...new Set(batches.map(item => JSON.stringify([item.region, item.materialCategory])))].sort();
    const makeRow = (region: string, category: string, selected: typeof batches) => {
      const flow = aggregate(selected, transfers, recovery, { measurements: context.currentMeasurements, listings: source.listings, users: source.users });
      return [region || 'Not recorded', category || 'Not recorded', String(selected.length), tons(flow.generatedKg), flow.collectedBatches ? tons(flow.collectedKg) : 'Pending evidence', flow.reuseRecords ? tons(flow.reusedKg) : 'Pending evidence', flow.recyclingRecords ? tons(flow.recycledKg) : 'Pending evidence', flow.collectedBatches ? tons(flow.unresolvedCollectedKg) : 'Pending evidence', flow.diversionRate === null ? 'Not available' : String(flow.diversionRate), flow.completedWithWeight ? tons(flow.completedKg) : 'Pending evidence', String(flow.completedMissingWeight)];
    };
    report.rows = keys.map(key => { const [region, category] = JSON.parse(key) as string[]; return makeRow(region, category, batches.filter(item => item.region === region && item.materialCategory === category)); });
    report.rows.push(makeRow('TOTAL', 'All selected materials', batches));
    const flow = data.circularFlow, evidence = data.materialEvidence;
    const hasOutput = flow.reusedAvailable || flow.recycledAvailable;
    report.summary = [
      { label: 'Unique batches', value: count(batches.length), description: 'Distinct material batches registered within the selected dates and scope.' },
      { label: MATERIAL_METRIC_LABELS.declared, value: formatMass(flow.generatedKg), description: 'Reported weights entered for unique batches; matches the Overview declaration total under the same filters.' },
      { label: MATERIAL_METRIC_LABELS.received, value: flow.collectedAvailable ? formatMass(flow.collectedKg) : 'Pending evidence', description: 'Physical intake supported by validated evidence; separate from declared weight.' },
      { label: 'Confirmed reuse + recycling', value: hasOutput ? formatMass(flow.reusedKg + flow.recycledKg) : 'Pending evidence', description: 'All accepted final reuse/recycling output; some may lack a matching intake.' },
      { label: 'Confirmed recovery share', value: data.impactMetrics.diversionRate !== null ? `${data.impactMetrics.diversionRate}%` : 'Not available', description: 'Matched final outcomes / physically received weight; not declared weight or landfill diversion.' },
      { label: 'Received outcome unconfirmed', value: flow.collectedAvailable ? formatMass(evidence.unresolvedCollectedKg) : 'Pending evidence', description: 'Physically received mass without confirmed recovery; not necessarily stock or disposal.' },
    ];
    report.interpretation = [
      { label: 'What was recorded', text: `${count(batches.length)} unique batches declare ${formatMass(flow.generatedKg)} entered into the platform. ${flow.collectedAvailable ? `${formatMass(flow.collectedKg)} is separately supported as physically received; ${count(evidence.missingCollectionBatches)} batches still lack supported receipt evidence.` : 'No supported physical receipt weight is available. Declared weights remain counted as platform entries, not as physical receipts.'}` },
      { label: 'What was recovered', text: hasOutput ? `${flow.reusedAvailable ? formatMass(flow.reusedKg) : 'No confirmed weight'} is recorded for reuse and ${flow.recycledAvailable ? formatMass(flow.recycledKg) : 'no confirmed weight'} for recycling. These are final outcomes, not recyclable stock or completed-transfer quantities.` : 'No confirmed final reuse or recycling output is available. This means evidence is missing, not that nothing was recovered.' },
      { label: 'How the percentage works', text: data.impactMetrics.diversionRate !== null ? `${formatMass(evidence.matchedDiversionKg)} of confirmed outcomes is linked to ${formatMass(flow.collectedKg)} of physically received textiles: ${data.impactMetrics.diversionRate}%. ${evidence.unlinkedOutcomeKg > 0 ? `${formatMass(evidence.unlinkedOutcomeKg)} of additional outcomes has no matching supported receipt and is excluded from this percentage.` : 'Only matched outcomes enter this calculation.'}` : 'The recovery share cannot be established from the available evidence. It requires supported physically received weight, a matched final outcome and no conflicting intake or outcome allocations; unavailable is not 0%.' },
      { label: 'What remains unconfirmed', text: flow.collectedAvailable ? `${formatMass(evidence.unresolvedCollectedKg)} of physically received material has no confirmed recovery outcome. It may include material awaiting processing, losses, rejects or incomplete records. It is not automatically landfill waste or Hub disposal.` : 'Without supported physical intake, the amount awaiting a confirmed outcome cannot be established.' },
      { label: 'Transfers are separate', text: evidence.completedWithWeight ? `${formatMass(evidence.completedKg)} is recorded across completed transfers with final weights. Transfers describe movement and may repeat the same material, so their mass must not be added to collection or recovery totals. ${count(evidence.completedMissingWeight)} completed transfers lack final weight and are excluded from transfer mass.` : `No completed-transfer mass with final-weight evidence is available. ${count(evidence.completedMissingWeight)} completed transfers lack final weight. Agreed quantities are not used as a substitute.` },
    ];
    const leadingRegion = data.regionalActivity.find(item => item.collectionAvailable && item.collectionKg > 0);
    if (leadingRegion) report.interpretation.push({ label: 'Largest recorded physical intake', text: `Within these selected records, ${leadingRegion.region || 'the region not recorded group'} has the largest supported physically received weight at ${formatMass(leadingRegion.collectionKg)}. This compares recorded activity, not national waste generation or actual service coverage.` });
    report.definitions = [
      { label: `${MATERIAL_METRIC_LABELS.declared} (t)`, text: 'Reported textile weights entered into the platform, counted once per batch. Does not require physical receipt or transfer completion.' },
      { label: `${MATERIAL_METRIC_LABELS.received} (t)`, text: 'Physical intake supported by validated evidence. Separate from declarations; missing evidence is shown as pending, not zero.' },
      { label: 'Confirmed reuse / recycling (t)', text: 'Validated final outcomes. An outcome may be known even when its intake evidence is missing.' },
      { label: 'Received outcome unconfirmed (t)', text: 'Physically received mass minus its matched confirmed outcomes. It is not a measured stock balance or landfill-disposal amount.' },
      { label: 'Confirmed recovery share (%)', text: 'Matched confirmed reuse and recycling / physically received weight x 100. Declared weight is not the denominator. Outcomes without matching intake are excluded. Group percentages must not be summed or averaged.' },
      { label: 'Completed transfer mass (t)', text: 'Final validated weight, otherwise reported receipt weight, for completed transfers. Material may move more than once; this is not unique recovery.' },
      { label: 'Pending evidence / Not available', text: 'Insufficient or conflicting evidence. These labels must not be interpreted as numerical zero.' },
    ];
    report.notes.push('Completed transfer mass is activity, not unique recovered material. Approved validation weight is preferred; reported receipt weight is used when validation is absent. Agreed quantities are excluded. Unconfirmed collected mass is not measured landfill disposal. Collection/output conflicts and unallocated multi-transfer outcomes are withheld.');
  } else if (id === 'data-quality') {
    report.columns = ['Metric / finding category', 'Count / value', 'Unit', 'Denominator / rule'];
    report.rows = [
      ['Unique batches', String(batches.length), 'batches', 'Selected registration cohort'],
      ['Awaiting weighing batches', String(batches.filter(item => item.declaredWeightKg === null).length), 'batches', 'Missing weights are excluded from mass totals, not treated as measured zero'],
      ...['Estimated', 'Measured', 'Verified'].map(status => [`${status} batches`, String(batches.filter(item => item.weightStatus === status).length), 'batches', 'Unique selected batches']),
      ['Validation coverage', batches.length ? String(quality.summary.validationCoveragePercent) : 'Not available', '%', 'Verified batches / unique selected batches'],
      ['Discrepancy threshold', String(quality.thresholdPercent), '%', 'Absolute discrepancy / handover mass; agreed mass if handover is absent'],
      ...[...new Set(quality.issues.map(item => `${item.severity}: ${item.category}`))].sort().map(category => [category, String(quality.issues.filter(item => `${item.severity}: ${item.category}` === category).length), 'findings', 'Same rules as Data Quality monitoring']),
    ];
    report.summary = [{ label: 'Findings', value: count(quality.summary.totalIssues) }, { label: 'Critical', value: count(quality.summary.critical) }, { label: 'Warnings', value: count(quality.summary.warnings) }];
    report.interpretation = [
      { label: 'What this report measures', text: `${count(quality.summary.totalIssues)} data-quality findings were identified: ${count(quality.summary.critical)} critical and ${count(quality.summary.warnings)} warnings. One batch or transfer can have multiple findings, so these are not counts of distinct affected materials.` },
      { label: 'What needs attention', text: quality.summary.totalIssues ? `Review critical findings first, then missing weights, incomplete links and discrepancies. The configured discrepancy threshold is ${quality.thresholdPercent}%; findings use the same checks as Data Quality monitoring.` : 'No findings were triggered by the configured checks in this scope. This is not proof that every record is accurate or independently verified.' },
    ];
    report.notes.push('Findings can overlap on a single batch or transfer; total findings are not a count of unique affected materials.');
  } else if (id === 'organizations') {
    const users = new Map(source.users.map(item => [item.id, item]));
    const organizations = new Map(source.organizations.map(item => [item.id, item]));
    const organizationIds = new Set([...batches.map(item => item.sourceOrganizationId), ...transfers.flatMap(item => [users.get(item.providerId)?.organizationId, users.get(item.recipientId)?.organizationId])].filter((item): item is string => Boolean(item)));
    const records = [...organizationIds].map(organizationId => {
      const organization = organizations.get(organizationId);
      const sourceBatches = batches.filter(item => item.sourceOrganizationId === organizationId);
      const linked = transfers.filter(item => users.get(item.providerId)?.organizationId === organizationId || users.get(item.recipientId)?.organizationId === organizationId);
      return { id: organizationId, name: organization?.name ?? 'Unregistered organization', type: organization?.type ?? 'Unknown', region: organization?.region ?? sourceBatches[0]?.region ?? 'Unknown', batches: sourceBatches.length, declared: sourceBatches.reduce((sum, item) => sum + (item.declaredWeightKg ?? 0), 0), received: linked.filter(item => isCompletedTransfer(item.status) && users.get(item.recipientId)?.organizationId === organizationId).reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0), transfers: linked.length };
    });
    report.columns = [actor.scope.aggregateOnly ? 'Region / stakeholder group' : 'Organization', 'Region', 'Stakeholder type', 'Organizations', 'Source batches', 'Declared textiles as source (t)', 'Verified received (t)', 'Transfer involvements'];
    if (actor.scope.aggregateOnly) {
      const groups = [...new Set(records.map(item => JSON.stringify([item.region, item.type])))].sort();
      report.rows = groups.map(key => {
        const [region, type] = JSON.parse(key) as string[];
        const items = records.filter(item => item.region === region && item.type === type);
        return ['De-identified group', region, type, String(items.length), String(items.reduce((sum, item) => sum + item.batches, 0)), tons(items.reduce((sum, item) => sum + item.declared, 0)), tons(items.reduce((sum, item) => sum + item.received, 0)), String(items.reduce((sum, item) => sum + item.transfers, 0))];
      });
    } else report.rows = records.sort((a, b) => a.name.localeCompare(b.name)).map(item => [item.name, item.region, item.type, '1', String(item.batches), tons(item.declared), tons(item.received), String(item.transfers)]);
    report.summary = [{ label: 'Participating organizations', value: count(records.length) }, { label: 'Unique selected transfers', value: count(transfers.length) }];
    report.interpretation = [
      { label: 'Who is represented', text: `${count(records.length)} organizations are linked to source batches or transfers in the selected cohort. Participants without an organization are excluded. ${actor.scope.aggregateOnly ? 'Names and identifiers are withheld; rows are regional stakeholder groups.' : 'Each row describes an organization, not an individual account.'}` },
      { label: 'How to read participation', text: `${count(transfers.length)} unique transfers are selected. A transfer may involve two organizations, so transfer involvements must not be summed as unique transactions. Declared source mass and received mass describe different roles, not additive material flows.` },
    ];
    report.notes.push('Organization source mass and recipient mass are different roles, not additive flows. A transfer can involve two organizations; involvements must not be summed as unique transactions. Individual participants without an organization are excluded from organization counts.');
  }
  report.interpretation!.push({ label: 'Reporting basis', text: `Dates select batch registration, with outcomes known as of ${new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })} PHT; they do not select when collection or completion occurred. ${data.metadata.sampleDisclosure}` });
  return report;
}

export function reportCsv(report: ReportDocument) {
  const width = Math.max(3, report.columns.length);
  const rows = [
    ['Report', report.title], ['Reporting period', report.period.label],
    ['Generated (PHT)', new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Manila' })], ['Access scope', report.scope.description], [],
    ['SUMMARY'], ['Metric', 'Value', 'Meaning'], ...report.summary.map(item => [item.label, item.value, item.description ?? '']), [],
    ['INTERPRETATION'], ['Topic', 'Explanation'], ...(report.interpretation ?? []).map(item => [item.label, item.text]), [],
    ['DETAILED DATA'], report.columns, ...report.rows, [],
    ...(report.definitions?.length ? [['DEFINITIONS'], ...report.definitions.map(item => [item.label, item.text]), []] : []),
    ['FILTERS'], ...(report.filters.length ? report.filters.map(item => [item.label, item.value]) : [['Selection','Default reporting filters']]), [],
    ['LIMITATIONS & TECHNICAL NOTES'], ...report.notes.map(note => ['Note', note]),
    ['Generated at (UTC)', report.generatedAt], ['Reporting timezone', report.period.timeZone], ['Start (inclusive)', report.period.start], ['End (exclusive)', report.period.endExclusive],
  ];
  const cell = (value: string) => {
    const safe = /^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return '\uFEFF' + rows.map(row => Array.from({ length: width }, (_, index) => cell(row[index] ?? '')).join(',')).join('\r\n') + '\r\n';
}

export function registerReportRoutes(app: Express, store: Store, clock: () => Date = () => new Date()) {
  app.use('/api/reports', (_req, res, next) => { res.setHeader('Cache-Control', 'private, no-store'); next(); });
  app.get('/api/reports', requireAuth, authorize(store, 'reports.read'), (req: AuthenticatedRequest, res) => res.json({ reports: REPORT_DEFINITIONS, scope: reportScope(req.actor!) }));
  const render = (exporting: boolean) => async (req: AuthenticatedRequest, res: Response) => {
    const { format, ...filters } = req.query;
    if (format !== undefined && (!exporting || !['csv', 'print'].includes(String(format)) || typeof format !== 'string')) throw new ReportingInputError('Unsupported export format.');
    const report = await buildReport(store, req.actor!, String(req.params.reportId), filters, undefined, clock());
    if (exporting) await store.insert('auditRecords', { id: `AUD-${randomUUID()}`, actorId: req.actor!.id, action: 'report.exported', entityType: 'Report', entityId: report.id, timestamp: report.generatedAt, details: JSON.stringify({ format: format ?? 'csv', rows: report.rows.length, period: report.period, role: report.scope.role, aggregateOnly: report.scope.aggregateOnly, filters: report.filters }) });
    if (!exporting || format === 'print') return res.json(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="baliktela-${report.id}-${report.period.startDate}-${report.period.endDate}.csv"`);
    return res.send(reportCsv(report));
  };
  app.get('/api/reports/:reportId/preview', requireAuth, authorize(store, 'reports.read'), render(false));
  app.get('/api/reports/:reportId/export', requireAuth, authorize(store, 'reports.read'), authorize(store, 'reports.export'), render(true));
}
