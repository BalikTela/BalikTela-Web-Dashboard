import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel,
  PageBreak, PageNumber, Packer, Paragraph, ShadingType, Table, TableCell, TableRow,
  TextRun, WidthType,
} from 'docx';
import { DATABASE_COLLECTIONS } from '../server/database/schema.js';
import { aggregate } from '../server/dashboardAnalytics.js';
import { percentage, formatMass } from '../shared/metrics.js';
import type { MaterialBatchRecord, RecoveryRecord, TransferRecord } from '../server/types.js';

// This report generator reads source contracts only. It never loads environment credentials or a Store.
const root = new URL('../', import.meta.url);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(root), encoding: 'utf8' }).trim();
const reportDate = '18 October 2026';
const title = 'BalikTelaPH Web Dashboard Data Flow Report';
const outputName = 'BalikTelaPH_Web_Dashboard_Data_Flow_Report';
const color = { ink: '172A23', green: '22634D', muted: '596B62', line: 'D9E3DD', pale: 'F1F6F3' };

type Block = { kind: 'heading'; title: string; level: 1 | 2 }
  | { kind: 'paragraph'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][]; widths?: number[] }
  | { kind: 'break' };
const blocks: Block[] = [];
const h = (title: string, level: 1 | 2 = 1) => blocks.push({ kind: 'heading', title, level });
const p = (text: string) => blocks.push({ kind: 'paragraph', text });
const table = (headers: string[], rows: string[][], widths?: number[]) => blocks.push({ kind: 'table', headers, rows, widths });
const page = () => blocks.push({ kind: 'break' });

const sources = [
  ['S01', 'Runtime and API routes', 'server/index.ts', "app.get('/api/analytics/dashboard'"],
  ['S02', 'Dashboard cohort selection and calculations', 'server/dashboardAnalytics.ts', 'export function selectAnalyticsCohort'],
  ['S03', 'Supabase persistence and enrichment', 'server/supabaseStore.ts', 'export class SupabaseStore'],
  ['S04', 'Canonical field and status translation', 'server/database/codecs.ts', 'const listingStatusFromDb'],
  ['S05', 'Actual PostgreSQL table definitions', 'supabase/migrations/20261007040000_baliktela_schema_v2.sql', 'create table if not exists public."users"'],
  ['S06', 'Dashboard source snapshot SQL', 'supabase/migrations/20261012120000_dashboard_snapshot_rpc.sql', 'create or replace function'],
  ['S07', 'Role permissions and record scopes', 'server/access-control.ts', 'export const ROLE_PERMISSIONS'],
  ['S08', 'Reporting dates and capacity proration', 'shared/reporting.ts', 'export function resolveReportingPeriod'],
  ['S09', 'Units and percentage helpers', 'shared/metrics.ts', 'export function percentage'],
  ['S10', 'Data quality rules', 'server/dataQuality.ts', 'export function buildDataQuality'],
  ['S11', 'Atomic management workflows', 'server/management.ts', 'export async function saveManagement'],
  ['S12', 'Reports and exports', 'server/reports.ts', 'export async function buildReport'],
  ['S13', 'Web routes and mounted modules', 'src/DashboardApp.tsx', 'function DashboardWorkspace'],
  ['S14', 'Web data cache and invalidation', 'src/hooks/useDashboardData.ts', 'const freshForMs'],
  ['S15', 'Synthetic operational source builder', 'server/analytics/operationalDemo.ts', 'export function buildOperationalDemo'],
  ['S16', 'October synthetic scenario', 'server/analytics/octoberDemo.ts', 'export function buildOctoberDemo'],
  ['S17', 'Predictive synthetic generator', 'server/analytics/synthetic.ts', 'export function generateSyntheticDataset'],
  ['S18', 'Predictive methods and evaluation', 'server/analytics/predictive.ts', 'export function buildPredictiveReport'],
  ['S19', 'Predictive endpoints and export scope', 'server/analytics/routes.ts', 'export function registerPredictiveRoutes'],
  ['S20', 'Shared authentication identity bridge', 'server/provisioning.ts', 'export async function provisionedUserMutation'],
  ['S21', 'Legacy synchronization test limits', 'scripts/test-mobile-sync.ts', 'const batchId'],
  ['S22', 'Geographic reference assets', 'src/lib/geography.ts', ''],
  ['S23', 'Overview and rule-based insight text', 'src/pages/Overview.tsx', 'export function Overview'],
  ['S24', 'Authenticated operational mass accounting', 'server/domain.ts', 'export function calculateOperationalMass'],
  ['S25', 'Original synthetic figures', 'src/data/mockData.ts', ''],
  ['S26', 'Supabase identity provider', 'server/supabaseIdentity.ts', 'export class'],
  ['S27', 'Predictive dataset dictionary', 'data/predictive/v1/data-dictionary.json', ''],
  ['S28', 'Public homepage content', 'src/data/publicContent.ts', ''],
] as const;

h('1 Executive Summary');
p('BalikTelaPH has two connected responsibilities: the mobile application records participation and textile exchange activity; the web dashboard manages, monitors, analyzes and governs the resulting records. Matching means connecting the same canonical records by IDs and agreed field meanings, not copying mobile screen totals into web cards.');
p('The web implementation reads Supabase PostgreSQL through its Express API and converts database snake_case columns into TypeScript camelCase records. It then applies account permissions, selected cohorts and calculations before returning charts and tables. A shared database is necessary but not sufficient: mobile must create linked batches, measurements, transfers and recovery evidence in the structure the web actually reads. [S01-S07]');
p('There are three separate information classes: operational records in Supabase, synthetic operational records deliberately inserted into those same tables, and a separate synthetic predictive dataset generated in the server and exported as bundled artifacts. A live database connection does not make a synthetic record real. Environmental equivalents are disabled, and several values still have explicit or implicit demonstration behavior.');
table(['Question', 'Current answer'], [
  ['Where do headline mass metrics come from?', 'material_batches, transfers, measurements and recovery_records; calculated by server/dashboardAnalytics.ts, not independently typed into each tile.'],
  ['Where do mobile records match?', 'users.id, material_batches.id, listings.id, match_requests.id, transfers.id and facilities.id, with their referencing columns preserved across clients.'],
  ['Does every mobile table already feed the dashboard?', 'No. Collection receipts, events, support records and several research tables exist in the contract but are not consumed by current analytics. See Sections 10 and 12.'],
  ['Is predictive analytics using live mobile history?', 'No. It uses 9,600 generated synthetic observations on a fixed 120-week snapshot, separate from Supabase operational analytics.'],
  ['Is mobile-to-web updating instantaneous?', 'No. There is server/client caching and no operational-data real-time subscription. A stale mounted page needs a data-fetch trigger.'],
  ['What is the next integration gate?', 'Agree on identifiers, statuses, stage evidence, geographic vocabulary and denominators; then reconcile one controlled lifecycle end to end.'],
], [28, 72]);
p(`Review basis: local web source commit ${commit.slice(0, 7)}, reviewed ${reportDate}. This is an implementation data-lineage report, not a claim that production database contents, deployed functions or the separately maintained mobile application were inspected. No shared data was changed while producing it.`);

h('2 End to End Data Flow');
table(['Step', 'Data movement and responsibility'], [
  ['1 Participant action', 'A consumer, producer, recycler, NGO or collection operator records a listing, proposal, handover, receipt or recovery operation in the mobile app. An authorized web administrator can also register or govern records.'],
  ['2 Authorized write', 'Use the shared governed API, or a separately secured mobile backend/RPC with the same canonical contract and invariants. The mobile implementation route must be confirmed by its developer; the web repo does not establish it.'],
  ['3 Shared persistence', 'Persist canonical IDs, kilogram weights, evidence stages and timestamps in Supabase public tables. Supabase Auth stores credentials; public.users stores the linked application profile and assigned scope.'],
  ['4 Web source read', 'SupabaseStore calls get_dashboard_source_snapshot for analytics. If that optimization RPC is absent, it falls back to canonical table reads. Other registry endpoints can read tables directly through the same store. [S03, S06]'],
  ['5 Translation and joins', 'Codecs map snake_case to camelCase. Transfers are enriched with flow_events and latest stage-specific measurements; listings can inherit missing material metadata from their linked batch. [S04]'],
  ['6 Authorization and selection', 'The Express API reloads current session/account permissions and selects permitted batches, then applies reporting dates and global filters. Aggregate-only responses suppress individual transaction/stakeholder lists. [S07, S08]'],
  ['7 Derived data', 'Dashboard builder calculates masses, counts, rates, facility allocations, regional groups and engagement summaries. Report generation reuses the same cohort and aggregation logic. [S02, S12]'],
  ['8 Presentation', 'React consumes /api/analytics/dashboard or the relevant registry endpoint. Chart.js renders analytics; Leaflet renders reference geography. Canonical kg are converted to metric tons at the display boundary.'],
], [25, 75]);
p('Main operational chain: users + organizations -> material_batches -> listings -> match_requests -> transfers -> measurements + flow_events -> recovery_records + reward_ledger -> scoped API calculations -> web charts, registries and reports. Each arrow is a relationship, not an extra quantity to add.');
p('Independent predictive chain: deterministic synthetic generator -> 9,600 event observations -> 120 weekly aggregates -> chronological training/validation/test -> forecast and selection models -> /api/analytics/predictive -> Advanced Analytics. Supabase operational tables are not an input to this chain today.');

