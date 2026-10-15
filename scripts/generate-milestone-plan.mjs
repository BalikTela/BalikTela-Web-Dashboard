import { writeFile } from 'node:fs/promises';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';

const outputPath = new URL('../BalikTela_9_Milestone_Deliverables_Plan.docx', import.meta.url).pathname;
const C = { dark: '193C31', green: '27775C', mint: 'DCECE6', pale: 'EDF4F1', ink: '17201D', muted: '66736E', line: 'D9E2DE', white: 'FFFFFF', amber: 'B16C22', soft: 'F5F7F6', blue: '3E6D8C' };
const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } };
const hairline = { top: border(C.line), bottom: border(C.line), left: border(C.line), right: border(C.line), insideHorizontal: border(C.line), insideVertical: border(C.line) };

const roles = [
  ['Textile Waste Producer', 'Individuals, businesses, institutions, and organizations that generate and make textile waste available.', 'Profiles; listings; acquisition requests; pickup/delivery coordination; transactions; diversion summaries.'],
  ['Recycler/Beneficiary', 'Individuals, businesses, cooperatives, livelihood groups, and organizations that acquire textile waste.', 'Browse and request materials; confirm receipt; record recycling, upcycling, repurposing, and transformation outcomes.'],
  ['Researcher/Government Monitoring User', 'Authorized researchers, project personnel, LGUs, government agencies, and monitoring institutions.', 'Secure access to aggregated and anonymized analytics, geography, indicators, filters, and reports.'],
  ['System Administrator', 'Authorized personnel responsible for platform governance, maintenance, and data quality.', 'Accounts and verification; classifications; transaction oversight; moderation; reference data; settings; system-wide analytics.'],
];

