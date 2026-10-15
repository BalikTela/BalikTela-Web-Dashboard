import ExcelJS from 'exceljs';

const outputPath = new URL('../BalikTela_Feature_Progress_Tracker.xlsx', import.meta.url).pathname;
const reviewed = '2026-09-22';

const groups = [
  ['Authentication and Access', 'Platform Engineering', 'src/pages/AuthPage.tsx; server/auth.ts; server/index.ts', [
    ['Secure email and password sign-in', 'Implemented', 100, 'Critical', 'Production hardening'],
    ['Participant account registration', 'Implemented', 100, 'Critical', 'Production hardening'],
    ['bcrypt password hashing', 'Implemented', 100, 'Critical', 'Security review'],
    ['Short-lived access tokens and rotating refresh sessions', 'Implemented', 100, 'High', 'Security review'],
    ['Password recovery and authenticated password change', 'Implemented', 100, 'High', 'Connect production email provider'],
    ['Email ownership verification and account approval gate', 'Implemented', 100, 'High', 'Connect production email provider'],
    ['Login throttling and temporary account lockout', 'Implemented', 100, 'High', 'Tune thresholds during pilot'],
    ['Role-aware access control', 'Implemented', 95, 'Critical', 'Expand authorization tests'],
    ['Administrator-only settings and user management', 'Implemented', 100, 'High', 'Production hardening'],
    ['Data Privacy Act consent during registration', 'Implemented', 100, 'Critical', 'Legal review'],
    ['Sign-out and automatic session restoration', 'Implemented', 100, 'High', 'Production hardening'],
    ['Seeded demo accounts by participant role', 'Implemented - Demo', 80, 'Medium', 'Replace with managed onboarding'],
  ]],
  ['User Profiles', 'Product and Research', 'src/pages/UserProfile.tsx; server/types.ts', [
    ['Personal and organization information', 'Implemented', 100, 'High', 'Connect research dataset'],
    ['Producer, recycler, consumer, NGO, and administrator roles', 'Implemented', 100, 'High', 'Validate permissions with stakeholders'],
    ['City and regional location', 'Implemented', 100, 'High', 'Standardize geographic codes'],
    ['Age-group demographic field', 'Implemented', 100, 'Medium', 'Review consent and minimization'],
    ['Organization-size classification', 'Implemented', 100, 'Medium', 'Validate category definitions'],
    ['Production or handled textile volume', 'Implemented', 100, 'High', 'Connect verified submissions'],
    ['Recycling and waste-management practices', 'Implemented', 100, 'High', 'Add controlled vocabulary'],
    ['Accepted textile categories', 'Implemented', 100, 'High', 'Validate recycler taxonomy'],
    ['Sustainability interests', 'Implemented', 100, 'Medium', 'Use for consented segmentation'],
    ['Account verification status', 'Implemented - Demo', 75, 'High', 'Define verification governance'],
    ['Consent recording and membership date', 'Implemented', 100, 'Critical', 'Add consent-version history'],
    ['Placeholder trust indicator', 'Placeholder', 35, 'Medium', 'Define and validate formula and appeals'],
    ['Editable self-service profile', 'Implemented', 100, 'High', 'Add field-level audit history'],
  ]],
  ['User Administration', 'Platform Engineering', 'src/pages/UserAccounts.tsx; server/index.ts', [
    ['Administrator user directory', 'Implemented', 100, 'High', 'Connect production database'],
    ['Search and role filtering', 'Implemented', 100, 'Medium', 'Add pagination for scale'],
    ['Profile-completeness measurement', 'Implemented - Demo', 80, 'Medium', 'Validate required-field weights'],
    ['Consent-status monitoring', 'Implemented', 100, 'Critical', 'Add consent withdrawal workflow'],
    ['Participant-role oversight', 'Implemented', 100, 'High', 'Add role-change approval process'],
    ['Demo verification and review controls', 'Implemented - Demo', 75, 'High', 'Replace with governed verification'],
    ['Registered-account summary metrics', 'Implemented', 100, 'Medium', 'Add date and region filters'],
  ]],
  ['Barter Marketplace', 'Product and Platform', 'src/pages/BarterExchange.tsx; server/index.ts', [
    ['Textile-material listings', 'Implemented', 100, 'Critical', 'Production hardening'],
    ['Material description, category, quality, and quantity', 'Implemented', 100, 'High', 'Validate listing schema'],
    ['Requested exchange terms or services', 'Implemented', 100, 'High', 'Add structured term templates'],
    ['Suggested reward credits', 'Implemented - Demo', 75, 'Medium', 'Validate incentive rules'],
    ['Listing lifecycle statuses', 'Implemented', 100, 'High', 'Add completion confirmation'],
    ['Marketplace search', 'Implemented', 100, 'Medium', 'Add indexed server search'],
    ['Personal-listing identification', 'Implemented', 100, 'Medium', 'Add My Listings filter'],
    ['Creation of new listings', 'Implemented', 100, 'Critical', 'Add media and validation'],
    ['Clearly labeled demo records', 'Implemented', 100, 'High', 'Retain until live data approval'],
  ]],
  ['Matching and Offers', 'Product and Platform', 'src/pages/BarterExchange.tsx; server/index.ts', [
    ['Transparent rules-based compatibility matching', 'Implemented - Demo', 80, 'High', 'Validate matching weights'],
    ['Matching by category, region, quality, and quantity', 'Implemented - Demo', 80, 'High', 'Evaluate against pilot outcomes'],
    ['Compatibility percentage and matching reasons', 'Implemented - Demo', 80, 'Medium', 'Add explainability review'],
    ['Offer quantity and proposed terms', 'Implemented', 100, 'Critical', 'Production hardening'],
    ['Reward-credit offers', 'Implemented - Demo', 75, 'Medium', 'Validate credit economics'],
    ['Incoming and outgoing offer tracking', 'Implemented', 100, 'High', 'Add notifications'],
    ['Offer acceptance and rejection', 'Implemented', 100, 'Critical', 'Add conflict handling'],
    ['Own-listing offer prevention', 'Implemented', 100, 'High', 'Retain server validation'],
    ['Listing reservation after acceptance', 'Implemented', 100, 'Critical', 'Add expiry and release rules'],
  ]],
  ['Chat, Transactions, and Rewards', 'Platform Engineering', 'src/pages/BarterExchange.tsx; server/index.ts', [
    ['Listing-specific conversations', 'Implemented', 100, 'High', 'Production hardening'],
    ['Participant-only chat authorization', 'Implemented', 100, 'Critical', 'Security review'],
    ['Timestamped chat messages', 'Implemented', 100, 'High', 'Add moderation and retention rules'],
    ['Reward-credit balance', 'Implemented - Demo', 75, 'Medium', 'Validate reward policy'],
    ['Earned, redeemed, and adjustment ledger', 'Implemented - Demo', 75, 'High', 'Add immutable ledger controls'],
    ['Automatic wallet updates after acceptance', 'Implemented - Demo', 80, 'High', 'Add transactional database operation'],
    ['Barter transaction creation from accepted offers', 'Implemented', 100, 'Critical', 'Link to analytics dataset'],
    ['No-monetary-value credit disclosure', 'Implemented', 100, 'High', 'Legal review'],
  ]],
  ['Overview Dashboard', 'Frontend and Data', 'src/pages/Overview.tsx; src/services/dashboardService.ts', [
    ['Textile waste collected KPI', 'Implemented - Demo', 90, 'High', 'Connect validated dataset'],
    ['Textile waste recycled KPI', 'Implemented - Demo', 90, 'High', 'Connect validated dataset'],
    ['Reused and bartered volume KPI', 'Implemented - Demo', 90, 'High', 'Connect validated dataset'],
    ['Material diverted from landfill KPI', 'Implemented - Demo', 90, 'High', 'Validate denominator'],
    ['Diversion-rate KPI', 'Implemented - Demo', 90, 'High', 'Validate denominator'],
    ['Monthly active users KPI', 'Implemented - Demo', 85, 'Medium', 'Connect system logs'],
    ['Active producers and recyclers', 'Implemented - Demo', 85, 'Medium', 'Connect account registry'],
    ['Total transaction activity', 'Implemented - Demo', 90, 'High', 'Connect barter API'],
    ['Previous-period comparisons', 'Implemented - Demo', 90, 'Medium', 'Validate reporting calendar'],
    ['Waste trend and textile-category charts', 'Implemented - Demo', 90, 'High', 'Connect validated dataset'],
    ['Circular textile flow visualization', 'Implemented - Demo', 90, 'High', 'Validate material balance'],
    ['Regional activity and recycler utilization', 'Implemented - Demo', 85, 'High', 'Connect facility and GIS data'],
    ['Recent transactions and recommendation cues', 'Implemented - Demo', 80, 'Medium', 'Connect live transactions'],
  ]],
  ['Waste and Environmental Analytics', 'Data and Research', 'src/pages/WasteAnalytics.tsx; src/components/ImpactSummary.tsx', [
    ['Generated, collected, sorted, reused, and recycled volumes', 'Implemented - Demo', 90, 'High', 'Connect validated dataset'],
    ['Collection coverage', 'Implemented - Demo', 90, 'High', 'Validate collection denominator'],
    ['Category recovery rates', 'Implemented - Demo', 90, 'High', 'Connect textile classification data'],
    ['Regional collection and recycling comparison', 'Implemented - Demo', 90, 'High', 'Connect regional data'],
    ['Material diversion and circularity rate', 'Implemented - Demo', 85, 'High', 'Expert validation'],
    ['Sorting yield', 'Implemented - Demo', 85, 'High', 'Expert validation'],
    ['Estimated avoided carbon emissions', 'Placeholder', 45, 'High', 'Validate lifecycle factor'],
    ['Estimated avoided water consumption', 'Placeholder', 45, 'High', 'Validate lifecycle factor'],
    ['Unvalidated-estimate disclosure', 'Implemented', 100, 'Critical', 'Retain until validation'],
  ]],
  ['Transaction Traceability', 'Platform and Data', 'src/pages/Transactions.tsx; src/components/TransactionDrawer.tsx', [
    ['Searchable transaction table', 'Implemented - Demo', 90, 'High', 'Connect accepted barter transactions'],
    ['Source and destination records', 'Implemented - Demo', 90, 'High', 'Use authenticated account IDs'],
    ['Textile category, quantity, location, and status', 'Implemented - Demo', 90, 'High', 'Connect live records'],
    ['Structured lifecycle events', 'Implemented - Demo', 90, 'Critical', 'Persist API lifecycle events'],
    ['Event timestamps, actors, locations, and notes', 'Implemented - Demo', 90, 'High', 'Persist API lifecycle events'],
    ['Completed, current, pending, and exception states', 'Implemented', 100, 'High', 'Add workflow transition rules'],
    ['Estimated transaction impact', 'Placeholder', 45, 'High', 'Validate impact method'],
    ['Audit completion and open-workflow metrics', 'Implemented - Demo', 85, 'Medium', 'Connect live audit log'],
  ]],
  ['Stakeholders and Facilities', 'Research and Operations', 'src/pages/Stakeholders.tsx; src/pages/Facilities.tsx', [
    ['Producer, recycler, consumer, and NGO directories', 'Implemented - Demo', 85, 'High', 'Unify with authenticated accounts'],
    ['Participation and recovered-material metrics', 'Implemented - Demo', 85, 'High', 'Connect verified activity'],
    ['Sustainability activities and transaction histories', 'Implemented - Demo', 80, 'Medium', 'Connect platform records'],
    ['Stakeholder verification details', 'Implemented - Demo', 75, 'High', 'Define governance process'],
    ['Placeholder reliability details', 'Placeholder', 35, 'Medium', 'Define validated methodology'],
    ['Facility capacity and utilization', 'Implemented - Demo', 85, 'High', 'Connect facility submissions'],
    ['Facility intake and processed volume', 'Implemented - Demo', 85, 'High', 'Connect facility submissions'],
    ['Accepted textile types', 'Implemented - Demo', 85, 'High', 'Validate recycler taxonomy'],
    ['Processing time and operating status', 'Implemented - Demo', 80, 'Medium', 'Add output-quality metric'],
  ]],
  ['Geographic and Advanced Analytics', 'Data Science and GIS', 'src/pages/Geographic.tsx; src/pages/AdvancedAnalytics.tsx', [
    ['Philippine regional activity map', 'Implemented - Demo', 75, 'High', 'Replace mock map with GIS'],
    ['Collection-point, producer, and recycler counts', 'Implemented - Demo', 80, 'High', 'Connect location registry'],
    ['Regional waste-gap identification', 'Implemented - Demo', 80, 'High', 'Validate regional estimates'],
    ['Diagnostic waste and recovery analysis', 'Implemented - Demo', 85, 'High', 'Connect longitudinal data'],
    ['Demo waste forecasts', 'Placeholder', 40, 'Medium', 'Train and validate predictive model'],
    ['Facility-demand signals', 'Implemented - Demo', 70, 'Medium', 'Validate demand method'],
    ['Sample prescriptive recommendations', 'Placeholder', 45, 'Medium', 'Define and validate decision rules'],
    ['Predictive-model disclosure', 'Implemented', 100, 'Critical', 'Retain until model validation'],
    ['Responsive analytical visualizations', 'Implemented', 100, 'High', 'Continue accessibility testing'],
  ]],
  ['Engagement, Reports, and Governance', 'Research Governance', 'src/components/PlatformEngagement.tsx; src/pages/Reports.tsx; src/pages/Settings.tsx', [
    ['Sessions and monthly active-user metrics', 'Implemented - Demo', 80, 'Medium', 'Connect system logs'],
    ['Waste-submission and barter-action metrics', 'Implemented - Demo', 80, 'Medium', 'Connect API events'],
    ['Report-export metrics', 'Implemented - Demo', 70, 'Low', 'Connect real export events'],
    ['Waste and circular-economy report cards', 'Placeholder', 40, 'Medium', 'Generate real report content'],
    ['Stakeholder, recycler, and regional report cards', 'Placeholder', 40, 'Medium', 'Generate real report content'],
    ['CSV, PDF, and print controls', 'Placeholder', 30, 'High', 'Implement file generation'],
    ['Global analytics filters', 'Implemented - Demo', 95, 'High', 'Connect backend queries'],
    ['Documented data-source registry', 'Implemented', 100, 'Medium', 'Add provenance and refresh dates'],
    ['Privacy and model-labeling settings', 'Implemented - Demo', 65, 'High', 'Persist and enforce settings'],
    ['Audit-trace and export-governance settings', 'Implemented - Demo', 65, 'High', 'Persist and enforce settings'],
    ['Node.js and Express API', 'Implemented', 100, 'Critical', 'Production deployment'],
    ['Supabase persistence support', 'In Progress', 90, 'Critical', 'Apply migration and verify shared project credentials'],
    ['In-memory demo storage mode', 'Implemented - Demo', 100, 'Medium', 'Use only for demonstrations'],
    ['Responsive UI, focus states, reduced motion, and animations', 'Implemented', 100, 'High', 'Continue formal accessibility audit'],
  ]],
];