h('3 Source Ownership and Record Grain');
table(['Canonical source', 'Who originates it', 'What one record means'], [
  ['auth.users + users', 'Supabase identity flow; participant profile; administrator approval', 'One Auth identity and its linked application profile. Role/scope are administrator-governed, not inferred from profile text.'],
  ['organizations / facilities', 'Administrator and authorized institutional representatives', 'One institution or one physical/program facility; capacity is a declared monthly capability, not a measured throughput total.'],
  ['material_batches', 'Mobile participant or authorized administrative registration', 'One identified quantity of textile material. Count its declared mass once even if it appears in multiple listings or transfers.'],
  ['listings', 'Mobile availability/exchange workflow', 'One marketplace publication linked by batch_id. Listing availability is not proof of collection, receipt or recycling.'],
  ['match_requests', 'Prospective recipient; provider response', 'One proposal on one listing. The web API calls this an offer; it is not a separate offers table.'],
  ['transfers', 'Accepted proposal / governed workflow', 'One agreement/custody transfer linked to a batch and listing, with provider, recipient and outcome.'],
  ['measurements', 'Named recorder and, where applicable, verifier', 'One mass observation at one lifecycle stage and time. Declaration, handover, receipt and validation must stay separate.'],
  ['flow_events', 'Governed lifecycle action', 'One sequenced status/event observation with actor, timestamp, location and optional measurement reference.'],
  ['recovery_records', 'Facility/collection/recovery operator; authorized validator', 'One stage input/output balance for a batch at a facility. Stage totals are not automatically unique mass.'],
  ['reward_ledger', 'Reward-issuing workflow after eligible completion', 'One non-cash points entry linked to a user and, where applicable, transfer. Not textile mass or revenue.'],
  ['system_interactions', 'Instrumented client/server or summary-producing job', 'Current analytics expect event-count summary rows with properties.count, not arbitrary raw click rows.'],
  ['activity_logs / configurations', 'Governed API actions / administrator', 'One audit entry or versioned configuration. They explain decisions and definitions; they do not represent extra textile mass.'],
], [26, 31, 43]);
p('Do not join organizations by display name, users by name/email, or materials by title. Names and emails can change or be duplicated. Use canonical IDs; preserve the source profile ID when an Auth trigger already created it. The persistence contract uses text business IDs; auth.users.id is a UUID linked by users.auth_user_id. [S05, S20]');

h('3.1 Where the synthetic operational figures originate', 2);
p('The original January-September 2026 fixture is generated in src/data/mockData.ts, not collected from participants. Preset national monthly declared masses range from 19,200 kg in January to 49,300 kg in September. Each month is allocated across four region shares (Metro Manila 48%, Central Visayas 20%, Western Visayas 14%, Davao 18%) and six textile shares. Collection and sorting percentages increase by formula; category-specific reuse/recycling ratios create the outcome masses. These assumptions intentionally create a coherent demonstration trend, not measured regional performance. [S25]');
p('buildOperationalDemo converts those fixture figures into linked SYN- batches, declaration/handover/receipt/validation measurements, listings, accepted proposals, completed transfers, Collection/Sorting recovery balances, flow events and reward entries. Engagement is generated separately from preset monthly active-user totals and formula-based session/submission/action/export summaries. Thus engagement totals are not a count of the small synthetic user registry. The initial Supabase dashboard seed persists the resulting records; the web then calculates cards from those tables. It does not use every legacy mock export as a live frontend fallback. [S15]');
p('October is a separate additive synthetic scenario covering 1-16 October 2026: 24 batches based on September fixture rows, with mass scaled by 1.08 and constrained to coherent collected/sorted/outcome balances. Engagement scales selected September summary counts by 1.03 or 1.08 and uses a 16 October timestamp. It reuses fictional SYN registry records. It is a month-to-date illustration, not a full-month projection or observed October growth. These seeding paths describe intended fixture provenance; they are not a fresh inventory of the deployed database. [S16]');

page();
h('4 Dashboard Information Lineage');
p('The entries below describe the current implementation. Column names refer to Supabase; names after an arrow are the web/API aliases. Operational analytics share the selected batch-registration cohort unless a different time basis is stated. [S02, S04, S08]');

h('4.1 Overview and Waste Analytics', 2);
table(['Information', 'Source fields', 'Calculation and mobile requirement'], [
  ['Generated / declared textile waste', 'material_batches.declared_weight_kg; id; created_at; current_status', 'Sum declared mass once per selected non-archived batch. This means platform-declared textile material, not total Philippine waste or total manufacturer output. Mobile must create the batch, not only a listing.'],
  ['Textile waste collected', 'recovery_records.stage = Collection; output_kg; batch_id; status', 'Sum Collection outputs for selected batches, excluding reversed records and future-created recovery rows. A listing, receipt measurement or collection_receipts row alone does not update this KPI. Recorded and flagged recovery rows are not otherwise excluded today.'],
  ['Sorted material', 'recovery_records.stage = Sorting; output_kg', 'Sum non-reversed Sorting outputs. Mobile must write the stage balance explicitly; processing/receipt records are not inferred as sorting.'],
  ['Textile waste recycled', 'transfers.status = completed; circular_outcome = Recycling; measurements.stage = validation; weight_kg', 'Sum latest validation weight for completed Recycling transfers. Status alone without linked validation measurement contributes no verified mass.'],
  ['Reused / Bartered', 'Completed transfers with Reuse, Repair, Redistribution or Upcycling outcome; latest validation weight', 'Sum these outcome weights. The current label includes more than literal barter; transfer_type is not used by this classifier. Collection, Recovery and Diversion outcomes are not included in these reuse/recycling totals.'],
  ['Diverted from Landfill tile', 'Verified reused mass + verified recycled mass', 'Operational proxy equal to reused + recycled. It is not a validated landfill-avoidance calculation; environmental landfill equivalents remain disabled. Rename/qualify this label before claiming verified environmental impact.'],
  ['Diversion / circularity rate', 'Reused + recycled mass; declared batch mass', '100 x (reused + recycled) / declared mass. Uses a different denominator from category recovery and sorting yield. Zero denominator should be interpreted as unavailable.'],
  ['Prior-period change', 'Same calculation on prior selected registration cohort', 'Mass/count delta = 100 x (current - previous) / previous. Rate changes use percentage points, not relative percent change. No positive baseline is labeled as such, not infinity.'],
  ['Total transactions KPI', 'transfers.status = completed; linked batch_id', 'Count completed scoped transfers, not all proposals, all transfers, wallet entries or lifecycle events. A missing verification weight can still count as a completed row and produce a quality finding.'],
  ['Active producers', 'Selected batch source_user_id joined to users.role = Producer', 'Distinct source users per batch region, then sum regional counts. This is participation in the cohort, not login activity; the same user operating in multiple regions can be counted more than once platform-wide.'],
  ['Active recyclers', 'Selected transfer recipient_id joined to users.role = Recycler', 'Distinct recipients per batch region across matching transfers, including unfinished ones; regional counts are summed. Not a unique platform MAU or a count of all registered recyclers.'],
  ['Waste trend and featured sparkline', 'Same declared/collection/reuse/recycling calculations grouped by batch created_at month', 'Months use Asia/Manila batch registration, not measurement/completion month. A later completion can change an older registration-month bar. Partial current months are not forecasts.'],
  ['Textile category mix', 'material_batches.material_category; Collection outputs', 'Category mass is collected mass, not declared or recycled mass. Doughnut share = category collected mass / all collected mass in the selected scope.'],
  ['Category recovery rate', 'Completed reused + recycled mass in category; category collected mass', '100 x category recovered / category collected. This denominator differs from the overall diversion rate. Current helper returns 0 when collected mass is zero.'],
  ['Circular textile flow', 'Declared batches, Collection/Sorting outputs, completed outcome weights', 'Generated, collected, sorted, reused and recycled are successive/branching stages; never add them as total waste. Residual = max(0, declared - reused - recycled). It includes uncollected, unverified and pending material, not just physical disposal/loss.'],
  ['Recent transactions', 'Latest scoped transfers; users; linked batch location; flow_events', 'Sort by updated_at; show five rows. Display weight chooses validation, then receipt, then agreed mass. An unfinished row is not verified diversion.'],
  ['Sample insights', 'regionalActivity.wasteGapKg; category recovery rates; facility utilization', 'Deterministic ranking: largest gap, lowest recovery and lowest-utilization facility. Spare capacity = 100 - utilization when <=100. These are simple cues, not a prescriptive or ML system.'],
], [23, 29, 48]);

h('4.2 System Oversight and Environmental Information', 2);
table(['Information', 'Source', 'Interpretation'], [
  ['Batch count / declared material', 'Unique selected material_batches.id and declared_weight_kg', 'Same batch population as program analytics. A batch can have multiple measurements and transfers without increasing its declared mass count.'],
  ['Verified completion', 'All completed transfers, latest validation measurement', 'Operational helper sums completed verified mass regardless of circular_outcome. This can differ from reused + recycled if mobile uses other outcomes. [S24]'],
  ['Measured material', 'All selected measurements with weight_status = Measured', 'Sum of stage observations; the same material may be weighed more than once. It is not unique collected mass.'],
  ['Active transfers', 'Transfers not Completed, Cancelled or Rejected', 'Includes Reserved, Handed over, Received, Validated and Disputed states after decoding.'],
  ['Mass balance', 'Declared batches; handover/receipt/validation measurements; transfers.discrepancy_kg', 'Declared counted once; handover and receipt summed across transfers; verified completion uses completed only. Discrepancy is signed receipt minus handover, falling back to agreed.'],
  ['Quality flags in oversight', 'Transfer discrepancy_kg and batch weight_status', 'Oversight discrepancy count uses absolute variance >0.01 kg. It is not the configured percentage-threshold count shown by Data Quality.'],
  ['Circularity and sorting yield', 'Completed reused + recycled weights divided by declared or sorted mass', 'Circularity = recovered / declared; sorting yield = recovered / sorted. Percentages can exceed 100 when evidence is inconsistent; they are not silently capped.'],
  ['CO2e, water and landfill-equivalent impact', 'No approved factors applied; API values null', 'Disabled pending approved methodology. Do not derive them from mobile My Impact totals or treat null as zero impact.'],
], [24, 31, 45]);