const milestones = [
  {
    no: 1, period: 'November 2025', title: 'Product Baseline, UX Consolidation, and Requirements Alignment', phase: 'Consolidation and Planning',
    objective: 'Establish one approved product direction from the existing Admin and Researcher/Government dashboard and the deployed Producer and Beneficiary/Recycler prototype.',
    requirements: 'All roles; baseline for UR-P01–P07, UR-RB01–RB09, UR-RG01–RG07, and UR-A01–A09',
    roles: 'All four roles',
    deliverables: [
      'Feature and UX audit of the current Admin and Researcher/Government dashboard in the BalikTela repository.',
      'Feature and workflow audit of the deployed Producer and Beneficiary/Recycler prototype, including profiles, marketplace, inventory, barter, messages, wallet, material batches, and transfers.',
      'Approved role journey maps and navigation model for Producer, Recycler/Beneficiary, Researcher/Government Monitoring User, and System Administrator.',
      'Gap analysis identifying screens to retain, adapt, consolidate, retire, or rebuild, with demo-only behavior separated from target behavior.',
      'Canonical data model and terminology for users, organizations, material batches, listings, requests, offers, barter matches, transfers, lifecycle events, facilities, credits, and impact measures.',
      'Requirements traceability matrix, privacy principles, success measures, prioritized backlog, and integration plan for the nine milestones.',
    ],
    gate: 'Project sponsor and role representatives approve the consolidated information architecture, feature disposition, terminology, requirement mapping, and prioritized backlog.',
  },
  {
    no: 2, period: 'December 2025', title: 'Shared Platform Foundation, Authentication, and Role Access', phase: 'Shared Platform',
    objective: 'Create the common technical and identity foundation required to connect all four role experiences without treating role selection as permission.',
    requirements: 'UR-P01, UR-RB01, UR-RG01, UR-A01, UR-A02, UR-A03',
    roles: 'All roles; Administrator leads verification',
    deliverables: [
      'Consolidated React web shell and responsive role-aware navigation using the approved BalikTela visual system; native mobile delivery remains out of scope.',
      'Node.js and Express API foundation with Supabase PostgreSQL migrations, validation, environment configuration, seed strategy, and structured error handling.',
      'Secure registration, sign-in, password hashing, session handling, sign-out, protected routes, and server-enforced role authorization.',
      'User and organization profiles with role, contact and location data, organization details, accepted textile types, consent, and verification state.',
      'Administrator account directory and verification workflow; role changes and verification decisions are audit logged.',
      'Migration contract for replacing device-local and browser-local prototype records with shared platform records while preserving clearly labeled demo data.',
      'Authentication, authorization, consent, profile, and data-migration test cases with setup documentation.',
    ],
    gate: 'Each role can authenticate and access only permitted functions; profile and consent records persist; role selection cannot bypass API authorization; migration tests pass.',
  },
  {
    no: 3, period: 'January 2026', title: 'Producer Workspace: Materials, Inventory, and Listings', phase: 'User Operations',
    objective: 'Adapt the deployed Producer experience into an authenticated workspace for recording textile materials and publishing available supply.',
    requirements: 'UR-P02–UR-P07; supporting UR-A04 and UR-A05',
    roles: 'Textile Waste Producer; System Administrator',
    deliverables: [
      'Producer dashboard with profile summary, inventory status, active listings, incoming requests or offers, recent activity, and clearly labeled sample data where applicable.',
      'Material Batch register with batch code, textile type and category, source, condition or grade, quantity, location, availability, provenance, and evidence fields.',
      'Create, view, edit, archive, and availability controls for Producer-owned batches and listings, with ownership enforced by the API.',
      'Listing terms for donation, sale, or barter, including quantity, credit rate where approved, location, availability, and supporting images or documents.',
      'Producer inbox for requests and offers, with accept, decline, reserve, and expiry behavior.',
      'Producer transaction history and summaries for listed, reserved, transferred, completed, cancelled, and diverted quantities without overstating environmental impact.',
      'Administrator visibility into Producer records and configurable material classifications.',
    ],
    gate: 'A verified Producer can manage only its own material records, publish a complete listing, act on an incoming offer, and see consistent inventory and transaction quantities.',
  },
  {
    no: 4, period: 'February 2026', title: 'Beneficiary/Recycler Marketplace and Acquisition', phase: 'User Operations',
    objective: 'Adapt the deployed Beneficiary/Recycler experience into a secure marketplace for discovering materials and initiating acquisition or reuse.',
    requirements: 'UR-RB02–UR-RB09; supporting UR-A05',
    roles: 'Recycler/Beneficiary; Textile Waste Producer; System Administrator',
    deliverables: [
      'Beneficiary/Recycler dashboard with available materials, active requests and offers, accepted exchanges, receipt tasks, and recent activity.',
      'Searchable marketplace with filters for textile type, category, condition, location, quantity, transaction mode, availability, and provider.',
      'Material detail view with source, provenance, listed quantity, location, terms, provider verification, and traceability context.',
      'Acquisition request and offer flow with requested quantity, proposed terms, intended use, recipient organization, and expiry.',
      'Request and offer history with pending, accepted, declined, cancelled, expired, and completed states.',
      'Facility or capability profile covering accepted textiles, service area, collection or recovery capability, capacity, and verification status.',
      'Receipt confirmation, received-weight recording, discrepancy handling, and initial transformation or productive-use record.',
    ],
    gate: 'A verified Beneficiary/Recycler can find a suitable listing, submit an authorized request or offer, track the decision, and confirm receipt with an auditable measured quantity.',
  },
  {
    no: 5, period: 'March 2026', title: 'Barter, Coordination, Messaging, and Reward Activity', phase: 'Exchange and Engagement',
    objective: 'Turn the prototype barter, messages, wallet, and matching concepts into governed platform workflows that support coordination without implying cash value or verified impact.',
    requirements: 'UR-P03–UR-P06, UR-RB02–UR-RB06; supporting UR-A06',
    roles: 'Textile Waste Producer; Recycler/Beneficiary; System Administrator',
    deliverables: [
      'Barter listings and offers with offered materials, requested materials, quantities, conditions, terms, expiry, and participant decisions.',
      'Transparent rules-based match suggestions using textile compatibility, quantity, location, and participant capability; match reasons are visible and not represented as machine learning.',
      'Negotiation and validation states for proposed, countered, accepted, declined, expired, and cancelled barter offers.',
      'In-app conversation threads attached to listings or exchanges, with timestamps, participants, moderation controls, and clear replacement of device-only prototype notes.',
      'Coordination fields for pickup or delivery date, handover location, contact instructions, and participant confirmations.',
      'Eco-wallet ledger for approved reward activity, including source event, amount, status, reversal, and administrator audit; credits are clearly labeled as non-cash until policy validation.',
      'Compact Barter Activity dashboard for listings, matches, validation, completed barter, reward activity, and unresolved exceptions.',
    ],
    gate: 'Two authorized participants can complete a governed barter agreement, retain its communication and decision history, and receive only policy-compliant ledger entries that reconcile with the exchange.',
  },
  {
    no: 6, period: 'April 2026', title: 'Material Transfer Traceability and Administrative Governance', phase: 'Traceability and Control',
    objective: 'Connect listings and accepted exchanges to a structured material-transfer lifecycle while completing the governance controls in the existing Admin UI.',
    requirements: 'UR-P04–UR-P07, UR-RB03–UR-RB09, UR-A01–UR-A09',
    roles: 'Textile Waste Producer; Recycler/Beneficiary; System Administrator',
    deliverables: [
      'Shared transaction record linking participants, material batches, listing or barter agreement, accepted terms, transfer quantity, locations, and responsible actors.',
      'Structured lifecycle events with immutable timestamps, actors, statuses, notes, and evidence for proposal, acceptance, scheduled handover, collection, receipt, completion, cancellation, and dispute.',
      'Separate proposed, handover, and received quantities so each measurement retains its provenance and discrepancies remain visible.',
      'Participant timeline, next-action prompts, receipt confirmation, transformation outcome, and exception reporting.',
      'Completed Admin controls for accounts, roles, organizations, verification, consent, listing moderation, transactions, disputes, and evidence review.',
      'Reference-data management for textile categories, waste forms, units, locations, facility types, transfer statuses, and transaction modes.',
      'Data-quality exception queues and audit trails for missing receipt weights, invalid transitions, duplicate records, corrections, moderation, exports, and configuration changes.',
    ],
    gate: 'An exchange can be reconstructed from listing through receipt or cancellation, and Administrators can govern every privileged action with authorization, validation, and audit evidence.',
  },
  {
    no: 7, period: 'May 2026', title: 'Research and Government Analytics Integration', phase: 'Monitoring and Evidence',
    objective: 'Connect the existing Researcher/Government dashboard UI to the shared platform model and produce reconcilable, appropriately qualified indicators.',
    requirements: 'UR-RG02–UR-RG07; supporting UR-A07 and UR-A08',
    roles: 'Researcher/Government Monitoring User; System Administrator',
    deliverables: [
      'Integration of the existing Overview, Waste Analytics, Transactions, Stakeholders, Recycling Facilities, Geographic Insights, Advanced Analytics, and Reports interfaces with shared data contracts.',
      'Coherent KPIs derived from common denominators and periods for listed, offered, transferred, received, reused, bartered, recycled, and diverted quantities.',
      'Global date, geography, textile, stakeholder, facility, transaction, and validation filters that update all relevant KPIs, charts, tables, maps, and exports.',
      'Structured transaction traceability views using the same lifecycle events visible to operational users, with privacy-appropriate detail.',
      'Waste, circular-economy, environmental-impact, stakeholder, facility, geographic, barter, and engagement metrics with documented formulas, periods, units, and denominators.',
      'Data-source register covering Waste Data, Transaction Data, Stakeholder Data, Recycling Facility Data, Consumer Data, Circular Economy Metrics, and system interaction data.',
      'Clear labels for sample, estimated, unvalidated, and validated measures, plus aggregation, anonymization, and small-group disclosure controls.',
    ],
    gate: 'Every published figure traces to governed source fields and a documented formula; operational totals reconcile with monitoring views; filters and privacy controls pass role-based tests.',
  },
  {
    no: 8, period: 'June 2026', title: 'End-to-End Integration, Reporting, Security, and Quality Assurance', phase: 'Validation and Readiness',
    objective: 'Harden the consolidated four-role system, replace remaining disconnected prototype behavior, and prepare a release candidate for pilot use.',
    requirements: 'UR-RG07, UR-A08; quality validation across all role requirements',
    roles: 'All roles; Researcher/Government Monitoring User and Administrator lead acceptance',
    deliverables: [
      'End-to-end integration of profiles, organizations, material batches, listings, requests, offers, barter matches, messages, rewards, transfers, transformations, facilities, analytics, and reports.',
      'Removal or explicit isolation of browser-local and device-local demo behavior; approved sample records remain clearly labeled and resettable.',
      'Filter-aware aggregated reports for research, monitoring, planning, circular-economy performance, geography, engagement, and stakeholder participation.',
      'Functional CSV, PDF, and print exports with authorization, anonymization, formula metadata, reporting period, validation state, and generation history.',
      'Security assessment covering authentication, authorization, input validation, session handling, privacy, and export controls.',
      'Functional, API, integration, regression, reconciliation, responsive, accessibility, backup/recovery, and baseline performance test results across all four roles.',
      'Responsive verification at the agreed desktop sizes and supported mobile web widths; native mobile application publication is not included.',
      'Resolved high-severity defects and release-candidate deployment package with operating, migration, and rollback documentation.',
    ],
    gate: 'Release candidate has no unresolved critical defect; role workflows pass end to end; exports, wallets, transaction quantities, and dashboards reconcile; security and quality gates are approved.',
  },
  {
    no: 9, period: 'July–August 2026', title: 'Pilot Deployment, UAT, Refinement, and Handover', phase: 'Pilot and Closeout',
    objective: 'Validate the consolidated system with representative users from all four roles, refine it from evidence, and deliver the approved project package.',
    requirements: 'End-to-end validation of all documented user requirements',
    roles: 'All four roles',
    deliverables: [
      'Pilot deployment with approved sample or partner data, migration verification, user onboarding, and role-specific training materials.',
      'Formal User Acceptance Testing covering Producer inventory and listings; Beneficiary/Recycler marketplace and receipt; barter and rewards; traceability; Admin governance; and Researcher/Government analytics.',
      'Usability feedback, issue register, prioritization decisions, remediation evidence, and final regression results.',
      'Validated baseline and pilot indicators for listings, offers, barter, transfers, receipt, diversion, transformation, participation, rewards, and system usage.',
      'Final technical documentation covering architecture, APIs, database, deployment, backup, recovery, security, and maintenance.',
      'Final user manuals, administrator guide, data dictionary, requirements traceability matrix, and project completion report.',
      'Production or approved demonstration release, handover session, acceptance sign-off, and post-project improvement backlog.',
    ],
    gate: 'Role representatives complete UAT; agreed critical findings are closed; documentation and release are formally accepted and handed over.',
  },
];