const features = [];
let sequence = 1;
for (const [category, owner, evidence, rows] of groups) {
  for (const [feature, status, progress, priority, nextStep] of rows) {
    features.push({ id: `BT-${String(sequence++).padStart(3, '0')}`, category, feature, status, progress, priority, owner, evidence, nextStep, target: progress === 100 ? 'Prototype complete' : progress >= 75 ? 'Data integration / hardening' : progress >= 50 ? 'Implementation refinement' : 'Research / validation', reviewed, notes: status.includes('Demo') ? 'Working feature currently backed by sample or demo data.' : status === 'Placeholder' ? 'Visible prototype surface; production method is not yet validated or complete.' : status === 'Partial' ? 'Architecture exists but deployment or enforcement remains incomplete.' : 'Working in the current prototype.' });
  }
}

const backlog = [
  ['Production Supabase deployment', 'Infrastructure', 'Critical', 'Configure PostgreSQL migrations, backups, access controls, and environment separation.'],
  ['Password reset and account recovery', 'Authentication', 'High', 'Add verified email recovery and token invalidation.'],
  ['Multi-factor authentication', 'Authentication', 'Medium', 'Evaluate for administrators and sensitive exports.'],
  ['Production verification workflow', 'Governance', 'High', 'Define evidence, reviewers, expiry, appeals, and audit history.'],
  ['Validated trust methodology', 'Research', 'Medium', 'Define ethical model, inputs, thresholds, bias review, and appeals.'],
  ['Live dashboard data pipeline', 'Data', 'Critical', 'Replace generated records with validated partner and government datasets.'],
  ['Validated environmental factors', 'Research', 'High', 'Approve CO2e and water factors with domain experts.'],
  ['Functional CSV, PDF, and print exports', 'Reporting', 'High', 'Generate files from active filters and role permissions.'],
  ['GIS and route optimization', 'Geospatial', 'High', 'Integrate authoritative GIS layers and routing services.'],
  ['Predictive model training and evaluation', 'Analytics', 'Medium', 'Train only after sufficient quality historical data exists.'],
  ['Prescriptive decision validation', 'Analytics', 'Medium', 'Validate routing, capacity, and incentive recommendations.'],
  ['Mobile application integration', 'Mobile', 'Future', 'React Native application and push notifications remain outside the current dashboard scope.'],
  ['Formal UAT and accessibility audit', 'Quality', 'High', 'Record stakeholder test cases, findings, remediation, and sign-off.'],
  ['Load, stress, backup, and recovery tests', 'Quality', 'High', 'Validate production reliability and scaling assumptions.'],
];

