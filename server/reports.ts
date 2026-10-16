import { randomUUID } from 'node:crypto';
import type { Express, Response } from 'express';
import { authorize, hasPermission } from './access-control.js';
import { requireAuth, type AuthenticatedRequest } from './auth.js';
import { aggregate, buildDashboardAnalytics, loadDashboardAnalyticsSnapshot, selectAnalyticsCohort, type DashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildDataQuality } from './dataQuality.js';
import type { Store } from './store.js';
import type { UserRecord } from './types.js';
import { percentage, toTons } from '../shared/metrics.js';
import { ReportingInputError, type ReportDocument } from '../shared/reporting.js';

export const REPORT_DEFINITIONS = [
  { id: 'material-flow', name: 'Material Flow Summary', description: 'Declared, collected, reused and recycled mass, by region and material. Includes reconciled cohort totals.', formats: ['CSV', 'Print / PDF'], available: true },
  { id: 'data-quality', name: 'Data Quality Summary', description: 'Measurement evidence, validation coverage and discrepancy findings using the configured threshold.', formats: ['CSV', 'Print / PDF'], available: true },
  { id: 'organizations', name: 'Organization Participation', description: 'Source and recipient participation, with de-identified regional summaries for aggregate-only accounts.', formats: ['CSV', 'Print / PDF'], available: true },
  { id: 'environmental-impact', name: 'Environmental Methodology Status', description: 'Approved-methodology status and measured platform inputs. No unvalidated environmental equivalents.', formats: ['CSV', 'Print / PDF'], available: true },
];
export function reportScope(actor: UserRecord) {
  return { role: actor.role, aggregateOnly: actor.scope.aggregateOnly, canExport: hasPermission(actor, 'reports.export'), description: actor.scope.aggregateOnly ? `Aggregate/de-identified; ${actor.scope.regions.join(', ') || 'all authorized regions'}` : actor.role === 'Administrator' ? 'All authorized platform records' : 'Assigned organization, facility and individual scope' };
}
const filterNames: Record<string, string> = { dateRange: 'Date range', startDate: 'Custom start', endDate: 'Custom end', region: 'Region', city: 'City', textileType: 'Textile type', materialCategory: 'Material category', transactionType: 'Transaction type', stakeholderType: 'Stakeholder', producer: 'Producer search', recycler: 'Recycler search', wasteSource: 'Waste source', circularPathway: 'Circular pathway', weightStatus: 'Weight evidence', facilityId: 'Facility', organizationId: 'Organization', transactionStatus: 'Workflow status' };
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
  const quality = buildDataQuality(actor, batches, transfers, configuration?.discrepancyThresholdPercent ?? 5, now);
  const report: ReportDocument = {
    id, title: definition.name, generatedAt: period.asOf, period, scope: reportScope(actor),
    filters: Object.entries(query).filter(([, value]) => value !== '' && value !== undefined).map(([key, value]) => ({ label: filterNames[key], value: actor.scope.aggregateOnly && ['producer', 'recycler', 'organizationId', 'facilityId'].includes(key) && !String(value).startsWith('All ') ? 'Applied (identifier withheld)' : String(value) })),
    summary: [], columns: [], rows: [], notes: [data.metadata.denominatorNote,
      'Mass is expressed in metric tons (t); 1 t = 1,000 kg. Exports retain up to six decimal places. UI values may be rounded.',
      data.metadata.sampleDisclosure,
      'The selected dates filter batch registration, not completion events. Latest recorded outcomes are not a reconstruction of status at the end of a historical period.',
      'The separate synthetic predictive dataset and its fixed cutoff are not used in these operational reports.'],
  };
  if (id === 'material-flow') {
    report.columns = ['Region', 'Material', 'Unique batches', 'Declared (t)', 'Collected (t)', 'Reused (t)', 'Recycled (t)', 'Not verified diverted (t)', 'Diversion rate (%)'];
    const keys = [...new Set(batches.map(item => JSON.stringify([item.region, item.materialCategory])))].sort();
    const makeRow = (region: string, category: string, selected: typeof batches) => {
      const flow = aggregate(selected, transfers, recovery);
      const diverted = flow.reusedKg + flow.recycledKg;
      return [region, category, String(selected.length), tons(flow.generatedKg), tons(flow.collectedKg), tons(flow.reusedKg), tons(flow.recycledKg), tons(Math.max(0, flow.generatedKg - diverted)), flow.generatedKg ? String(percentage(diverted, flow.generatedKg)) : 'Not available'];
    };
    report.rows = keys.map(key => { const [region, category] = JSON.parse(key) as string[]; return makeRow(region, category, batches.filter(item => item.region === region && item.materialCategory === category)); });
    report.rows.push(makeRow('TOTAL', 'All selected materials', batches));
    report.summary = [{ label: 'Unique batches', value: count(batches.length) }, { label: 'Declared mass', value: `${tons(data.circularFlow.generatedKg)} t` }, { label: 'Collected mass', value: `${tons(data.circularFlow.collectedKg)} t` }, { label: 'Verified reused + recycled', value: `${tons(data.circularFlow.reusedKg + data.circularFlow.recycledKg)} t` }, { label: 'Diversion rate', value: batches.length && data.circularFlow.generatedKg ? `${data.impactMetrics.diversionRate}%` : 'Not available' }];
  } else if (id === 'data-quality') {
    report.columns = ['Metric / finding category', 'Count / value', 'Unit', 'Denominator / rule'];
    report.rows = [
      ['Unique batches', String(batches.length), 'batches', 'Selected registration cohort'],
      ...['Estimated', 'Measured', 'Verified'].map(status => [`${status} batches`, String(batches.filter(item => item.weightStatus === status).length), 'batches', 'Unique selected batches']),
      ['Validation coverage', batches.length ? String(quality.summary.validationCoveragePercent) : 'Not available', '%', 'Verified batches / unique selected batches'],
      ['Discrepancy threshold', String(quality.thresholdPercent), '%', 'Absolute discrepancy / handover mass; agreed mass if handover is absent'],
      ...[...new Set(quality.issues.map(item => `${item.severity}: ${item.category}`))].sort().map(category => [category, String(quality.issues.filter(item => `${item.severity}: ${item.category}` === category).length), 'findings', 'Same rules as Data Quality monitoring']),
    ];
    report.summary = [{ label: 'Findings', value: count(quality.summary.totalIssues) }, { label: 'Critical', value: count(quality.summary.critical) }, { label: 'Warnings', value: count(quality.summary.warnings) }];
    report.notes.push('Findings can overlap on a single batch or transfer; total findings are not a count of unique affected materials.');
  } else if (id === 'organizations') {
    const users = new Map(source.users.map(item => [item.id, item]));
    const organizations = new Map(source.organizations.map(item => [item.id, item]));
    const organizationIds = new Set([...batches.map(item => item.sourceOrganizationId), ...transfers.flatMap(item => [users.get(item.providerId)?.organizationId, users.get(item.recipientId)?.organizationId])].filter((item): item is string => Boolean(item)));
    const records = [...organizationIds].map(organizationId => {
      const organization = organizations.get(organizationId);
      const sourceBatches = batches.filter(item => item.sourceOrganizationId === organizationId);
      const linked = transfers.filter(item => users.get(item.providerId)?.organizationId === organizationId || users.get(item.recipientId)?.organizationId === organizationId);
      return { id: organizationId, name: organization?.name ?? 'Unregistered organization', type: organization?.type ?? 'Unknown', region: organization?.region ?? sourceBatches[0]?.region ?? 'Unknown', batches: sourceBatches.length, declared: sourceBatches.reduce((sum, item) => sum + item.declaredWeightKg, 0), received: linked.filter(item => item.status === 'Completed' && users.get(item.recipientId)?.organizationId === organizationId).reduce((sum, item) => sum + (item.verifiedWeightKg ?? 0), 0), transfers: linked.length };
    });
    report.columns = [actor.scope.aggregateOnly ? 'Region / stakeholder group' : 'Organization', 'Region', 'Stakeholder type', 'Organizations', 'Source batches', 'Declared as source (t)', 'Verified received (t)', 'Transfer involvements'];
    if (actor.scope.aggregateOnly) {
      const groups = [...new Set(records.map(item => JSON.stringify([item.region, item.type])))].sort();
      report.rows = groups.map(key => {
        const [region, type] = JSON.parse(key) as string[];
        const items = records.filter(item => item.region === region && item.type === type);
        return ['De-identified group', region, type, String(items.length), String(items.reduce((sum, item) => sum + item.batches, 0)), tons(items.reduce((sum, item) => sum + item.declared, 0)), tons(items.reduce((sum, item) => sum + item.received, 0)), String(items.reduce((sum, item) => sum + item.transfers, 0))];
      });
    } else report.rows = records.sort((a, b) => a.name.localeCompare(b.name)).map(item => [item.name, item.region, item.type, '1', String(item.batches), tons(item.declared), tons(item.received), String(item.transfers)]);
    report.summary = [{ label: 'Participating organizations', value: count(records.length) }, { label: 'Unique selected transfers', value: count(transfers.length) }];
    report.notes.push('Organization source mass and recipient mass are different roles, not additive flows. A transfer can involve two organizations; involvements must not be summed as unique transactions. Individual participants without an organization are excluded from organization counts.');
  } else {
    report.columns = ['Indicator', 'Status / value', 'Unit', 'Methodology / limitation'];
    report.rows = [
      ['Environmental methodology', configuration?.methodologyVersion ?? 'Not approved', 'status', 'No approved impact factors are applied by this dashboard'],
      ['CO2e avoided', 'Not calculated', 't CO2e', 'Requires approved factors and calculation boundaries'],
      ['Water saved', 'Not calculated', 'liters', 'Requires approved factors and calculation boundaries'],
      ['Landfill-equivalent impact', 'Not calculated', 't', 'Not inferred from transfer completion alone'],
      ['Declared platform mass', tons(data.circularFlow.generatedKg), 't', 'Unique selected batch declarations'],
      ['Verified reused + recycled', tons(data.circularFlow.reusedKg + data.circularFlow.recycledKg), 't', 'Operational input only; not an environmental-equivalence claim'],
    ];
    report.summary = [{ label: 'Environmental equivalents', value: 'Not calculated' }, { label: 'Methodology', value: configuration?.methodologyVersion ?? 'Not approved' }];
  }
  return report;
}

export function reportCsv(report: ReportDocument) {
  const width = Math.max(2, report.columns.length);
  const rows = [['Report', report.title], ['Generated at (UTC)', report.generatedAt], ['Reporting timezone', report.period.timeZone], ['Reporting period', report.period.label], ['Start (inclusive)', report.period.start], ['End (exclusive)', report.period.endExclusive], ['Access scope', report.scope.description], ...report.filters.map(item => [`Filter: ${item.label}`, item.value]), ...report.summary.map(item => [item.label, item.value]), ...report.notes.map(note => ['Note', note]), [], report.columns, ...report.rows];
  const cell = (value: string) => {
    const safe = /^[\s\uFEFF]*[=+@-]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
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