const titleChildren = titlePage();
const children = [];
children.push(heading('Executive Summary', 1));
children.push(body('This revised deliverables plan organizes the Balik Tela: Waste 2 Worth implementation into nine milestone periods from November 2025 through August 2026. It treats the current Admin and Researcher/Government dashboard as one UI baseline and the deployed Producer and Beneficiary/Recycler application as a second UI baseline, then sequences the work required to consolidate them into one governed platform.'));
children.push(callout('Schedule interpretation', 'November 2025 through August 2026 contains ten named calendar months. To preserve the requested nine milestones and the full date range, Milestone 9 combines July and August 2026 for pilot deployment, UAT, refinement, and handover.'));
children.push(heading('Current Product Baseline', 2));
children.push(baselineTable());
children.push(callout('Planning basis', 'The deployed application was reviewed as a feature and workflow reference. Browser-local, device-local, simulated, public-demo, and read-only behavior is not treated as production-complete functionality. The roadmap adapts useful interaction patterns while requiring shared data, authorization, validation, and audit evidence.'));
children.push(heading('Delivery Principles', 2));
children.push(bullet('Role-based by design: every feature is traced to one or more official roles and requirement IDs.'));
children.push(bullet('Build from the current baselines: retain and improve working Admin and Research interfaces, and adapt the Producer and Beneficiary/Recycler workflows instead of recreating them without evidence.'));
children.push(bullet('End-to-end material traceability: listing, acquisition, movement, receipt, and transformation records reconcile.'));
children.push(bullet('Privacy and governance first: monitoring views use aggregated and anonymized information.'));
children.push(bullet('Evidence-based acceptance: each milestone closes only when its acceptance gate is demonstrated.'));
children.push(bullet('Technology alignment: React for the responsive web interface, Node.js/Express for API services, and Supabase PostgreSQL for persistent data. Native mobile application delivery is not included in this plan.'));
children.push(heading('Schedule at a Glance', 2));
children.push(scheduleTable());
children.push(pageBreak());
children.push(heading('Official Role Framework', 1));
children.push(body('The following role definitions are derived from the supplied user-role document. Account credentials contained in that document are intentionally excluded from this plan.'));
children.push(roleTable());
children.push(heading('Responsibility Model', 2));
children.push(body('The Product and Development Team produces the milestone outputs. The four user roles serve as functional owners, reviewers, test participants, and acceptance stakeholders according to the matrix below.'));
children.push(responsibilityTable());