const wb = new ExcelJS.Workbook();
wb.creator = 'BalikTela Project';
wb.company = 'BalikTela Research Prototype';
wb.subject = 'Feature progress tracking';
wb.title = 'BalikTela Feature Progress Tracker';
wb.created = new Date(`${reviewed}T00:00:00+08:00`);
wb.calcProperties.fullCalcOnLoad = true;

const colors = { dark: '193C31', green: '27775C', mint: 'DCECE6', pale: 'EDF4F1', ink: '17201D', muted: '66736E', line: 'DFE5E2', white: 'FFFFFF', amber: 'BD7A2F', red: 'A33A3A', blue: '3E6D8C', gray: 'F5F7F6' };
const tracker = wb.addWorksheet('Feature Tracker', { views: [{ state: 'frozen', ySplit: 5, xSplit: 3 }] });
tracker.mergeCells('A1:M1');
tracker.getCell('A1').value = 'BalikTela Feature Progress Tracker';
tracker.getCell('A1').font = { size: 22, bold: true, color: { argb: colors.white } };
tracker.getCell('A1').fill = solid(colors.dark);
tracker.getCell('A1').alignment = { vertical: 'middle' };
tracker.getRow(1).height = 42;
tracker.mergeCells('A2:M2');
tracker.getCell('A2').value = 'Current web dashboard, authentication, user, barter, analytics, and governance capabilities';
tracker.getCell('A2').font = { size: 11, color: { argb: colors.muted } };
tracker.getCell('A2').alignment = { vertical: 'middle' };
tracker.mergeCells('A3:M3');
tracker.getCell('A3').value = `Last reviewed: ${reviewed}  |  Progress reflects prototype readiness, not production certification.`;
tracker.getCell('A3').font = { size: 10, italic: true, color: { argb: colors.amber } };