h('4.3 Listings Materials and Traceability', 2);
table(['Information', 'Source and relationship', 'How mobile should match it'], [
  ['Listing title, description and owner', 'listings.title, description, owner_name, owner_id, owner_organization_id', 'Save owner_id as users.id. Names are cached display fields; keep canonical relationships even if names change. Listing oversight uses local search/status/region/material/pathway/evidence/source/demo filters, not the global cohort filter.'],
  ['Listing material, condition and quantity', 'category -> textileType; condition -> quality; weight_kg -> quantityKg, falling back to available_weight_kg', 'Keep weight_kg and availability semantics aligned; existing weight_kg takes precedence. Missing material/location metadata can fall back to the linked batch. reserved_kg is not itself the displayed quantity.'],
  ['Listing counts and availability', 'Decoded listing status: Open, Matched, Reserved, Completed, Closed', 'Counts come from locally filtered listings. These counts do not prove physical transfer or recovery. Persist canonical lowercase statuses; see Section 7.'],
  ['Material identity and provenance', 'material_batches.id, source_user_id, source_organization_id, material_category, waste_source, waste_form, condition', 'Use the original batch ID throughout the chain. Keep a distinct source user and source organization; do not substitute a recycler or the current viewer for the original source.'],
  ['Material current state and location', 'current_weight_kg, weight_status, current_custodian_id, current_status, intended_pathway/final_pathway, location JSON', 'Preserve declared_weight_kg when a receiving measurement changes current mass. final_pathway overrides intended_pathway in decoding. Batch region/city comes from location.region and location.city.'],
  ['Registry verified mass', 'Current weight of batches whose weight_status = Verified', 'This is a stock/evidence-state sum, not the same as completed transfer outcome mass. Do not expect it to equal the recycled KPI automatically.'],
  ['Material measurement history', 'measurements.batch_id -> material_batches.id', 'All stage rows appear under the batch. Include recorder, verifier, method, measured_at and note, with a separate ID per observation.'],
  ['Offers tab', 'match_requests.requester_id -> recipientId; provider_id; listing_id; requested_kg; terms; incentive_points', 'The requester is the prospective recipient, not the provider. Accepted proposals must be linked to transfers through match_request_id; acceptance alone is not completion. The offers view loads its own offer list rather than applying every global analytics filter.'],
  ['Transfer agreement', 'transfers.id, batch_id, listing_id, match_request_id, provider_id, recipient_id, agreed_weight_kg, agreed_terms', 'Every reference points to the same canonical row used by mobile. Whole agreement and physical measurements are separate concepts.'],
  ['Handover, receipt and verified columns', 'Latest measurements per transfer_id and stage handover / receipt / validation', 'Write these measurement rows; there are no standalone handover_weight_kg/receipt_weight_kg/verified_weight_kg columns in the canonical transfers table. Sorting by measured_at selects the latest observation.'],
  ['Lifecycle timeline', 'flow_events.transfer_id; sequence; stage; actor_id/name; occurred_at; event_status; measurement_id; location; note', 'Append structured events for each action; do not provide only a free-text transaction history. Measurement links explain which weight supports each event.'],
  ['Discrepancy and reward status', 'transfers.discrepancy_kg, discrepancy_reason, reward_issued_at; reward_ledger', 'Receipt variance is signed; document a reason. reward_issued_at is an issuance marker; points must reconcile with ledger entries and must not be issued twice.'],
], [23, 34, 43]);

h('4.4 Stakeholders Facilities and Geography', 2);
table(['Information', 'Source and rule', 'Important boundary'], [
  ['Stakeholder directory and groups', 'Participating source/provider/recipient users joined by users.id; role selects Producer, Recycler, Consumer or NGO tab', 'Only users involved in the filtered cohort appear, not all registered users. Upcycler and LGU roles exist but are not separate directory tabs today. Aggregate-only access suppresses individual profiles.'],
  ['Stakeholder generated / recovered', 'Generated = own source batch declarations; recovered = completed verified transfers received by user', 'A provider may show zero recovered even when its textiles are recovered downstream. Do not add stakeholder source and recipient masses as new material.'],
  ['Stakeholder completion / activity', 'Completed linked transfers / all linked transfers; count all provider-or-recipient involvements', 'Overall profile activity can count a transfer under both participants; it is not a unique transaction count.'],
  ['Sustainability and verification', 'users.profile.sustainability_interests; verification_status; created_at', 'These are profile claims, assigned verification states and account creation date, not independently verified impact calculations.'],
  ['Trust / reliability', 'users.trust_placeholder, default 50 when absent', 'Stored demonstration score displayed as /100. No validated algorithm or reliability model; never use as an approval or risk decision automatically.'],
  ['Stakeholder traceable material', 'Sum displayed weights of matching transaction history', 'History can include unfinished transfers and uses verified/receipt/agreed fallback; this is activity mass, not necessarily unique or completed recovered mass.'],
  ['Facility identity / materials / status', 'facilities.name, city, region, categories, status, organization_id', 'Analytical facility table includes non-inactive facilities that have recovery rows for selected batches. It is not a directory count of every facility in Supabase. Status is stored, not recalculated from utilization.'],
  ['Facility period capacity', 'monthly_capacity_kg x selected window capacityMonths', 'CapacityMonths sums actual calendar-month fractions. Changes to today\'s capacity apply to the current calculation; no historical capacity-version reconstruction is implemented.'],
  ['Facility intake', 'Earliest non-reversed recovery row for each selected batch at that facility', 'If earliest stage is Collection use output_kg; otherwise use input_kg. This avoids adding every processing stage, but repeated independent visits of one batch to one facility are collapsed. current_intake_kg is not the analytical intake source.'],
  ['Facility processed mass', 'Completed verified transfers for batches attributed to their latest recorded recovery facility', 'Attributed once per batch destination facility, not every facility visited. It includes all completed outcomes, not only Recycling, despite some UI wording.'],
  ['Utilization / network utilization', 'Facility intake / prorated capacity; network = total intake / total capacity', 'Weighted by capacity, not average of facility percentages. Not historical calendar throughput utilization, because intake is selected by batch cohort. Values above 100 remain visible.'],
  ['Processing time', 'Fixed 2.4 days in dashboard builder', 'Placeholder, not calculated from received/completed timestamps. Aggregate facility groups hide this value.'],
  ['Regional mass / recovery gap', 'Group selected batches by location.region, then use identical mass formulas', 'Recycling is assigned to batch origin region, not necessarily the recycler/facility region. Gap = max(0, declared - reused - recycled). Regional masses should reconcile to platform mass.'],
  ['Collection points / recyclers on map', 'Collection points = active/non-inactive facility rows of type Collection point in batch region; recyclers = distinct transfer recipients of Recycler role per origin region', 'Collection-point counts are registry counts, not counts of physical collection events. Recycler involvements can recur across regions.'],
  ['Map locations and boundaries', 'Bundled Natural Earth country geography; regional-anchors.json; Leaflet', 'Pins indicate reference regional locations, not live GPS, exact participant addresses, routes or regional boundary polygons. Unrecognized region names can appear in totals without a pin.'],
  ['Regional share percentage', 'Selected regional metric / sum of same metric across filtered regions', 'Collection, Recycling and Recovery gap toggles change this denominator. A map selection only highlights/locates a region; the global Region filter controls the analytics cohort.'],
], [23, 40, 37]);

h('4.5 Engagement Barter and Diagnostic Views', 2);
table(['Information', 'Current source and formula', 'Mobile matching rule'], [
  ['Monthly active users', 'Sum system_interactions.properties.count for event_name active_users in the final selected Manila calendar month', 'Summary rows must describe disjoint user populations if summed. Not COUNT(DISTINCT user_id), not users table size, and not sessions table count. Missing final-month summary is unavailable.'],
  ['Sessions and average duration', 'Sum count for sessions; duration = sum(averageSessionMinutes x count) / sum(count)', 'Send count and weighted-average inputs in properties with region/city. Raw event rows without count contribute zero; no automatic session-to-engagement rollup exists.'],
  ['Waste submissions / barter actions / exports', 'Sum properties.count for waste_submissions, barter_actions and report_exports', 'Operational actions and report.exported audit logs do not automatically populate these summaries. Mobile and web need an agreed instrumentation/aggregation writer.'],
  ['Engagement filter scope', 'occurred_at reporting window, properties.region/city and actor scope', 'Material, pathway, weight, facility and other batch-specific filters are not applied to these summaries. Do not claim every global filter affects engagement.'],
  ['Barter metrics returned by API', 'Listings for selected batches; matches = all linked proposal rows; validated = transfer status Validated or Completed; completed = Completed transfers; rewards = linked Earned ledger points', 'These are not an exclusive funnel and are not filtered to transfer_type barter. Counts use batch-cohort relationships, not each listing/offer/reward creation date.'],
  ['Barter Activity presentation', 'BarterActivity.tsx exists; barterMetrics returned by analytics', 'Component is not mounted in the current DashboardApp page tree. Treat this as available code/API data, not an active standalone dashboard page.'],
  ['Diagnostic analytics', 'Same operational diversion rate, transaction completion, category recovery, facility utilization and charts', 'No additional model or independent dataset. Aggregate-only users have empty detailed transactions; some diagnostic zero/empty displays require careful interpretation.'],
  ['Rules-based listing match score', 'API matchScore: base 20 + configured category/pathway/region/condition/quantity weights, capped at 100; candidates >=35', 'Optional mobile/API recommendation logic, not predictive category probability, not a trained model and not the barterMetrics.matches count.'],
], [25, 41, 34]);