for (let index = 0; index < milestones.length; index++) {
  if (index % 2 === 0) children.push(pageBreak());
  children.push(...milestoneBlock(milestones[index]));
}

children.push(pageBreak());
children.push(heading('Cross-Milestone Deliverables', 1));
children.push(heading('Requirements and Evidence Management', 2));
children.push(bullet('Maintain one requirements traceability matrix linking requirement ID, design element, API, data entity, test case, result, and release.'));
children.push(bullet('Store milestone decisions, demonstrations, test evidence, defects, approvals, and change requests in the project repository.'));
children.push(bullet('Apply version control to source code, database migrations, configuration, test assets, and controlled documentation.'));
children.push(heading('Data and Research Governance', 2));
children.push(bullet('Document data source, owner, collection method, reporting period, refresh frequency, unit, denominator, and validation status.'));
children.push(bullet('Clearly label generated, sample, estimated, unvalidated, and live records in interfaces and reports.'));
children.push(bullet('Use aggregation, anonymization, least-privilege access, consent records, retention controls, and export authorization.'));
children.push(heading('Definition of Done', 2));
children.push(definitionTable());
children.push(heading('Change Control', 2));
children.push(body('Any change to role permissions, requirement scope, calculation methods, milestone dates, or acceptance criteria should be recorded with its rationale, impact, approver, and revised traceability. Requirements should not be considered complete solely because a screen exists; the workflow, data, authorization, error handling, and evidence must also pass.'));
children.push(heading('Final Acceptance Package', 2));
children.push(bullet('Approved system release and deployment record.'));
children.push(bullet('Completed requirements traceability and UAT matrices.'));
children.push(bullet('Technical, administrator, user, data, security, and maintenance documentation.'));
children.push(bullet('Final analytics and evaluation report with clearly stated limitations.'));
children.push(bullet('Handover acknowledgement and prioritized post-project roadmap.'));

