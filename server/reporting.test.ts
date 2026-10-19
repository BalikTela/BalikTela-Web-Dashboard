import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_REPORTING_RANGE, inReportingWindow, manilaDate, resolveReportingPeriod } from '../shared/reporting.js';
import { buildDashboardAnalytics, loadDashboardAnalyticsSnapshot } from './dashboardAnalytics.js';
import { buildDataQuality } from './dataQuality.js';
import { buildReport, REPORT_DEFINITIONS, reportCsv } from './reports.js';
import { createSeedData } from './seed.js';
import { MemoryStore } from './store.js';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';

const now = new Date('2026-10-17T04:00:00.000Z');
const custom = { dateRange: 'Custom range', startDate: '2026-07-01', endDate: '2026-09-21' };

test('default calendar window starts August 1 in October, rolls over years and respects Manila midnight', () => {
  const period = resolveReportingPeriod({}, new Date('2026-10-19T04:00:00Z'));
  assert.deepEqual(period, resolveReportingPeriod({ dateRange: DEFAULT_REPORTING_RANGE }, new Date('2026-10-19T04:00:00Z')));
  assert.equal(period.startDate, '2026-08-01');
  assert.equal(period.start, '2026-07-31T16:00:00.000Z');
  assert.equal(period.endDate, '2026-10-19');
  assert.equal(period.endExclusive, '2026-10-19T04:00:00.001Z');
  assert.equal(period.comparison!.endExclusive, period.start);
  assert.equal(Date.parse(period.endExclusive) - Date.parse(period.start), Date.parse(period.comparison!.endExclusive) - Date.parse(period.comparison!.start));
  assert.ok(Math.abs(period.capacityMonths - (2 + (18.5 + 1 / 86400000) / 31)) < 1e-9);
  assert.equal(resolveReportingPeriod({}, new Date('2027-01-04T02:00:00Z')).startDate, '2026-11-01');
  assert.equal(resolveReportingPeriod({}, new Date('2026-09-30T15:59:59Z')).startDate, '2026-07-01');
  assert.equal(resolveReportingPeriod({}, new Date('2026-09-30T16:00:00Z')).startDate, '2026-08-01');
  const leap = resolveReportingPeriod({}, new Date('2024-02-29T04:00:00Z'));
  assert.equal(leap.startDate, '2023-12-01');
  assert.ok(Math.abs(leap.capacityMonths - (2 + (28.5 + 1 / 86400000) / 29)) < 1e-9);
});

test('rolling windows use Manila calendar days through now and equal-duration comparisons across year boundaries', () => {
  const period = resolveReportingPeriod({ dateRange: 'Last 30 days' }, new Date('2027-01-04T02:00:00Z'));
  assert.equal(period.startDate, '2026-12-06');
  assert.equal(period.start, '2026-12-05T16:00:00.000Z');
  assert.equal(period.endExclusive, '2027-01-04T02:00:00.001Z');
  assert.equal(Date.parse(period.endExclusive) - Date.parse(period.start), Date.parse(period.comparison!.endExclusive) - Date.parse(period.comparison!.start));
  assert.equal(period.comparison!.endExclusive, period.start);
  assert.equal(inReportingWindow(period.start, period), true);
  assert.equal(inReportingWindow(period.endExclusive, period), false);
  assert.equal(manilaDate(new Date('2026-10-16T16:00:00Z')), '2026-10-17');
  assert.equal(resolveReportingPeriod({ dateRange: 'Last 90 days' }, now).startDate, '2026-07-20');
});

test('custom windows include both calendar dates, reject invalid/future dates and prorate actual month lengths', () => {
  const period = resolveReportingPeriod(custom, now);
  assert.equal(period.start, '2026-06-30T16:00:00.000Z');
  assert.equal(period.endExclusive, '2026-09-21T16:00:00.000Z');
  assert.equal(period.capacityMonths, 2.7);
  const leap = resolveReportingPeriod({ dateRange: 'Custom range', startDate: '2024-02-01', endDate: '2024-02-29' }, now);
  assert.equal(leap.capacityMonths, 1);
  for (const query of [
    { dateRange: 'Custom range', startDate: '2026-02-30', endDate: '2026-03-01' },
    { dateRange: 'Custom range', startDate: '2026-09-22', endDate: '2026-09-21' },
    { dateRange: 'Custom range', startDate: '2026-10-17', endDate: '2026-10-18' },
    { dateRange: 'Custom range', startDate: '2026-01-01' }, { dateRange: ['Last 90 days'] },
    { dateRange: 'Unsupported' },
  ]) assert.throws(() => resolveReportingPeriod(query, now));
  assert.equal(resolveReportingPeriod({ dateRange: 'All time' }, now, '2025-12-31T16:00:00Z').startDate, '2026-01-01');
});