h('4.6 Governance Quality Reports and Administration', 2);
table(['Module / information', 'Actual origin', 'How it is maintained'], [
  ['Data quality findings', 'Computed from scoped batches/transfers and active configuration; not read from data_quality_issues', 'Estimated mass warning; Reserved >7 days warning; discrepancy threshold critical; Completed with null validation weight critical. Findings may overlap on the same material.'],
  ['Validation coverage', 'Verified batch count / selected unique batch count', 'Count-based percentage, not verified kilograms / declared kilograms. Batch evidence state must match mobile measurements.'],
  ['Discrepancy threshold', 'configurations.value.discrepancyThresholdPercent, default 5', 'Critical when abs(discrepancy)/handover mass >= threshold, agreed mass as fallback. Compared using unrounded values.'],
  ['Governance and policy readiness', 'Current role/scope; configuration.methodologyVersion; fixed server policy text', 'Methodology/approval caveats are not dynamically read from methodologies, nor proof of statutory compliance.'],
  ['Material Flow Summary report', 'Same cohort and mass aggregation as charts, grouped by region/material plus TOTAL', 'Exports include timeframe, filters, scope, generation timestamp, unit and definitions. CSV/print use full report rows, not current UI pagination.'],
  ['Data Quality Summary report', 'Same computed quality rules as Data Quality page', 'Contains evidence counts, threshold and grouped findings; total findings do not mean unique affected batches.'],
  ['Organization Participation report', 'organizations + users + source batches and linked transfers', 'Counts participating organizations; source declarations and completed verified receipts are distinct roles. Aggregate-only exports group by region/type and omit identifying names.'],
  ['Environmental Methodology Status report', 'Configuration version + operational mass; environmental fields not calculated', 'It reports readiness and measured inputs, not invented CO2e/water savings.'],
  ['Report audit / history', 'activity_logs action report.exported for successful export requests', 'report_exports table is not populated by this report route. Preview is not an export audit. system_interactions export summaries are a different source.'],
  ['User account management', 'users + Supabase Auth + auth_account_security; users API', 'Admin invitations/approval/role/scope/status are authoritative. Mobile profile edits must not overwrite institutional role, scope, or verification.'],
  ['Organization and facility administration', 'organizations and facilities through role-checked management API', 'Administrative edits save audit records. They change master data and can affect later analytics; they do not manufacture operational measurements.'],
  ['My Profile and sessions', 'Current users record; profile JSON; sessions metadata', 'Profile fields are user-entered/assigned, not usage metrics. Supabase credentials and hashed refresh tokens are not exposed as dashboard information.'],
  ['Settings and reference data', 'Active configurations row with key platform; value JSON', 'Taxonomies, discrepancy threshold, reward rate, matching weights and methodology version. UI reward rate per ton converts to stored credits per kg.'],
  ['Audit trail', 'activity_logs actor_id, action, entity_type/id, details, occurred_at', 'API actions append audit evidence; aggregate-only responses redact details. Do not use logs as a second material ledger.'],
  ['Public homepage / partner logos', 'Static publicContent.ts, local image assets, approved external links', 'Not a live data feed, partner database export or source of dashboard KPIs. No protected operational records are requested by the homepage.'],
], [25, 37, 38]);

page();
h('5 Predictive Analytics Data Flow');
p('Advanced Analytics > Predictive is a separate proof of concept. Runtime imports syntheticDataset from the deterministic generator in server/analytics/synthetic.ts; it does not read observations.csv on every request and does not query mobile operational tables. The CSV, manifest, evaluation and dictionary are reproducible exports of that generator. Editing the CSV alone will not change runtime forecasts. [S17-S19, S27]');
table(['Output / input', 'Origin and computation'], [
  ['Training data', 'Seed 20261016; 9,600 generated linked declaration/collection/offer-response observations; 80 records per week across four regions and six categories. No real participant identities.'],
  ['Historical window', '120 complete Monday-Sunday UTC weeks from 24 June 2024 through 11 October 2026. Four forecast weeks start 12, 19, 26 October and 2 November 2026. Fixed snapshot, not next four weeks relative to each page visit.'],
  ['Partition', '84 training weeks / 6,720 records; 18 validation weeks / 1,440 records; 18 test weeks / 1,440 records, chronologically 70/15/15. 9,600 records aggregate to 120 weekly time points.'],
  ['Weekly collection forecast', 'Sum collectedKg per week; compare last value, trailing 8-week mean, trailing 26-week OLS trend and 52-week seasonal naive. Lowest validation MAE chooses the method. Predicted collection is constrained not to exceed declared mass.'],
  ['Projected textile waste', 'Forecast weekly declaredKg using the same baseline comparison. Means projected platform-declared mass, not all textile waste in the Philippines or a validated national forecast.'],
  ['Four-week totals', 'Sum four weekly forecasts separately for declared and collected mass. These are not additional independent masses; no total confidence interval is claimed.'],
  ['Weekly uncertainty bands', 'Per-horizon 80th percentile absolute validation errors; nominal empirical ranges with actual test coverage reported. Not guaranteed 80% confidence.'],
  ['MAE / WAPE / bias / coverage', 'MAE = sum absolute errors / predictions; WAPE = sum absolute errors / sum observed mass; bias = mean(predicted - observed); coverage = held-out observations inside displayed ranges / observations.'],
  ['Recycler selection tendency', 'Category-conditioned Beta(1,1) smoothed probability = (selected offers + 1)/(offered observations + 2), using validation-selected 8/13/26/52-week recency. Not individual recycler prediction or a distribution that sums to 100%.'],
  ['Actual selected share', 'Selected observations in category / all selected observations in chosen window. Different denominator from category selection probability. Selection is not proof of receipt or recycling.'],
  ['Selection evaluation', 'Log loss and Brier score on held-out responses, compared with a category-blind pooled baseline. Lower error is better; synthetic success does not establish real-world accuracy.'],
  ['Scope gates', 'At least 600 observations and 104 active weeks per selected region/material scope. Region permissions are enforced. Insufficient scopes return no prediction; these are PoC heuristics, not approved research sufficiency thresholds.'],
  ['Filter and export behavior', 'Dedicated region/material/history controls, not global operational date filters. History selector changes displayed history only. Export requires separate permission and includes only permitted synthetic rows. Model runs cache in process; no model_runs writes.'],
], [28, 72]);
p('Future live-model mapping is a separate task: declaration target from unique batch declarations at registration time; collection target from deduplicated Collection evidence at actual collection time; selection target from eligible resolved proposals, including non-selected outcomes and known decision times. Preserve observation timing and avoid using final outcome fields as predictors available before the decision. First choose whether the live target is a calendar-event series or a registration-cohort series; the current operational charts and synthetic weekly model use different time concepts.');