const doc = new Document({
  creator: 'BalikTela Project',
  title: 'BalikTela Integrated 9-Milestone Deliverables Plan',
  description: 'Integrated nine-milestone deliverables plan from November 2025 through August 2026.',
  styles: {
    default: { document: { run: { font: 'Aptos', size: 21, color: C.ink }, paragraph: { spacing: { after: 120, line: 276 } } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Subtitle', quickFormat: true, run: { font: 'Aptos Display', size: 48, bold: true, color: C.white }, paragraph: { spacing: { after: 220 }, alignment: AlignmentType.LEFT } },
      { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos', size: 24, color: C.white }, paragraph: { spacing: { after: 160 } } },
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos Display', size: 32, bold: true, color: C.dark }, paragraph: { spacing: { before: 180, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos Display', size: 25, bold: true, color: C.green }, paragraph: { spacing: { before: 160, after: 100 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Aptos', size: 21, bold: true, color: C.ink }, paragraph: { spacing: { before: 120, after: 70 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [{ reference: 'deliverable-bullets', levels: [{ level: 0, format: 'bullet', text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 180 } } } }] }] },
  sections: [
    {
      properties: { type: SectionType.NEXT_PAGE, page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      headers: { default: projectHeader() },
      children: titleChildren,
    },
    {
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      headers: { default: projectHeader() },
      footers: { default: projectFooter() },
      children,
    },
  ],
});

await writeFile(outputPath, await Packer.toBuffer(doc));
console.log(`Created ${outputPath}`);

function titlePage() {
  return [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ height: { value: 8200, rule: 'atLeast' }, children: [new TableCell({ verticalAlign: VerticalAlign.CENTER, shading: { type: ShadingType.CLEAR, fill: C.dark }, margins: { top: 900, right: 700, bottom: 900, left: 700 }, children: [
      new Paragraph({ style: 'Title', children: [new TextRun('Balik Tela: Waste 2 Worth')] }),
      new Paragraph({ style: 'Subtitle', children: [new TextRun('Integrated Nine-Milestone Deliverables Plan')] }),
      new Paragraph({ spacing: { before: 460, after: 140 }, children: [new TextRun({ text: 'IMPLEMENTATION PERIOD', bold: true, size: 17, color: '77D6B2' })] }),
      new Paragraph({ children: [new TextRun({ text: 'November 2025 – August 2026', bold: true, size: 28, color: C.white })] }),
      new Paragraph({ spacing: { before: 520 }, children: [new TextRun({ text: 'Role-aligned delivery roadmap for the circular textile management platform', size: 21, color: 'C6D6D0' })] }),
    ] })] })] }),
    new Paragraph({ spacing: { before: 300 }, children: [new TextRun({ text: 'Revised for consolidated Admin, Researcher/Government, Producer, and Beneficiary/Recycler delivery', size: 18, color: C.muted })] }),
    new Paragraph({ children: [new TextRun({ text: 'Document date: 28 September 2026', size: 17, color: C.muted })] }),
  ];
}

function projectHeader() {
  return new Header({ children: [new Paragraph({ border: { bottom: border(C.line) }, children: [new TextRun({ text: 'BALIK TELA: WASTE 2 WORTH', bold: true, size: 17, color: C.green }), new TextRun({ text: '   |   9-Milestone Deliverables Plan', size: 17, color: C.muted })] })] });
}

function projectFooter() {
  return new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Project implementation schedule   •   ', size: 16, color: C.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: C.muted })] })] });
}

function milestoneBlock(item) {
  return [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ children: [
      new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, shading: { fill: C.dark }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `M${item.no}`, bold: true, size: 27, color: C.white })] })] }),
      new TableCell({ width: { size: 85, type: WidthType.PERCENTAGE }, shading: { fill: C.pale }, margins: { top: 180, bottom: 180, left: 220, right: 220 }, children: [new Paragraph({ children: [new TextRun({ text: item.period.toUpperCase(), bold: true, size: 16, color: C.green })] }), new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: item.title, bold: true, size: 24, color: C.ink })] }), new Paragraph({ children: [new TextRun({ text: item.phase, size: 17, color: C.muted })] })] }),
    ] })] }),
    heading('Objective', 3), body(item.objective),
    keyValueTable([['Requirements covered', item.requirements], ['Primary role coverage', item.roles]]),
    heading('Key Deliverables', 3),
    ...item.deliverables.map(bullet),
    callout('Milestone acceptance gate', item.gate),
    new Paragraph({ spacing: { after: 200 } }),
  ];
}