test('year-to-date uses the previous calendar year, with leap-day clamping and a live current-year start', () => {
  const period = resolveReportingPeriod({ dateRange: 'Year to date' }, new Date('2024-02-29T04:00:00Z'));
  assert.equal(period.startDate, '2024-01-01');
  assert.equal(period.comparison!.startDate, '2023-01-01');
  assert.equal(period.comparison!.endDate, '2023-02-28');
  assert.equal(period.comparison!.endExclusive, '2023-02-28T04:00:00.001Z');
});

test('October activity appears, future records do not, and chart month labels remain unique across years', async () => {
  const seed = await createSeedData();
  const template = seed.materialBatches[0];
  seed.materialBatches.push({ ...template, id: 'OCTOBER', declaredWeightKg: .125, createdAt: '2026-10-17T03:59:59Z' }, { ...template, id: 'FUTURE', declaredWeightKg: 999, createdAt: '2026-10-17T04:00:01Z' });
  const store = new MemoryStore(seed);
  const data = await buildDashboardAnalytics(store, seed.users[0], {}, undefined, now);
  assert.equal(data.operations.metrics.declaredKg, 575.125);
  assert.equal(data.metadata.reportingCutoff, '2026-10-17');
  assert.equal(data.wasteTrend.at(-1)?.month, 'Oct 2026');
  assert.equal(data.wasteTrend.at(-1)?.recorded, .125);
  const multiYear = await buildDashboardAnalytics(store, seed.users[0], { dateRange: 'Custom range', startDate: '2025-12-01', endDate: '2026-01-31' }, undefined, now);
  assert.deepEqual(multiYear.wasteTrend.map(point => point.month), ['Dec 2025', 'Jan 2026']);
  assert.equal(multiYear.operations.metrics.batchCount, 0);
});

test('all report types have distinct content and material exports reconcile exactly with analytics under the same filters', async () => {
  const seed = await createSeedData(); const store = new MemoryStore(seed);
  const snapshot = await loadDashboardAnalyticsSnapshot(store);
  for (const filters of [custom, { ...custom, textileType: 'Cotton' }, { ...custom, region: 'Central Visayas' }, { ...custom, transactionStatus: 'Completed' }, { ...custom, facilityId: 'FAC-001' }]) {
    const analytics = await buildDashboardAnalytics(store, seed.users[0], filters, snapshot, now);
    const report = await buildReport(store, seed.users[0], 'material-flow', filters, snapshot, now);
    const total = report.rows.at(-1)!;
    assert.equal(Number(total[2]), analytics.operations.metrics.batchCount);
    assert.equal(Number(total[3]), analytics.circularFlow.generatedKg / 1000);
    assert.equal(total[4], analytics.circularFlow.collectedAvailable ? String(analytics.circularFlow.collectedKg / 1000) : 'Pending evidence');
    assert.equal(total[5], analytics.circularFlow.reusedAvailable ? String(analytics.circularFlow.reusedKg / 1000) : 'Pending evidence');
    assert.equal(total[6], analytics.circularFlow.recycledAvailable ? String(analytics.circularFlow.recycledKg / 1000) : 'Pending evidence');
    assert.equal(total[8], analytics.impactMetrics.diversionRate !== null ? String(analytics.impactMetrics.diversionRate) : 'Not available');
    assert.equal(total[9], analytics.materialEvidence.completedWithWeight ? String(analytics.materialEvidence.completedKg / 1000) : 'Pending evidence');
  }
  const reports = await Promise.all(REPORT_DEFINITIONS.map(def => buildReport(store, seed.users[0], def.id, custom, snapshot, now)));
  assert.equal(new Set(reports.map(report => report.columns.join(','))).size, 4);
  assert.ok(reports[2].columns.includes('Organizations'));
  assert.ok(!reports[2].columns.includes('Batch ID'));
  assert.ok(reports[3].rows.some(row => row[0] === 'CO2e avoided' && row[1] === 'Not calculated'));
  await assert.rejects(buildReport(store, seed.users[0], 'invented', {}, snapshot, now), /not found/);
  await assert.rejects(buildReport(store, seed.users[0], 'material-flow', { limit: '50' }, snapshot, now), /filter/);
});