h('6 Exact Mobile to Web Field Mapping');
p('Database column names are the shared contract. The web aliases below are internal/API names, not new database columns. Mobile can keep its own UI names if its adapter consistently translates them. Do not create an offers table or write camelCase dashboard payloads directly into snake_case PostgreSQL tables. [S03-S05]');
const mappingGroups: Array<[string, string[][]]> = [
  ['Identity and institution', [
    ['users.id / auth_user_id', 'id / authUserId', 'Business profile ID / Supabase Auth UUID bridge. Foreign keys use the correct namespace.'],
    ['users.name / email / role', 'fullName / email / role', 'Identity display and authorization role. stakeholder alone does not grant access.'],
    ['users.organization_id / organization', 'organizationId / organization', 'Canonical institutional ID / display label.'],
    ['users.account_status / verification_status', 'accountStatus / verification', 'Lowercase persisted states decoded for UI. See normalization caveats.'],
    ['users.scope.organization_ids, facility_ids, regions, can_export, aggregate_only', 'scope.organizationIds, facilityIds, regions, canExport, aggregateOnly', 'Administrator-controlled JSON access boundaries; preserve existing values in mobile updates.'],
    ['users.profile.age_group, organization_size, production_volume_kg, recycling_practices, accepted_textiles, sustainability_interests', 'profile.ageGroup, organizationSize, productionVolumeKg, recyclingPractices, acceptedTextiles, sustainabilityInterests', 'Self-reported profile information; production_volume_kg is not generated-waste KPI input.'],
    ['users.trust_placeholder / created_at', 'trustPlaceholder / joinedAt', 'Demonstration score / account creation timestamp.'],
    ['organizations.id, name, type, record_label, verification_status, status, city, region', 'id, name, type, recordLabel, verification, status, city, region', 'Institution master record. service_areas -> serviceAreas; accepted_materials -> acceptedMaterials; contact_email -> contactEmail.'],
  ]],
  ['Materials and listings', [
    ['material_batches.id / source_user_id / source_organization_id', 'id / sourceUserId / sourceOrganizationId', 'Stable material identity and original provenance.'],
    ['material_category / waste_source / waste_form / condition', 'materialCategory / wasteSource / wasteForm / condition', 'Exact taxonomy values shared by both apps.'],
    ['intended_pathway / final_pathway', 'circularPathway', 'Decoder prefers final_pathway when non-null. Do not confuse intended Recycling with completed Recycling.'],
    ['declared_weight_kg / current_weight_kg / weight_status', 'declaredWeightKg / currentWeightKg / weightStatus', 'Original declaration / latest batch state / Estimated, Measured or Verified.'],
    ['location.city / location.region', 'city / region', 'Nested batch JSON, not top-level batch city/region columns.'],
    ['current_status / current_custodian_id / archived_at', 'currentStatus / currentCustodianId / archivedAt', 'Custody and archival; analytics exclude Archived.'],
    ['secondary_quantity / secondary_unit', 'secondaryQuantity / secondaryUnit', 'Optional pieces/meters/bags/bales; never auto-convert into kg.'],
    ['listings.batch_id / owner_id / owner_organization_id / owner_name', 'batchId / ownerId / ownerOrganizationId / ownerName', 'Same batch, publishing owner and institution.'],
    ['listings.category / condition / pathway / looking_for', 'textileType / quality / circularPathway / exchangeFor', 'looking_for array becomes semicolon-separated display string.'],
    ['listings.weight_kg / available_weight_kg / reserved_kg', 'quantityKg; no independent reserved quantity in listing view', 'weight_kg takes precedence when present. Agree whether it means listed or currently available mass.'],
    ['listings.weight_status / reward_points / is_demo / status', 'weightStatus / rewardCredits / isDemo / status', 'Integer points, explicit demo flag and canonical state translation.'],
    ['listings.media', 'Not exposed by current BarterListing decoder', 'Stored mobile images are not automatically a web listing image gallery. Preserve JSON/media references during updates.'],
  ]],
  ['Offers transfers and evidence', [
    ['match_requests.id / listing_id / requester_id / provider_id', 'offer.id / listingId / recipientId / providerId', 'Requester is recipient; offer persistence uses match_requests.'],
    ['requested_kg / incentive_points / status / terms', 'quantityKg / offeredCredits / status / terms', 'Proposal amount, proposed non-cash points and decision state.'],
    ['transfers.batch_id / listing_id / match_request_id', 'batchId / listingId / offerId', 'Connect all stages to original canonical records.'],
    ['transfers.provider_id / recipient_id / agreed_weight_kg', 'providerId / recipientId / agreedWeightKg', 'Agreement participants and amount, not receipt weight.'],
    ['transfers.circular_outcome / discrepancy_kg / discrepancy_reason', 'circularOutcome / discrepancyKg / discrepancyReason', 'Final pathway and documented signed variance.'],
    ['transfers.pending_reward_points / reward_issued_at', 'pendingRewardCredits / rewardIssuedAt', 'Expected points and issuance marker; reconcile to reward_ledger.'],
    ['measurements.transfer_id + stage handover / receipt / validation + weight_kg', 'handoverWeightKg / receiptWeightKg / verifiedWeightKg', 'Latest measured_at per stage supplies each transfer column.'],
    ['measurements.batch_id, weight_status, method, recorded_by, verified_by, measured_at, note', 'batchId, status, method, recordedBy, verifiedBy, timestamp, note', 'Measurement evidence and accountable actors.'],
    ['flow_events.transfer_id, stage, sequence, actor_id/name, occurred_at, event_status, measurement_id', 'transfer.events type/order/actorId/actorName/timestamp/status/measurementId', 'Structured timeline stored separately, enriched into transfer API response.'],
  ]],
  ['Recovery facilities rewards and engagement', [
    ['recovery_records.batch_id / transfer_id / facility_id / organization_id', 'batchId / transferId / facilityId / organizationId', 'Link source material, transfer and processing institution.'],
    ['recovery_records.stage / input_kg / output_kg / rejected_kg', 'stage / inputWeightKg / outputWeightKg / residualWeightKg', 'Collection/Sorting/Processing/Recovery/Rejection balance. loss_kg exists but is not separately surfaced by current decoder.'],
    ['recovery_records.status / actor_id / validated_by / created_at', 'status / recordedBy / validatedBy / timestamp', 'Recovery analytics use created_at, not a separate event-time field. Preserve meaning for backdated/offline entry.'],
    ['facilities.categories / service_areas / monthly_capacity_kg / current_intake_kg', 'acceptedMaterials / serviceAreas / monthlyCapacityKg / currentIntakeKg', 'Registry configuration; analytics recompute intake from recovery records.'],
    ['reward_ledger.user_id / transfer_id / points / entry_type / title', 'walletEntries.userId / transferId / credits / type / description', 'Ledger source; wallet_accounts balance is not current dashboard reward source.'],
    ['system_interactions.event_name / occurred_at / client', 'eventName / occurredAt / client', 'Exact summary event vocabulary; client is web or mobile.'],
    ['system_interactions.properties.count, averageSessionMinutes, region, city, synthetic', 'properties with the same keys', 'CamelCase averageSessionMinutes is intentional inside JSON. Counts and geography must be present.'],
    ['activity_logs.actor_id / action / entity_type / entity_id / details / occurred_at', 'actorId / action / entityType / entityId / details / timestamp', 'Audit evidence; not system_interactions or physical-flow counts.'],
    ['configurations.key = platform / value', 'configuration.id = platform / typed rules', 'Database id commonly CFG-platform-v1. JSON value keys remain camelCase; do not query the business key as a literal row ID without the adapter.'],
  ]],
];
for (const [heading, rows] of mappingGroups) { h(`6.${mappingGroups.findIndex(item => item[0] === heading) + 1} ${heading}`, 2); table(['Supabase column', 'Web alias', 'Meaning / matching rule'], rows, [36, 29, 35]); }

h('7 Status and Lifecycle Contract');
table(['Entity', 'Persisted value', 'Web interpretation'], [
  ['Listing', 'available / matched / reserved / completed', 'Open / Matched / Reserved / Completed'],
  ['Listing', 'draft / closed / archived', 'All display as Closed; finer mobile states are not distinguished.'],
  ['Offer', 'pending / revised / accepted / rejected / withdrawn / expired', 'Pending / Pending / Accepted / Declined / Withdrawn / Declined'],
  ['Transfer', 'reserved / in_progress', 'Reserved'],
  ['Transfer', 'handed_over', 'Handed over; analytic transaction status In transit'],
  ['Transfer', 'collected / received / processing', 'Received; analytic transaction status In sorting'],
  ['Transfer', 'validated / completed', 'Validated / Completed; analytics maps Validated to Pending validation until completed'],
  ['Transfer', 'cancelled / rejected / disputed', 'Cancelled / Rejected / Disputed; Rejected and Disputed analytic rows are Flagged'],
  ['Batch', 'reused / upcycled / recycled / recovered', 'Recovered; circularPathway carries the detailed outcome'],
  ['Measurement', 'declaration / listing; handover; receipt / collection; validation', 'Declaration; Handover; Receipt; Validation'],
  ['Measurement', 'processing_input / recovery_output / rejection / loss', 'Recovery in measurement history; not separate analytic outcome totals'],
  ['Recovery', 'recorded / validated / flagged / reversed', 'Recorded / Validated / Flagged / Reversed; reversed excluded from analytics'],
  ['Account verification', 'verified; pending / rejected / suspended', 'Demo verified; all remaining values currently Pending demo review'],
], [22, 35, 43]);
p('Use the exact enum spelling and case from the PostgreSQL contract. Weight evidence is Estimated / Measured / Verified with capitals; recovery stage is Collection / Sorting / Processing / Recovery / Rejection; transfer status is lowercase. Unknown aliases are not normalized reliably. [S04-S05]');
p('Normal governed transfer sequence: accepted proposal -> Reserved -> handover measurement/event -> Handed over -> receipt measurement/event and variance -> Received -> validation measurement/event -> Validated -> confirmed outcome and completion event -> Completed -> eligible reward ledger entry. Cancellation, rejection and dispute are explicit exceptions, not silent row deletion. [S01, S11]');
p('A completed database status is not sufficient evidence by itself. Current API workflow creates the supporting records, but externally written rows can bypass that workflow. The analytic decoder chooses the latest validation-stage measurement without independently proving verifier authority, measurement status or supersession. Both developers must enforce those conditions in the authorized write path before treating results as verified.');

page();
h('8 Time Filters Units and Refresh');
table(['Concern', 'Current rule'], [
  ['Operational reporting clock', 'Asia/Manila calendar dates. Last 30/90 days include today through generation time; custom dates are inclusive; future/reversed/invalid ranges are rejected. Previous comparison is the immediately preceding equal elapsed interval, except YTD uses prior year to equivalent Manila date/time.'],
  ['Cohort denominator', 'Batch created_at selects the material cohort. Linked latest outcomes through generation time are used even if completion occurs after the selected historical window. Do not compare a mobile completion-month chart with this registration-month chart without reconciling time basis.'],
  ['Global material filters', 'Region/city, textile category, waste source, pathway, weight status, stakeholder role, producer/recycler search, organization, facility and transaction filters select related batches/transfers. Some filters require related user/recovery records to exist. Waste form is stored and displayed, but is not a global filter today.'],
  ['Filter exceptions', 'Engagement uses reporting dates and region/city/access scope only. Listing oversight has its own local filters and all-time listing API load. Offer tab uses its own offer load. Predictive has dedicated fixed-snapshot filters. Administrative master lists are not automatically cohort-filtered.'],
  ['Canonical mass', 'Persist and transmit kilograms in fields ending _kg or Kg. Display metric tons: 1 t = 1,000 kg. A 900 kg record displays as 0.9 t. Never save 0.9 into weight_kg when the intended material is 900 kg.'],
  ['Other units and rounding', 'Pieces/meters/bags/bales remain secondary evidence with no automatic kg conversion. General percentages round to one decimal. Aggregate raw weights before rounding; exports retain up to six decimal places in tons.'],
  ['Server caches', 'Dashboard source snapshot defaults to 15 seconds; calculated dashboard response defaults to 30 seconds, with actor/filter-aware keys. Successful recognized web API mutations invalidate both. External/mobile direct writes do not trigger this in-process invalidation.'],
  ['Client cache', 'Dashboard cache is session-scoped with a 30-second freshness test when a load is triggered. Visited pages remain mounted. Same-tab mutations emit baliktela:records-changed and invalidate relevant data; sign-out clears private caches.'],
  ['Important freshness limitation', 'A TTL is not a timer that refreshes the visible page. No operational real-time subscription or universal periodic data refresh is implemented. A mounted page can remain stale indefinitely until reload, applicable navigation/filter change, midnight key change, or local mutation triggers a fetch.'],
  ['Authentication check', 'The 15-second foreground session check refreshes authorization visibility, not all dashboard datasets. Do not describe it as a 15-second mobile synchronization service.'],
  ['Reliable comparison procedure', 'Wait for server cache expiration or use an authorized invalidation mechanism, reload/requery, and compare identical account scope, filters, batch cohort, unit and as-of timestamp. TTLs are not a guaranteed maximum synchronization latency.'],
], [27, 73]);