const columns = [
  ['ID', 11], ['Category', 30], ['Feature', 46], ['Current Status', 21], ['Progress %', 13], ['Priority', 12], ['Owner / Workstream', 24], ['Evidence / Location', 38], ['Next Step', 38], ['Target Phase', 26], ['Last Reviewed', 15], ['Notes', 48], ['Update', 20],
];
tracker.getRow(5).values = columns.map(([name]) => name);
tracker.getRow(5).height = 28;
tracker.getRow(5).eachCell((cell) => { cell.fill = solid(colors.green); cell.font = { bold: true, color: { argb: colors.white } }; cell.alignment = { vertical: 'middle' }; cell.border = bottom(colors.dark); });
columns.forEach(([, width], index) => { tracker.getColumn(index + 1).width = width; });

features.forEach((item, index) => {
  const row = tracker.addRow([item.id, item.category, item.feature, item.status, item.progress / 100, item.priority, item.owner, item.evidence, item.nextStep, item.target, item.reviewed, item.notes, '']);
  row.height = 36;
  row.alignment = { vertical: 'middle', wrapText: true };
  row.getCell(5).numFmt = '0%';
  if (index % 2) row.fill = solid('FAFBFA');
  row.eachCell((cell) => { cell.border = bottom(colors.line); });
});

