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
  assert.deepEqual(REPORT_DEFINITIONS.map(report => report.id), ['material-flow', 'data-quality', 'organizations']);
  assert.equal(new Set(reports.map(report => report.columns.join(','))).size, 3);
  assert.ok(reports[2].columns.includes('Organizations'));
  assert.ok(!reports[2].columns.includes('Batch ID'));
  await assert.rejects(buildReport(store, seed.users[0], 'environmental-impact', {}, snapshot, now), { status: 404, message: 'Report not found.' });
  await assert.rejects(buildReport(store, seed.users[0], 'invented', {}, snapshot, now), /not found/);
  await assert.rejects(buildReport(store, seed.users[0], 'material-flow', { limit: '50' }, snapshot, now), /filter/);
});

test('synthetic interaction summaries never become measured active users or registered accounts', async () => {
  const seed = await createSeedData();
  const template: (typeof seed.systemInteractions)[number] = { id: 'ENGAGEMENT-FIXTURE', userId: null, organizationId: null, sessionId: null, client: 'web', eventName: 'active_users', privacyClassification: 'aggregate', occurredAt: now.toISOString(), properties: { count: 0, synthetic: true } };
  seed.systemInteractions = [
    { ...template, id: 'DECEMBER', eventName: 'active_users', occurredAt: '2025-12-31T15:00:00Z', properties: { ...template.properties, count: 99, region: 'Metro Manila' } },
    { ...template, id: 'JANUARY', eventName: 'active_users', occurredAt: '2025-12-31T16:00:00Z', properties: { ...template.properties, count: 3, region: 'Metro Manila' } },
  ];
  const store = new MemoryStore(seed);
  const january = await buildDashboardAnalytics(store, seed.users[0], { dateRange: 'Last 30 days' }, undefined, new Date('2026-01-14T04:00:00Z'));
  assert.equal(january.engagementMetrics.monthlyActiveUsers, null);
  assert.equal(january.engagementMetrics.monthlyActiveUsersAvailable, false);
  assert.equal(january.engagementMetrics.registeredAccounts, 0);
  const october = await buildDashboardAnalytics(store, seed.users[0], {}, undefined, now);
  assert.equal(october.kpis.find(item => item.label === 'Registered Accounts')?.value, '0');
  assert.equal(october.kpis.some(item => item.label === 'Reported Active Users'), false);
});

test('Overview recyclable collection tile uses classified intake and recomputes under material and regional filters', async () => {
  const seed = await createSeedData();
  const recyclable = { ...seed.materialBatches[0], id: 'RECYCLABLE', condition: 'Recyclable' as const, materialCategory: 'Cotton', region: 'Metro Manila' };
  const reusable = { ...recyclable, id: 'REUSABLE', condition: 'Reusable' as const, materialCategory: 'Denim', region: 'Central Visayas' };
  seed.materialBatches = [recyclable, reusable];
  seed.measurements = [];
  seed.transfers = [];
  seed.recoveryRecords = [recyclable, reusable].map((batch, index) => ({ ...seed.recoveryRecords[0], id: `COL-${index}`, batchId: batch.id,
    stage: 'Collection', status: 'Validated', validatedBy: seed.users[0].id, inputWeightKg: 100, outputWeightKg: 100,
    residualWeightKg: 0, lossWeightKg: 0, outcome: null }));
  const store = new MemoryStore(seed);
  const tile = async (filters: Record<string, unknown>) => (await buildDashboardAnalytics(store, seed.users[0], { ...custom, ...filters }, undefined, now)).kpis.find(item => item.label === 'Recyclable Textiles Collected')!;
  assert.equal((await tile({})).value, '0.1 t');
  assert.equal((await tile({})).delta, '1 recyclable batch · 0 assumed from consumer listings');
  assert.equal((await tile({ textileType: 'Cotton' })).value, '0.1 t');
  assert.equal((await tile({ region: 'Central Visayas' })).value, '0 t');
  assert.equal((await tile({ textileType: 'Polyester' })).value, 'Pending evidence');
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
  const last = sheet.getRows(1,sheet.rowCount)!.find(row => row.getCell(1).value === '\'=HYPERLINK("https://invalid.test")')!;
  assert.ok(last, 'Data rows remain intact before the trailing notes and definitions.');
  assert.equal(last.getCell(1).value, '\'=HYPERLINK("https://invalid.test")');
  assert.equal(last.getCell(2).value, 'Region, with comma');
  assert.equal(last.getCell(3).value, 'Line\nBreak');
  assert.equal(last.getCell(4).value, "'+cmd");
  assert.equal(last.getCell(7).value, "'\t=CMD()");
});