h('9 Worked Reconciliation Example');
p('Illustrative fixture only, not a production record. One batch declares 1,000 kg, has validated Collection output 900 kg and Sorting output 850 kg, and a completed 300 kg reuse transfer with a validated final Recovery output. Completion without that final outcome does not prove recycling.');
const exampleBatch = { id: 'EXAMPLE-BATCH', declaredWeightKg: 1000 } as MaterialBatchRecord;
const exampleTransfers = [
  { id: 'EXAMPLE-REUSE', batchId: exampleBatch.id, listingId: 'EXAMPLE-LISTING', providerId: 'EXAMPLE-SOURCE', status: 'Completed', circularOutcome: 'Reuse', verifiedWeightKg: 300 },
] as TransferRecord[];
const exampleRecord: RecoveryRecord = { id: 'EXAMPLE-COLLECTION', transferId: 'EXAMPLE-REUSE', batchId: exampleBatch.id, facilityId: 'EXAMPLE-FACILITY', organizationId: 'EXAMPLE-ORG', stage: 'Collection', inputWeightKg: 1000, outputWeightKg: 900, residualWeightKg: 100, outcome: null, status: 'Validated', recordedBy: 'EXAMPLE-RECORDER', validatedBy: 'EXAMPLE-VERIFIER', timestamp: '2026-09-21T00:00:00Z', note: 'Illustrative only', isDemo: true };
const example = aggregate([exampleBatch], exampleTransfers, [
  exampleRecord,
  { ...exampleRecord, id: 'EXAMPLE-SORTING', stage: 'Sorting', inputWeightKg: 900, outputWeightKg: 850, residualWeightKg: 50 },
  { ...exampleRecord, id: 'EXAMPLE-RECOVERY', stage: 'Recovery', inputWeightKg: 300, outputWeightKg: 300, residualWeightKg: 0, outcome: 'Reuse' },
]);
assert.equal(example.generatedKg, 1000);
assert.equal(example.transactionCount, 1);
assert.equal(example.diversionRate, 33.3);
assert.equal(example.sortingYield, 35.3);
table(['Displayed information', 'Expected result', 'Why'], [
  ['Declared / generated', formatMass(example.generatedKg), '1,000 kg counted once, not once per transfer'],
  ['Collected / sorted', `${formatMass(example.collectedKg)} / ${formatMass(example.sortedKg)}`, 'Different recovery stages, not additive material'],
  ['Confirmed reuse / recycling', `${formatMass(example.reusedKg)} / Pending evidence`, 'Validated final outputs, not pathway intentions'],
  ['Confirmed recovery share', '33.3%', '300 / 900 x 100; collected-cohort denominator'],
  ['Matched sorting yield', '35.3%', '300 / 850 x 100 on the same evidenced batch'],
  ['Collected outcome unconfirmed', '0.6 t', '900 - 300; not a measured disposal or landfill figure'],
  ['Facility utilization', '45%', '900 intake / 2,000 prorated capacity x 100'],
  ['Completed transaction count', '1', 'One transfer, not a sum of overlapping stages'],
], [32, 20, 48]);
p('Stage totals overlap and must not be added. Multi-transfer final outcomes on a single batch require explicit portion allocation before unique diversion can be established; ambiguous outputs are withheld. A missing denominator or measurement must not be disguised as a verified zero. This example supersedes older transfer-based proxy formulas in the original report.');

h('10 Tables That Do Not Automatically Feed Analytics');
p('The canonical migration defines 36 public application tables. Table existence does not mean a current page reads or writes it. The current dashboard snapshot reads 11 domain datasets plus enriched flow_events; authentication/administration use additional tables. [S03, S05, S06, S13]');
table(['Table or group', 'Current web consumption / integration implication'], [
  ['collection_receipts', 'Not read by dashboard analytics. To affect collection totals, map receipt evidence into the agreed Collection recovery record and relevant measurements/events without counting the same mass twice.'],
  ['collection_events / event_registrations', 'Not joined into current regional activity, stakeholder participation or engagement totals. Event participation dashboard integration remains a separate task.'],
  ['facility_assignments', 'Not used as the source of current users.scope access arrays. Assignment rows alone do not grant existing web permissions.'],
  ['conversations / messages', 'Shared API operations exist; no current primary institutional dashboard messaging workspace is mounted. Message counts do not automatically become engagement totals.'],
  ['favorites / notifications', 'Not current analytical inputs. Mobile actions here do not change reuse/recycling mass.'],
  ['wallet_accounts / reward_rules', 'Not the current dashboard reward source/rate source. Web reads reward_ledger and platform configuration; coordinate rule versions and balances before treating mobile wallet totals as equivalent.'],
  ['reports / support_tickets', 'reports means user-submitted moderation reports, not the analytical report catalog. These tables do not currently populate the web Reports page or a mounted support queue.'],
  ['data_quality_issues', 'Current Data Quality findings are generated on demand; persistent issue acknowledgments/resolution are not sourced from this table.'],
  ['methodologies / model_runs', 'Current governance uses configuration/fixed text; predictive models run from generated data in memory. These tables are not an active model registry or research approval workflow.'],
  ['report_exports', 'Current CSV/print routes append activity_logs, not export-job records in this table. Do not look here for a complete current export history.'],
  ['consent_history', 'Defined in contract; current surfaced consent values mainly come from users/privacy flags and profile timing. Full versioned consent-history consumption is not a current dashboard module.'],
  ['Supabase Storage media', 'Referenced listing media can remain mobile-owned, but current oversight decoder does not render them. No storage bucket name or signed-URL contract can be inferred from this web decoder alone.'],
], [30, 70]);

page();
h('11 Mobile Developer Handoff and Acceptance');
h('11.1 Agree on the write boundary', 2);
p('Preferred integration is one shared governed operational API so authorization, transitions, verification, rewards, audits and atomic writes have one owner. If mobile already uses separate RPCs/backend endpoints, retain that architecture only after both teams demonstrate the same canonical table contract and invariants. Do not call the service-role-only dashboard snapshot or management RPC directly from an untrusted client. Never place a Supabase secret/service-role key in either frontend.');
p('Supabase identity and web application sessions are different token layers. The web API issues its own access JWT and database-backed application session after identity verification. A native Supabase access token is not automatically interchangeable with that JWT. Confirm the mobile authentication bridge or use the supported API login flow; a common Auth project alone does not prove API interoperability. [S01, S07, S26]');

h('11.2 Minimum handoff packet', 2);
table(['Mobile developer supplies', 'Web team checks'], [
  ['Supabase project/environment and actual table/RPC contract; no secrets in shared documents', 'Both apps target the same intended project/schema, not separate local/Atlas/production environments.'],
  ['One sanitized user/profile and source organization/facility mapping', 'public.users.id vs auth.users.id; role/verification/account status; preserved organization and region access.'],
  ['One linked batch -> listing -> proposal -> transfer record set', 'IDs match exactly; requester/provider direction correct; no duplicated source batch for relisted material.'],
  ['Handover, receipt and validation measurements and flow events', 'Correct transfer_id/stage, measured_at/occurred_at, recorder/verifier, weights, ordering and discrepancy.'],
  ['Collection / Sorting / Recovery stage balance records', 'Recovery stages and created_at semantics match the KPI reader; linked facility exists; reversed corrections do not duplicate outputs.'],
  ['Reward event and idempotency policy', 'One issuance per eligible completion, points units/rate version, reversal/net balance meaning agreed.'],
  ['Telemetry dictionary and sample summary rows', 'Exact event names, properties.count, averageSessionMinutes, disjoint MAU populations, region/city and privacy handling.'],
  ['Geographic and taxonomy vocabulary', 'Use one standard string for each region/material. NCR and Metro Manila are currently different filter values; no alias conversion is implemented.'],
  ['Client retry/offline conflict rules', 'Idempotent writes, preserved event time and canonical IDs, atomic stage updates, conflict responses and final-record immutability.'],
], [48, 52]);