function baselineTable() {
  const rows = [tableHeader(['Current Baseline', 'Observed Scope', 'Roadmap Treatment'])];
  const items = [
    ['BalikTela dashboard repository', 'Admin and Researcher/Government UI for overview, waste, transactions, stakeholders, facilities, geography, analytics, reports, users, and sample data.', 'Preserve the current design quality; connect it to governed shared data, permissions, formulas, filters, and audit evidence.'],
    ['Deployed Producer and Beneficiary/Recycler prototype', 'Profiles, marketplace, inventory, listings, barter matches, messages, eco-wallet activity, material batches, transfers, and public impact views.', 'Use as the workflow and interaction reference; replace isolated demo storage and perspective switching with authenticated role behavior and shared records.'],
    ['Shared production platform', 'A complete, validated four-role system is not yet established across both baselines.', 'Build the common React, Node.js/Express, and Supabase contracts, then verify end-to-end reconciliation and acceptance.'],
  ];
  items.forEach(([name, scope, treatment]) => rows.push(new TableRow({ children: [cell(name, { bold: true, color: C.green, width: 25 }), cell(scope, { width: 37 }), cell(treatment, { width: 38 })] })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: hairline });
}

function scheduleTable() {
  const rows = [tableHeader(['Milestone', 'Period', 'Delivery Package', 'Primary Roles'])];
  for (const item of milestones) rows.push(new TableRow({ children: [cell(`M${item.no}`, { bold: true, color: C.green, width: 12 }), cell(item.period, { width: 20 }), cell(item.title, { width: 43 }), cell(item.roles, { width: 25 })] }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: hairline });
}