tracker.autoFilter = { from: 'A5', to: `M${tracker.rowCount}` };
tracker.getColumn(4).eachCell((cell, row) => { if (row > 5) cell.font = { bold: true, color: { argb: statusColor(String(cell.value), colors) } }; });
tracker.getColumn(5).eachCell((cell, row) => { if (row > 5) cell.alignment = { vertical: 'middle', horizontal: 'center' }; });
tracker.addConditionalFormatting({ ref: `E6:E${tracker.rowCount}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: colors.green }, gradient: true }] });
tracker.dataValidations.add(`D6:D${tracker.rowCount}`, { type: 'list', allowBlank: false, formulae: ['"Implemented,Implemented - Demo,Partial,Placeholder,Planned,Blocked"'] });
tracker.dataValidations.add(`F6:F${tracker.rowCount}`, { type: 'list', allowBlank: false, formulae: ['"Critical,High,Medium,Low,Future"'] });

const dashboard = wb.addWorksheet('Dashboard', { views: [{ showGridLines: false }] });
dashboard.columns = Array.from({ length: 12 }, () => ({ width: 15 }));
dashboard.mergeCells('A1:L2');
dashboard.getCell('A1').value = 'BalikTela Feature Progress';
dashboard.getCell('A1').font = { size: 25, bold: true, color: { argb: colors.white } };
dashboard.getCell('A1').fill = solid(colors.dark);
dashboard.getCell('A1').alignment = { vertical: 'middle' };
dashboard.mergeCells('A3:L3');
dashboard.getCell('A3').value = `Executive view · ${features.length} tracked capabilities · Reviewed ${reviewed}`;
dashboard.getCell('A3').font = { size: 11, color: { argb: colors.muted } };

const cards = [
  ['A5:C7', 'Total Features', `=COUNTA('Feature Tracker'!A6:A${tracker.rowCount})`, colors.dark],
  ['D5:F7', 'Average Progress', `=AVERAGE('Feature Tracker'!E6:E${tracker.rowCount})`, colors.green],
  ['G5:I7', 'Implemented', `=COUNTIF('Feature Tracker'!D6:D${tracker.rowCount},"Implemented")`, colors.blue],
  ['J5:L7', 'Needs Follow-up', `=COUNTIF('Feature Tracker'!D6:D${tracker.rowCount},"Partial")+COUNTIF('Feature Tracker'!D6:D${tracker.rowCount},"Placeholder")`, colors.amber],
];
for (const [range, label, formula, color] of cards) {
  dashboard.mergeCells(range);
  const cell = dashboard.getCell(range.split(':')[0]);
  cell.value = { formula };
  cell.numFmt = label === 'Average Progress' ? '0%' : '0';
  cell.font = { size: 24, bold: true, color: { argb: colors.white } };
  cell.fill = solid(color);
  cell.alignment = { vertical: 'middle', horizontal: 'center' };
  const [start] = range.split(':');
  const labelRow = Number(start.match(/\d+/)[0]) + 2;
  const labelCell = dashboard.getCell(`${start[0]}${labelRow}`);
  labelCell.note = label;
}
dashboard.getRow(8).values = ['', 'Total Features', '', '', 'Average Progress', '', '', 'Implemented', '', '', 'Needs Follow-up'];
dashboard.getRow(8).font = { bold: true, color: { argb: colors.muted } };
dashboard.getRow(8).alignment = { horizontal: 'center' };

dashboard.mergeCells('A10:F10'); dashboard.getCell('A10').value = 'Progress by Category';
dashboard.mergeCells('H10:L10'); dashboard.getCell('H10').value = 'Status Distribution';
for (const address of ['A10', 'H10']) { dashboard.getCell(address).font = { size: 15, bold: true, color: { argb: colors.ink } }; dashboard.getCell(address).border = bottom(colors.line); }

dashboard.getRow(11).values = ['Category', 'Features', 'Average Progress', 'Implemented', 'Demo', 'Follow-up', '', 'Status', 'Count'];
for (const cell of dashboard.getRow(11).values.slice(1).map((_, i) => dashboard.getCell(11, i + 1))) { cell.font = { bold: true, color: { argb: colors.white } }; cell.fill = solid(colors.green); }

groups.forEach(([category], index) => {
  const row = 12 + index;
  dashboard.getCell(row, 1).value = category;
  dashboard.getCell(row, 2).value = { formula: `COUNTIF('Feature Tracker'!B:B,A${row})` };
  dashboard.getCell(row, 3).value = { formula: `AVERAGEIF('Feature Tracker'!B:B,A${row},'Feature Tracker'!E:E)` };
  dashboard.getCell(row, 3).numFmt = '0%';
  dashboard.getCell(row, 4).value = { formula: `COUNTIFS('Feature Tracker'!B:B,A${row},'Feature Tracker'!D:D,"Implemented")` };
  dashboard.getCell(row, 5).value = { formula: `COUNTIFS('Feature Tracker'!B:B,A${row},'Feature Tracker'!D:D,"Implemented - Demo")` };
  dashboard.getCell(row, 6).value = { formula: `COUNTIFS('Feature Tracker'!B:B,A${row},'Feature Tracker'!D:D,"Partial")+COUNTIFS('Feature Tracker'!B:B,A${row},'Feature Tracker'!D:D,"Placeholder")` };
  dashboard.getRow(row).height = 24;
  dashboard.getRow(row).eachCell((cell) => { cell.border = bottom(colors.line); cell.alignment = { vertical: 'middle' }; });
});
const statuses = ['Implemented', 'Implemented - Demo', 'Partial', 'Placeholder'];
statuses.forEach((status, index) => { const row = 12 + index; dashboard.getCell(row, 8).value = status; dashboard.getCell(row, 9).value = { formula: `COUNTIF('Feature Tracker'!D:D,H${row})` }; dashboard.getCell(row, 8).font = { bold: true, color: { argb: statusColor(status, colors) } }; });

dashboard.addConditionalFormatting({ ref: `C12:C${11 + groups.length}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: colors.green }, gradient: true }] });
dashboard.addConditionalFormatting({ ref: 'I12:I15', rules: [{ type: 'dataBar', cfvo: [{ type: 'min' }, { type: 'max' }], color: { argb: colors.blue }, gradient: true }] });