h('11.3 Controlled end to end test', 2);
table(['Test', 'Acceptance evidence'], [
  ['Identity and visibility', 'Create a controlled synthetic participant in a staging/shared test scope. Confirm one profile bridge and correct institutional visibility; unrelated organization and aggregate-only viewers must not receive individual history.'],
  ['Initial material entry', 'Create one known mobile batch/listing with a unique test namespace. Web listing oversight and material registry show the same batch ID, taxonomy and kilogram-equivalent amount.'],
  ['Proposal and acceptance', 'Create a proposal, accept it once, retry safely. Exactly one reservation/transfer is produced, with provider/recipient and agreement preserved.'],
  ['Physical lifecycle', 'Record handover, receipt and validation; confirm web stage columns equal mobile evidence and original declaration remains unchanged. Missing or unauthorized validation must not masquerade as verified.'],
  ['Collection and sorting', 'Record explicit recovery balances; prove collection/sorting totals change once and regional/category totals reconcile to platform values. A receipt-only entry must be recognized as insufficient for current collection KPI.'],
  ['Outcome and rewards', 'Complete with confirmed outcome; retry completion; verify no double-counted mass, no duplicate points and complete actor/timestamp event history.'],
  ['Filters and reports', 'Use identical Manila date cohort, region/material and account scope. Match KPI, chart, regional/category sums and full CSV/print report at a controlled as-of timestamp.'],
  ['Corrections and exceptions', 'Reverse/correct recovery with preserved original evidence; dispute/cancel unfinished transfer; ensure final records cannot be silently rewritten and quality findings remain explainable.'],
  ['Freshness and access changes', 'Trigger actual re-fetch after server expiry and compare data; separately change role/scope to verify forced reauthentication. These are distinct acceptance tests.'],
  ['Cleanup', 'Remove only disposable test records where policy permits, or preserve an agreed labeled fixture. Never run seeds, disable RLS, or modify unrelated records just to make tests pass.'],
], [27, 73]);
p('Existing scripts/test-mobile-sync.ts is not sufficient proof of current mobile integration: it writes only a temporary batch, measurement and listing, uses a retired demo login, and uses legacy example taxonomy/location values. It does not validate offers, transfer completion, recovery, rewards, scopes or end-to-end analytics. Update that isolated test before running it against the shared project. No live synchronization test was executed for this report. [S21]');

h('12 Reconciliation Work Still Required');
p('The following are current interpretation or integration gaps, not changes made by this report. They should be agreed jointly before presenting mobile activity as complete operational evidence.');
table(['Priority', 'Gap and required agreement'], [
  ['High', 'Receipt/collection mismatch: collection_receipts and receipt measurements are not collected-mass inputs. Agree and implement the canonical conversion into deduplicated Collection recovery evidence.'],
  ['High', 'Outcome verification: completed status plus a validation-stage row is accepted by the reader; verifier authority, Verified evidence state, supersession and recovery validation must be enforced in the write boundary. Flagged/Recorded recovery rows currently still enter stage totals.'],
  ['High', 'Partial material and repeated stages: analytics sum all qualifying recovery rows and completed outcomes; no universal repeated-stage/split/consolidation deduplication is inferred. Agree on unique physical allocations, correction reversals and child-batch lineage before multi-leg flows.'],
  ['High', 'Telemetry: no automatic operational-action or session rollup to system_interactions exists. Define count aggregation and distinct-user de-duplication; raw mobile clicks without count will not populate existing engagement cards.'],
  ['High', 'Freshness: no cross-client push invalidation/periodic operational refresh. Add an approved re-fetch trigger or governed real-time notification if near-live mobile visibility is required.'],
  ['High', 'Authorization equivalence: a shared Auth account does not guarantee shared API token acceptance or safe mobile RPC permissions. Confirm the mobile write policy and current deployed RLS/RPC grants without exposing service secrets.'],
  ['Medium', 'Geographic names and origin semantics: standardize NCR/Metro Manila and other aliases; agree that current mass is attributed to batch origin, not GPS or facility destination.'],
  ['Medium', 'Demo provenance: dashboard builder hardcodes isDemo=true for transaction/stakeholder/facility analytical views and several UI labels always say sample/demo. Mixed synthetic and operational records are not globally segregated by an analytics demo filter. Preserve provenance and add appropriate segregation before real reporting.'],
  ['Medium', 'Facility processing time is fixed 2.4 days; processed mass includes every completed outcome; status is stored. Replace/qualify these before claiming measured recycling throughput or lead times.'],
  ['Medium', 'Outcome terminology differs: program diversion includes selected reuse/recycling pathways, while operational verified completion includes all completed outcomes. Diverted from Landfill is an operational proxy, not approved impact.'],
  ['Medium', 'Active participants are region-level involvement counts, not unique platform users; verification aliases collapse rejected/suspended states; several empty-rate displays use zero. Current user roles classify historical participation, so a role change can also alter old cohort groupings. Clarify these rather than claiming historical role snapshots.'],
  ['Medium', 'Barter Activity code/API fields exist but are not mounted in the current dashboard. Matches means proposal rows, and validated/completed/reward metrics are not limited to actual barter. Reward activity is earned points, not a net wallet balance.'],
  ['Medium', 'Research consent and versioned approvals: current analytics do not select cohorts by research_consent and governance does not read approved methodology rows. Agree on consent/ethical-use requirements before real research extraction.'],
  ['Medium', 'Measurement timing/supersession: latest measured_at wins; no automatic tie-breaker or supersedes_measurement_id exclusion in dashboard reads. Recovery timestamp comes from created_at. Coordinate offline/backdated records and corrections.'],
  ['Planned', 'Collection events, persistent quality workflow, support/moderation records, model registry and export-job history have schema definitions but are not complete current dashboard feeds. Prioritize only the required web monitoring uses; mobile implementation remains with its developer.'],
], [16, 84]);

h('13 Source Inventory and Reference Guide');
p('References point to the reviewed repository commit so future changes do not silently change this report\'s evidence. The finalized blueprint in ../Documents/Balik Tela PH Web and Mobile Blueprint.docx establishes the management/analytics versus participation split, traceable stage weights, canonical kg, evidence-state distinction, no double counting and privacy requirements. Source code determines the implemented behavior described above; a blueprint requirement is not proof of implementation.');
for (const [id, label, path, needle] of sources) {
  const source = await readFile(new URL(path, root), 'utf8');
  const line = needle ? source.split('\n').findIndex(value => value.includes(needle)) + 1 : 1;
  assert.ok(line > 0, `Source anchor missing: ${path}`);
  p(`${id} | ${label} | ${path}:${line}`);
}

h('Appendix A Canonical Table Coverage');
const coverage: Record<string, string> = {
  schema_versions: 'Schema contract metadata; not a KPI input.',
  users: 'Identity, profile, approval, role/scope; joins for participation and attribution.',
  auth_account_security: 'Email/password lifecycle; session security; not user engagement.',
  organizations: 'Institution master data, lookup/filtering and participation reports.',
  sessions: 'Revocable application authentication sessions; not current engagement summary source.',
  auth_challenges: 'Single-use account setup/recovery authorization; not analytics.',
  auth_rate_limits: 'Authentication abuse prevention; not public usage statistics.',
  consent_history: 'Defined; no complete current dashboard history reader.',
  facilities: 'Facility master data, capacity and geography; operational/analytical views.',
  facility_assignments: 'Defined; current web authorization uses users.scope arrays.',
  collection_events: 'Defined; not joined into current analytics.',
  event_registrations: 'Defined; not joined into current analytics.',
  material_batches: 'Primary declared material cohort and geographic/category denominator.',
  measurements: 'Stage evidence and latest handover/receipt/validation weights.',
  listings: 'Oversight and listing counts; linked to batches.',
  favorites: 'Defined mobile participation data; not current dashboard input.',
  match_requests: 'Web offers; proposal records and transfer agreement link.',
  transfers: 'Agreement, status, outcome and verified completed mass attribution.',
  flow_events: 'Transfer lifecycle timeline enrichment.',
  collection_receipts: 'Defined receipt source; not directly included in collection KPI.',
  recovery_records: 'Collection/sorting balances, facility attribution and recovery monitoring.',
  conversations: 'Shared API exists; no mounted institutional messaging page.',
  messages: 'Shared API exists; not an engagement rollup input.',
  notifications: 'Defined; not current analytical input.',
  reward_rules: 'Defined; current completion rate is platform configuration.',
  reward_ledger: 'Reward/wallet history and earned credits in analytics.',
  wallet_accounts: 'Defined balance snapshot; not current analytic reward source.',
  reports: 'Moderation submissions, not analytical report definitions.',
  support_tickets: 'Defined; no mounted support-case dashboard reader.',
  activity_logs: 'Administrative/authentication/transaction/export audit trail.',
  configurations: 'Active platform rules, taxonomies and methodology version.',
  data_quality_issues: 'Defined; current quality findings are computed on request.',
  system_interactions: 'Count-summary source for engagement analytics.',
  methodologies: 'Defined; not current governance approval source.',
  model_runs: 'Defined; not current predictive runtime persistence.',
  report_exports: 'Defined; current report exports append activity_logs instead.',
};
assert.equal(DATABASE_COLLECTIONS.length, 36);
assert.equal(Object.keys(coverage).length, DATABASE_COLLECTIONS.length);
table(['Table', 'Current relationship to the web dashboard'], DATABASE_COLLECTIONS.map(item => {
  assert.ok(coverage[item.name], `Missing coverage for ${item.name}`);
  return [item.name, coverage[item.name]];
}), [31, 69]);

h('Appendix B Database Column Names');
p('The following inventory is extracted from the checked-in initial PostgreSQL migration, not inferred from UI labels. Later migrations add authentication functions, session-revocation behavior and transaction RPCs. This inventory is a baseline handoff, not a live information_schema export. The legacy mixed-case passwordHash column is credentials compatibility metadata; use Supabase Auth, never a client-side password table write.');
const sql = await readFile(new URL('supabase/migrations/20261007040000_baliktela_schema_v2.sql', root), 'utf8');
const sqlTables = [...sql.matchAll(/create table if not exists public\."([^"]+)" \(([\s\S]*?)\n\);/g)];
assert.equal(sqlTables.length, 36);
for (const match of sqlTables) {
  const fields = [...match[2].matchAll(/^  "([^"]+)" /gm)].map(item => item[1]).filter(field => field !== '__v');
  h(match[1], 2);
  p(fields.join(', '));
}
p('Integration conclusion: match canonical operational records and evidence first, then compare derived totals using identical definitions. Do not match an unrelated mobile card to a similarly named web card until record grain, stage, unit, period, outcome and access scope are the same.');