test('material report interpretation reconciles matched outcomes, unlinked output and the actual recovery denominator',async()=>{
  const data=await createSeedData(),admin=data.users[0],base=data.materialBatches[0];
  data.materialBatches=[{...base,id:'REPORT-COLLECTED',declaredWeightKg:148000,createdAt:'2026-09-01T01:00:00Z'},
    {...base,id:'REPORT-UNLINKED',declaredWeightKg:100,region:'',createdAt:'2026-09-01T01:00:00Z'}];
  data.measurements=[];data.listings=[];
  data.transfers=data.materialBatches.map((batch,index)=>({...data.transfers[0],id:`REPORT-T${index}`,batchId:batch.id,
    verifiedWeightKg:index===0?67253:86,receiptWeightKg:null,handoverWeightKg:null,agreedWeightKg:index===0?67253:86,
    status:'Completed',events:[],updatedAt:'2026-09-04T01:00:00Z'}));
  const baseRecord={...data.recoveryRecords[0],batchId:'REPORT-COLLECTED',transferId:'REPORT-T0',status:'Validated' as const,
    validatedBy:admin.id,timestamp:'2026-09-03T01:00:00Z',lossWeightKg:0,residualWeightKg:0};
  data.recoveryRecords=[{...baseRecord,id:'REPORT-INTAKE',stage:'Collection',inputWeightKg:105727,outputWeightKg:105727,outcome:null},
    {...baseRecord,id:'REPORT-FINAL',stage:'Recovery',inputWeightKg:67253,outputWeightKg:67253,outcome:'Recycling'},
    {...baseRecord,id:'REPORT-UNLINKED-FINAL',batchId:'REPORT-UNLINKED',transferId:'REPORT-T1',stage:'Recovery',inputWeightKg:86,outputWeightKg:86,outcome:'Recycling'}];
  const report=await buildReport(new MemoryStore(data),admin,'material-flow',custom,undefined,now);
  assert.match(report.interpretation!.find(item=>item.label==='How the percentage works')!.text,/67\.253 t.*105\.727 t.*63\.6%.*0\.086 t/);
  assert.match(report.interpretation!.find(item=>item.label==='What remains unconfirmed')!.text,/38\.474 t/);
  assert.equal(report.summary.find(item=>item.label==='Confirmed reuse + recycling')?.value,'67.339 t');
  assert.ok(report.rows.some(row=>row[0]==='Not recorded'));
});

test('all report types explain their scoped results and withhold conclusions when evidence is unavailable',async()=>{
  const seed=await createSeedData(),store=new MemoryStore(seed);
  for(const definition of REPORT_DEFINITIONS){
    const report=await buildReport(store,seed.users[0],definition.id,{...custom,textileType:'No matching material'},undefined,now);
    assert.ok(report.interpretation!.length>=3);
    assert.match(report.interpretation!.at(-1)!.text,/synthetic scenario records/);
    const csv=reportCsv(report);
    assert.ok(csv.indexOf('SUMMARY')<csv.indexOf('INTERPRETATION'));
    assert.ok(csv.indexOf('INTERPRETATION')<csv.indexOf('DETAILED DATA'));
    assert.ok(csv.indexOf('DETAILED DATA')<csv.indexOf('LIMITATIONS & TECHNICAL NOTES'));
    assert.ok(!csv.includes('"",""'));
    if(definition.id==='material-flow'){
      assert.equal(report.summary.find(item=>item.label==='Confirmed recovery share')?.value,'Not available');
      assert.match(report.interpretation!.find(item=>item.label==='How the percentage works')!.text,/unavailable is not 0%/);
    }
  }
});

test('CSV narrative cells retain formula-injection protection and rectangular spreadsheet columns',async()=>{
  const seed=await createSeedData(),report=await buildReport(new MemoryStore(seed),seed.users[0],'material-flow',custom,undefined,now);
  report.interpretation!.push({label:' =1+1',text:'@HYPERLINK("https://invalid.test")'});
  report.definitions!.push({label:'+formula',text:'Multiline\nmeaning, with "quotes"'});
  const csv=reportCsv(report),workbook=new ExcelJS.Workbook(),sheet=await workbook.csv.read(Readable.from([csv]));
  const rows=sheet.getRows(1,sheet.rowCount)!;
  const narrative=rows.find(row=>row.getCell(1).value==="' =1+1")!;
  assert.ok(narrative);assert.equal(narrative.getCell(2).value,'\'@HYPERLINK("https://invalid.test")');
  assert.equal(rows.find(row=>row.getCell(1).value==="'+formula")?.getCell(2).value,'Multiline\nmeaning, with "quotes"');
  assert.equal(sheet.columnCount,report.columns.length);
});