dashboard.mergeCells('A26:F26'); dashboard.getCell('A26').value = 'Production Readiness Focus'; dashboard.getCell('A26').font = { bold: true, size: 15, color: { argb: colors.ink } }; dashboard.getCell('A26').border = bottom(colors.line);
const focus = [
  ['1', 'Provision Supabase', 'Move from in-memory demonstration storage to managed shared PostgreSQL infrastructure.'],
  ['2', 'Connect validated datasets', 'Replace generated analytics records with approved partner, government, and facility data.'],
  ['3', 'Validate research metrics', 'Approve environmental factors, trust methodology, matching weights, and denominators.'],
  ['4', 'Harden transactional workflows', 'Add offer expiry, immutable reward ledger controls, audit history, and notification delivery.'],
  ['5', 'Complete reporting and QA', 'Implement exports, UAT, accessibility review, stress tests, backup, and recovery validation.'],
];
focus.forEach(([number, title, detail], index) => { const row = 27 + index * 2; dashboard.getCell(row, 1).value = number; dashboard.getCell(row, 1).fill = solid(colors.dark); dashboard.getCell(row, 1).font = { bold: true, color: { argb: colors.white } }; dashboard.getCell(row, 1).alignment = { horizontal: 'center', vertical: 'middle' }; dashboard.mergeCells(row, 2, row, 6); dashboard.getCell(row, 2).value = title; dashboard.getCell(row, 2).font = { bold: true, color: { argb: colors.ink } }; dashboard.mergeCells(row + 1, 2, row + 1, 6); dashboard.getCell(row + 1, 2).value = detail; dashboard.getCell(row + 1, 2).font = { size: 10, color: { argb: colors.muted } }; dashboard.getCell(row + 1, 2).alignment = { wrapText: true, vertical: 'top' }; dashboard.getRow(row + 1).height = 30; });