const escapeHtml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const lineBorder = { style: BorderStyle.SINGLE, size: 4, color: color.line };
const docParagraph = (text: string, options: Record<string, unknown> = {}) => new Paragraph({
  spacing: { after: 125, line: 260 }, children: [new TextRun({ text, size: 21 })], ...options,
});
function docTable(block: Extract<Block, { kind: 'table' }>) {
  const widths = block.widths ?? block.headers.map(() => 100 / block.headers.length);
  const makeRow = (cells: string[], header: boolean, index: number) => new TableRow({
    tableHeader: header, cantSplit: true,
    children: cells.map((text, cell) => new TableCell({
      width: { size: widths[cell], type: WidthType.PERCENTAGE },
      shading: header ? { type: ShadingType.CLEAR, fill: color.green } : index % 2 === 0 ? { type: ShadingType.CLEAR, fill: 'F6F8F7' } : undefined,
      margins: { top: 100, bottom: 100, left: 110, right: 110 },
      children: [new Paragraph({ spacing: { after: 30, line: 235 }, children: [new TextRun({
        text, size: 18, color: header ? 'FFFFFF' : color.ink, bold: header || cell === 0,
      })] })],
    })),
  });
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: lineBorder, bottom: lineBorder, left: lineBorder, right: lineBorder, insideHorizontal: lineBorder, insideVertical: lineBorder },
    rows: [makeRow(block.headers, true, 0), ...block.rows.map((row, index) => makeRow(row, false, index))],
  });
}
const content: Array<Paragraph | Table> = [
  docParagraph('BALIKTELAPH  /  TECHNICAL HANDOFF', { spacing: { before: 800, after: 400 } }),
  new Paragraph({ children: [new TextRun({ text: title, size: 60, bold: true, color: color.ink })], spacing: { after: 300 } }),
  docParagraph('Information lineage, calculation definitions and mobile integration contract', { spacing: { after: 500 } }),
  docParagraph(`Prepared ${reportDate}`),
  docParagraph(`Reviewed source ${commit.slice(0, 7)}`),
  docParagraph('For the web dashboard team, mobile developer, project administrators and research stakeholders.'),
  docParagraph('Scope: implemented web behavior, clearly separated from synthetic data, placeholders and proposed integration requirements.'),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ text: 'Contents', heading: HeadingLevel.HEADING_1, spacing: { after: 220 } }),
  ...blocks.filter((block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading' && block.level === 1)
    .map(block => docParagraph(block.title, { spacing: { after: 160 } })),
  new Paragraph({ children: [new PageBreak()] }),
];
for (const block of blocks) {
  if (block.kind === 'heading') content.push(new Paragraph({ text: block.title, heading: block.level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, keepNext: true, spacing: { before: block.level === 1 ? 320 : 220, after: 150 } }));
  if (block.kind === 'paragraph') {
    const source = /^S\d+ \|/.test(block.text) ? sources.find(item => block.text.startsWith(`${item[0]} |`)) : undefined;
    if (source) {
      const line = block.text.slice(block.text.lastIndexOf(':') + 1);
      content.push(new Paragraph({ spacing: { after: 100 }, children: [new ExternalHyperlink({
        link: `https://github.com/BalikTela/BalikTela-Web-Dashboard/blob/${commit}/${source[2]}#L${line}`,
        children: [new TextRun({ text: block.text, size: 18, color: color.green, underline: {} })],
      })] }));
    } else content.push(docParagraph(block.text));
  }
  if (block.kind === 'table') { content.push(docTable(block)); content.push(new Paragraph({ spacing: { after: 100 } })); }
  if (block.kind === 'break') content.push(new Paragraph({ children: [new PageBreak()] }));
}
const reportDocument = new Document({
  creator: 'BalikTelaPH Web Development', title, subject: 'Web dashboard data lineage and mobile integration',
  description: `Implementation report based on ${commit}`,
  styles: { default: { document: { run: { font: 'Calibri', size: 21, color: color.ink } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, bold: true, color: color.green } },
      { id: 'Heading2', name: 'heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: color.ink } },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 950, right: 950 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [new TextRun({ text: 'BALIKTELAPH  |  WEB DASHBOARD DATA FLOW', size: 16, color: color.muted })], spacing: { after: 150 } })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${reportDate}  |  Source ${commit.slice(0, 7)}  |  `, size: 16, color: color.muted }), new TextRun({ children: [PageNumber.CURRENT], size: 16 })] })] }) },
    children: content,
  }],
});
const sections = blocks.map(block => {
  if (block.kind === 'heading') return `<h${block.level + 1}>${escapeHtml(block.title)}</h${block.level + 1}>`;
  if (block.kind === 'paragraph') {
    const source = /^S\d+ \|/.test(block.text) ? sources.find(item => block.text.startsWith(`${item[0]} |`)) : undefined;
    if (source) return `<p class="source"><a href="https://github.com/BalikTela/BalikTela-Web-Dashboard/blob/${commit}/${source[2]}#L${block.text.slice(block.text.lastIndexOf(':') + 1)}">${escapeHtml(block.text)}</a></p>`;
    return `<p>${escapeHtml(block.text)}</p>`;
  }
  if (block.kind === 'break') return '<div class="page-break"></div>';
  return `<table><colgroup>${(block.widths ?? block.headers.map(() => 100 / block.headers.length)).map(width => `<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${block.headers.map(cell => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}).join('\n');
const toc = blocks.filter((block): block is Extract<Block, { kind: 'heading' }> => block.kind === 'heading' && block.level === 1).map(block => `<li>${escapeHtml(block.title)}</li>`).join('');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
@page {size:A4;margin:19mm 15mm 20mm}*{box-sizing:border-box}body{font:10pt/1.5 Arial,sans-serif;color:#172a23;margin:0;background:white;font-variant-numeric:tabular-nums}main{max-width:1000px;margin:auto;padding:36px}h1{font-size:34pt;line-height:1.15;margin:30px 0 20px}h2{font-size:18pt;line-height:1.25;color:#22634d;margin:28px 0 14px;break-after:avoid}h3{font-size:12pt;margin:22px 0 12px;break-after:avoid}p{margin:0 0 12px;overflow-wrap:anywhere;orphans:3;widows:3}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 20px;font-size:8.5pt;line-height:1.45}th{text-align:left;background:#22634d;color:white;font-weight:600}th,td{border:1px solid #d9e3dd;padding:9px;vertical-align:top;overflow-wrap:anywhere}td:first-child{font-weight:600}tbody tr:nth-child(even){background:#f6f8f7}tr{break-inside:avoid}thead{display:table-header-group}a{color:#22634d}.source{font-size:9pt}.cover{padding-top:70px;min-height:900px;border-top:5px solid #22634d;break-after:page}.eyebrow{font-size:9pt;color:#22634d;font-weight:bold}.subtitle{font-size:16pt;color:#596b62;max-width:620px}.meta{border-top:1px solid #d9e3dd;margin-top:50px;padding-top:22px;color:#596b62}.contents{break-after:page}.contents li{padding:4px 0}.page-break{break-before:page}@media print{main{padding:0;max-width:none}.cover{min-height:0;height:245mm;padding-top:35mm}.contents{padding-top:10mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}@media(max-width:650px){main{padding:18px}h1{font-size:27pt}table{font-size:8pt}th,td{padding:5px}.cover{min-height:0;padding:30px 0 60px}}
.contents ol{list-style:none;padding-left:0}
</style></head><body><main><section class="cover"><p class="eyebrow">BALIKTELAPH / TECHNICAL HANDOFF</p><h1>${title}</h1><p class="subtitle">Information lineage, calculation definitions and mobile integration contract</p><div class="meta"><p>${reportDate}<br>Reviewed source ${commit.slice(0, 7)}</p><p>For the web dashboard team, mobile developer, project administrators and research stakeholders.</p><p>Scope: implemented web behavior, clearly separated from synthetic data, placeholders and proposed integration requirements.</p></div></section><section class="contents"><h2>Contents</h2><ol>${toc}</ol></section>${sections}</main></body></html>`;
const docxPath = new URL(`docs/${outputName}.docx`, root);
const htmlPath = new URL(`docs/${outputName}.html`, root);
await writeFile(docxPath, await Packer.toBuffer(reportDocument));
await writeFile(htmlPath, html);
if (process.argv.includes('--pdf')) {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    const reportPage = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await reportPage.goto(htmlPath.href);
    await reportPage.emulateMedia({ media: 'print' });
    const overflow = await reportPage.evaluate(() => [...document.querySelectorAll('td, th, p')].filter(element => element.scrollWidth > element.clientWidth + 2).length);
    assert.equal(overflow, 0, 'Report contains horizontally clipped text');
    await reportPage.pdf({ path: fileURLToPath(new URL(`docs/${outputName}.pdf`, root)), format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<div></div>', footerTemplate: `<div style="font:8px Arial;color:#596b62;width:100%;text-align:right;padding:0 15mm">BalikTelaPH | ${reportDate} | <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      margin: { top: '19mm', bottom: '20mm', left: '15mm', right: '15mm' }, preferCSSPageSize: true });
    await reportPage.emulateMedia({ media: 'screen' });
    await reportPage.screenshot({ path: '/tmp/baliktela-data-flow-report-preview.png', fullPage: false });
  } finally { await browser.close(); }
}
console.log(JSON.stringify({ sourceCommit: commit, reportDate, metricsSections: 6, mappingRows: mappingGroups.reduce((sum, item) => sum + item[1].length, 0), canonicalTables: sqlTables.length, sources: sources.length, blocks: blocks.length,
  files: [fileURLToPath(docxPath), fileURLToPath(htmlPath), ...(process.argv.includes('--pdf') ? [fileURLToPath(new URL(`docs/${outputName}.pdf`, root))] : [])], exampleValidated: true }, null, 2));