test('engagement uses timestamp years and Manila months, and missing monthly summaries are not fabricated zeros', async () => {
  const seed = await createSeedData();
  const template: (typeof seed.systemInteractions)[number] = { id: 'ENGAGEMENT-FIXTURE', userId: null, organizationId: null, sessionId: null, client: 'web', eventName: 'active_users', privacyClassification: 'aggregate', occurredAt: now.toISOString(), properties: { count: 0, synthetic: true } };
  seed.systemInteractions = [
    { ...template, id: 'DECEMBER', eventName: 'active_users', occurredAt: '2025-12-31T15:00:00Z', properties: { ...template.properties, count: 99, region: 'Metro Manila' } },
    { ...template, id: 'JANUARY', eventName: 'active_users', occurredAt: '2025-12-31T16:00:00Z', properties: { ...template.properties, count: 3, region: 'Metro Manila' } },
  ];
  const store = new MemoryStore(seed);
  const january = await buildDashboardAnalytics(store, seed.users[0], { dateRange: 'Last 30 days' }, undefined, new Date('2026-01-14T04:00:00Z'));
  assert.equal(january.engagementMetrics.monthlyActiveUsers, 3);
  assert.equal(january.engagementMetrics.monthlyActiveUsersAvailable, true);
  const october = await buildDashboardAnalytics(store, seed.users[0], {}, undefined, now);
  assert.equal(october.kpis.find(item => item.label === 'Monthly Active Users')?.value, 'Not available');
});

test('quality reports use the configured discrepancy rule, and organization aggregates never contain identities', async () => {
  const seed = await createSeedData(); const store = new MemoryStore(seed);
  seed.configurations[0].discrepancyThresholdPercent = 1;
  const snapshot = await loadDashboardAnalyticsSnapshot(store);
  const report = await buildReport(store, seed.users[0], 'data-quality', custom, snapshot, now);
  const direct = buildDataQuality(seed.users[0], seed.materialBatches, seed.transfers, 1, now);
  assert.equal(report.summary.find(item => item.label === 'Findings')?.value, String(direct.summary.totalIssues));
  assert.equal(report.rows.find(row => row[0] === 'Discrepancy threshold')?.[1], '1');
  const researcher = seed.users.find(item => item.role === 'Researcher')!;
  researcher.scope.aggregateOnly = true; researcher.scope.regions = ['Metro Manila'];
  const organizations = await buildReport(store, researcher, 'organizations', custom, snapshot, now);
  const csv = reportCsv(organizations);
  for (const organization of seed.organizations) assert.ok(!csv.includes(organization.name));
  for (const user of seed.users) { assert.ok(!csv.includes(user.email)); assert.ok(!csv.includes(user.id)); }
  assert.ok(organizations.rows.every(row => row[0] === 'De-identified group'));
});

test('CSV metadata, quoting, newlines and formula protection survive a structured spreadsheet parse', async () => {
  const seed = await createSeedData(); const store = new MemoryStore(seed);
  const report = await buildReport(store, seed.users[0], 'organizations', custom, undefined, now);
  report.rows.push(['=HYPERLINK("https://invalid.test")', 'Region, with comma', 'Line\nBreak', '+cmd', '@SUM(1)', '-cmd', '\t=CMD()', '8']);
  const csv = reportCsv(report);
  const workbook = new ExcelJS.Workbook();
  const sheet = await workbook.csv.read(Readable.from([csv]));
  assert.equal(sheet.getRow(1).getCell(1).value, 'Report');
  assert.equal(sheet.getRow(1).getCell(2).value, report.title);
  const last = sheet.getRow(sheet.rowCount);
  assert.equal(last.getCell(1).value, '\'=HYPERLINK("https://invalid.test")');
  assert.equal(last.getCell(2).value, 'Region, with comma');
  assert.equal(last.getCell(3).value, 'Line\nBreak');
  assert.equal(last.getCell(4).value, "'+cmd");
  assert.equal(last.getCell(7).value, "'\t=CMD()");
});