function roleTable() {
  const rows = [tableHeader(['Official Role', 'Who the Role Represents', 'Primary System Responsibility'])];
  roles.forEach(([name, who, responsibility]) => rows.push(new TableRow({ children: [cell(name, { bold: true, color: C.green, width: 24 }), cell(who, { width: 36 }), cell(responsibility, { width: 40 })] })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: hairline });
}

function responsibilityTable() {
  const rows = [tableHeader(['Work Area', 'Producer', 'Recycler / Beneficiary', 'Researcher / Government', 'Administrator'])];
  const matrix = [
    ['Requirements and workflow validation', 'Review', 'Review', 'Review', 'Approve'],
    ['Listings and material supply', 'Own', 'Consult', 'Observe aggregate', 'Govern'],
    ['Acquisition and transformation', 'Coordinate', 'Own', 'Observe aggregate', 'Govern'],
    ['Analytics and reports', 'Review own data', 'Review own data', 'Own monitoring view', 'Administer'],
    ['Account, classification, and data quality', 'Comply', 'Comply', 'Review', 'Own'],
    ['UAT and acceptance', 'Test', 'Test', 'Test', 'Coordinate'],
  ];
  matrix.forEach((row) => rows.push(new TableRow({ children: row.map((value, index) => cell(value, { bold: index === 0, color: index === 0 ? C.green : C.ink, width: index === 0 ? 28 : 18 })) })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: hairline });
}

function definitionTable() {
  const rows = [tableHeader(['Completion Dimension', 'Minimum Evidence Required'])];
  const items = [
    ['Functionality', 'The complete workflow works for the intended role, including validation, errors, and empty states.'],
    ['Authorization', 'Permitted roles can act; unauthorized roles are blocked by both interface and API.'],
    ['Data integrity', 'Records persist, reconcile across screens and reports, and retain timestamps and responsible actors.'],
    ['Privacy and governance', 'Consent, anonymization, audit, retention, and export rules are applied as required.'],
    ['Quality', 'Unit, integration, regression, responsive, and accessibility checks pass for the agreed scope.'],
    ['Documentation', 'User guidance, technical notes, data definitions, configuration, and known limitations are current.'],
    ['Acceptance', 'The responsible role representative demonstrates the acceptance criteria and records approval or findings.'],
  ];
  items.forEach(([dimension, evidence]) => rows.push(new TableRow({ children: [cell(dimension, { bold: true, color: C.green, width: 28 }), cell(evidence, { width: 72 })] })));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: hairline });
}

function keyValueTable(items) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: hairline, rows: items.map(([key, value]) => new TableRow({ children: [cell(key, { bold: true, color: C.green, width: 27, fill: C.soft }), cell(value, { width: 73 })] })) });
}

function tableHeader(labels) {
  return new TableRow({ tableHeader: true, children: labels.map((label) => new TableCell({ shading: { fill: C.green }, margins: { top: 120, bottom: 120, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 17, color: C.white })] })] })) });
}

function cell(text, { bold = false, color = C.ink, width = 25, fill } = {}) {
  return new TableCell({ width: { size: width, type: WidthType.PERCENTAGE }, shading: fill ? { fill } : undefined, margins: { top: 110, bottom: 110, left: 120, right: 120 }, verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text, bold, size: 17, color })] })] });
}

function callout(label, text) {
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders, rows: [new TableRow({ children: [new TableCell({ shading: { fill: C.pale }, borders: { left: { style: BorderStyle.SINGLE, color: C.green, size: 18 }, top: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE } }, margins: { top: 160, bottom: 160, left: 220, right: 180 }, children: [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 15, color: C.green })] }), new Paragraph({ children: [new TextRun({ text, size: 18, color: C.ink })] })] })] })] });
}

function heading(text, level) { return new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3, children: [new TextRun(text)] }); }
function body(text) { return new Paragraph({ children: [new TextRun({ text, size: 20, color: C.ink })] }); }
function bullet(text) { return new Paragraph({ numbering: { reference: 'deliverable-bullets', level: 0 }, spacing: { after: 70 }, children: [new TextRun({ text, size: 19, color: C.ink })] }); }
function border(color) { return { style: BorderStyle.SINGLE, color, size: 5 }; }
function pageBreak() {
  return new Paragraph({
    spacing: { after: 0 },
    children: [new TextRun({ children: [new PageBreak()] })],
  });
}