dashboard.mergeCells('H26:L26'); dashboard.getCell('H26').value = 'Status Definitions'; dashboard.getCell('H26').font = { bold: true, size: 14, color: { argb: colors.ink } }; dashboard.getCell('H26').border = bottom(colors.line);
const legend = [['Implemented', 'Working in the current prototype.'], ['Implemented - Demo', 'Working with generated, seeded, or provisional data.'], ['Partial', 'Architecture exists; deployment or enforcement remains.'], ['Placeholder', 'Visible concept awaiting implementation or validation.']];
legend.forEach(([status, description], index) => { const row = 27 + index * 2; dashboard.getCell(row, 8).value = status; dashboard.getCell(row, 8).font = { bold: true, color: { argb: statusColor(status, colors) } }; dashboard.mergeCells(row, 9, row + 1, 12); dashboard.getCell(row, 9).value = description; dashboard.getCell(row, 9).alignment = { wrapText: true, vertical: 'middle' }; dashboard.getRow(row).height = 24; dashboard.getRow(row + 1).height = 24; });

const backlogSheet = wb.addWorksheet('Production Backlog', { views: [{ state: 'frozen', ySplit: 4 }] });
backlogSheet.mergeCells('A1:F1'); backlogSheet.getCell('A1').value = 'Production Readiness Backlog'; backlogSheet.getCell('A1').fill = solid(colors.dark); backlogSheet.getCell('A1').font = { size: 20, bold: true, color: { argb: colors.white } }; backlogSheet.getRow(1).height = 40;
backlogSheet.mergeCells('A2:F2'); backlogSheet.getCell('A2').value = 'Document-aligned work that is not yet production complete'; backlogSheet.getCell('A2').font = { color: { argb: colors.muted } };
backlogSheet.getRow(4).values = ['ID', 'Backlog Item', 'Area', 'Priority', 'Recommended Next Step', 'Status'];
backlogSheet.getRow(4).eachCell((cell) => { cell.fill = solid(colors.green); cell.font = { bold: true, color: { argb: colors.white } }; });
backlog.forEach((item, index) => { const row = backlogSheet.addRow([`BL-${String(index + 1).padStart(2, '0')}`, ...item, 'Planned']); row.height = 38; row.alignment = { wrapText: true, vertical: 'middle' }; row.eachCell((cell) => { cell.border = bottom(colors.line); }); });
[11, 40, 22, 12, 70, 16].forEach((width, index) => { backlogSheet.getColumn(index + 1).width = width; });
backlogSheet.autoFilter = { from: 'A4', to: `F${backlogSheet.rowCount}` };
backlogSheet.dataValidations.add(`F5:F${backlogSheet.rowCount}`, { type: 'list', formulae: ['"Planned,In Progress,Blocked,Complete"'] });

for (const sheet of wb.worksheets) {
  sheet.properties.defaultRowHeight = 20;
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  sheet.headerFooter.oddFooter = '&LBalikTela Research Prototype&CPage &P of &N&RConfidential demo tracker';
}

await wb.xlsx.writeFile(outputPath);
console.log(`Created ${outputPath} with ${features.length} tracked features and ${backlog.length} backlog items.`);

function solid(argb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb } }; }
function bottom(argb) { return { bottom: { style: 'thin', color: { argb } } }; }
function statusColor(status, palette) { return status === 'Implemented' ? palette.green : status === 'Implemented - Demo' ? palette.blue : status === 'Partial' ? palette.amber : palette.red; }
