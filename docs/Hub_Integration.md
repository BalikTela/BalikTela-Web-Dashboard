# Hub Collection and Disposal Integration

## Current Web Policy: Collection and Disposal (19 October 2026)

This section supersedes the older weighing-oriented role description below.
The older contracts remain documented to explain existing shared records.
**This policy update changes web code only. It applies no shared migration,
does not convert accounts, and does not edit mobile source or business records.**

### Latest Mobile Source Review

Reviewed `baliktelaprogressive-main (1).zip` supplied on 19 October, specifically
`src/components/hub.tsx`, `src/components/hub-disposals.tsx`,
`src/lib/domain.ts` and `supabase/022_hub_disposals.sql`.

The supplied source still exposes **Textile weighing** and its `canWeigh`
predicate for approved Recycler/Hub profiles. Its Hub home also exposes disposal.
Disposal requires a weighed, unreserved listing, supports partial disposal and
updates remaining stock. It does not create an independent physical collection
receipt, establish a recycling output or record a landfill-avoidance destination.
The ZIP alone does not establish which commit is currently deployed on mobile.

### Role and Workflow

1. A Consumer posts textiles. The web treats an own, published Consumer listing
   as **assumed recyclable**, retaining the original recorded condition and pathway.
   This is a business assumption, not technical certification or measured intake.
2. Ordinary direct exchanges remain Consumer/Producer/recipient activity. They do
   not become Hub assignments merely because a textile listing exists.
3. A listing routed `via_hub` references a Hub operator via the existing
   `weighing_hub_id` field. That legacy field name is preserved, not migrated.
4. Physical collection is shown only with linked collection evidence. A validated
   Collection record takes precedence; otherwise one unambiguous current measured
   or verified collection/Hub receipt can establish **recorded Hub collection**.
   It is counted once per batch. Legacy listing-scale readings do not qualify.
5. Disposal is read from the existing `hub_disposals` ledger and linked through
   `listing_id` and `operator_id`. Duplicate IDs count once; future/invalid records
   are excluded. Archived listings retain their disposal history.
6. Disposal, receipt, transfer completion and final reuse/recycling are separate,
   overlapping evidence stages. **Disposal alone is not landfill diversion.**
   Final destination and an approved diversion definition are still required.

### Web Access and Affected Pages

- Approved Hubs have scoped read access to their materials, collection/disposal,
  related historical transfers and profile. They cannot create offers, administer
  exchange transfers, manage processing facilities or record recycling outcomes.
  These restrictions apply in the API, not just navigation.
- Explicit Hub roles and legacy Recycler profiles with Hub metadata, assignment,
  listing-weighing history or disposal activity are recognized without rewriting
  stored roles. Generic `Recycler / Upcycler` metadata alone does not prove Hub
  identity. An ordinary Recycler without Hub evidence retains its existing role.
  A new mobile Recycler signup with no explicit Hub role or activity therefore
  needs administrator clarification, not automatic Hub approval or conversion.
- **Overview:** collection/disposal oversight is separate from the recovery KPIs;
  Hub accounts open a dedicated handling workspace. Recyclable Textiles Received
  uses only validated intake, including Consumer assumptions with disclosed basis.
- **Listings / Material Registry:** retain original mobile stock and statuses;
  explain assumed recyclability without manufacturing collection evidence.
- **Traceability:** retains exchange transfers and authorized historical weights;
  Hub handling and management appear only in Recovery Monitoring.
- **Recovery / Hub Facilities:** Recovery Monitoring hosts operational handling;
  Hub Facilities reports registered Hub capacity, intake and disposal analytics,
  not recycler processing capacity or final recycling output.
- **Stakeholders:** shows actual linked collection/disposal, approval and assignments.
- **Governance / Data Quality / Reports:** distinguish business assumptions,
  collection, final output and disposal. Data Quality checks linked disposal
  weights, operator references, timestamps and reasons.

Hub monitoring uses the dashboard's **batch-registration cohort**, with known
handling history through the current as-of time. This differs from mobile's
disposal-date period selection; equal time filters need not produce equal totals.
Hub recorded collection may include Measured evidence, whereas Overview's official
collection KPI requires the stricter existing validated-intake rules. Unknown
evidence stays unavailable rather than becoming a fabricated zero.

### Hub Intake and Disposal Balances (20 October 2026)

Overview summaries, Recovery Monitoring and attributed Hub Facilities analytics
use the same collection/disposal evidence and balance rules:

- **Textiles Sent to Hubs (current Recovery Monitoring headline):** sum the
  declared weights of unique Consumer-origin batches with a published, non-direct
  Hub-linked listing in the selected handling cohort. Draft/unknown listings,
  remainder listings and non-Consumer submissions do not add to this total.
  Later disposal and archive history do not subtract from it. Batch IDs deduplicate
  multiple listings; original declared mass, not remaining stock, is counted.
  Missing/invalid weights and ambiguous multi-Hub assignments are disclosed and
  excluded, not replaced by disposal, agreed transfer or estimated inventory sums.
  Hub identities remain scoped; aggregate-only views omit record identities.
  This is reported submission mass, not independent proof of physical receipt.
  Physical collection evidence and recovery percentage formulas remain unchanged.
- **Recorded Hub Disposal:** the existing unique disposal-ledger weights,
  including partial disposal and archived batch history.
- **Awaiting Disposal (internal balance / Hub Facilities only):** intake minus recorded disposal and evidenced transfers
  out. The total is published only when every linked batch has a reconciled
  balance and the disposal feed is available. A known empty balance is zero;
  missing intake, invalid disposal, ambiguous transfer evidence, multiple Hub
  allocations or outflows exceeding intake leave the balance unavailable.
  Recovery Monitoring no longer displays this tile, column or explanatory balance.
  Its two headline totals appear only in Hub Collection & Disposal; Hub Disposals
  is the detailed ledger and does not repeat those cards. Sent and disposed are
  overlapping lifecycle quantities, not additive totals. Handling includes archived
  history while Overview declarations use active batches, so compare equal cohorts.

Agreed transfer quantities, reservations and listing inventory are not physical
outflows. Measured Hub handover evidence takes precedence over reported handover
weight; superseded readings do not count. Repeated listings do not duplicate
batch balances. Aggregate-only accounts retain totals without record identities.
The disposal ledger no longer displays a landfill-diversion tile. No new intake
receipts are backfilled, and this change adds no mobile or database write path.

### Remaining Mobile Handoff

The mobile developer must reconcile the still-active weighing UI and shared
`mobile_can_weigh` / disposal authorization with the collect-and-dispose-only
business contract, and establish an explicit collection receipt if desired.
Web permission restrictions do **not** change direct Supabase mobile RPC/RLS
authorization. Existing approval controls still use the shared organization flag;
approving an operator can therefore retain older mobile weighing authority.
No operator is automatically approved by this web update.

Validation: isolated server fixtures, browser interception and production builds;
no shared-account provisioning, collection/disposal writes or migrations.

## Historical Weighing Contract

Contract checked against the shared Supabase SQL definitions on 18 October 2026.
This web change includes narrowly scoped shared-function compatibility updates;
it does not create tables, seed records or change the mobile application.
Browser/unit tests use isolated fixtures.

## Roles and Approval

| Purpose | Shared contract | Web behavior |
| --- | --- | --- |
| Hub account | `users.role = 'BalikTela Hub'` | Explicit mobile-compatible role, managed under Recovery Monitoring > Hub Management. Never grants administrator access. |
| Compatible operator | `users.role = 'Recycler'` | Existing approved Recycler accounts continue to work. No bulk conversion or duplicate profiles. |
| Weighing approval | `users.organization_verified = true` | Approval requires an active account, verified email and initialized private password. |
| Directory availability | Active approved Hub or Recycler, account not suspended/deactivated | Pending operators remain visible to administrators for review. Approval preserves the existing role. |
| Administrator | `hubs.read`, `hubs.manage`, `weighing.read` | Approve/revoke operators and associate existing facilities, with a required audit reason. |
| Researcher | `hubs.read`, `weighing.read` | Read only, respecting assigned regions and aggregate-only scope. |
| Government | Same read permissions | Hub/measurement identities always withheld; regional summaries only. |
| Recycler/Producer | Existing organization scope plus `weighing.read` | Own/organization-scoped evidence only; no Hub approval permission. |

Approval updates existing `verification_status`, `organization_verified` and
account status fields atomically with an audit record through the existing
management transaction adapter. Revocation sets organization approval false,
without deactivating the community account. Approval, revocation and facility
assignment revoke the operator's web sessions. Mobile weighing authorization
reads the shared approval flag; this change does not add mobile session controls.
Generic account suspension also clears the shared organization approval flag.
Ordinary edits to an active Recycler account preserve a revoked weighing flag;
changing its role or organization clears Hub approval for a fresh review.

Migration `20261018090000_hub_role_compatibility.sql` recognizes approved Hub
and Recycler accounts in the permission predicate, operator directory and the
installed assigned-Hub validation. It does not create users, convert roles,
replace the signup trigger or remove disposal/remainder guards. It was applied
with user approval and tested twice in one transaction; business row counts
were unchanged. The deployed mobile app was rechecked on 19 October: it now
recognizes Recycler and BalikTela Hub accounts, unlike the older supplied ZIP.

The separate `20261018092000_hub_signup_alignment.sql` updates only the insert
mapping inside the existing signup trigger function: explicit `account_type=hub`
creates a pending `BalikTela Hub` / `Collection personnel` profile. Explicit
Recycler requests still create Recycler profiles; ordinary signups remain
Consumers. The original Auth-ID conflict handler remains email-only, so email
confirmation and later Auth updates cannot convert or duplicate existing users.

Follow-up integration testing on 19 October found an installed
`normalize_recycler_role` trigger converting native Hub writes to Recycler.
On 21 October, the administrator's explicit Hub role changes were confirmed in
the audit trail but the trigger had persisted Recycler instead. Migration
`20261021030000_preserve_explicit_hub_role.sql` now preserves explicit
`BalikTela Hub` writes with `Collection personnel` metadata. Ordinary Recycler
accounts and the unrelated legacy LGU compatibility rule remain unchanged.
`scripts/test-hub-role-sql.ts` tests the installed trigger with temporary rows;
`scripts/repair-hub-role.ts` defaults to dry run and can restore only a specified
account whose latest administrative audit explicitly requested Hub, without
granting approval or changing assignments. Repairs are audited and revoke old
dashboard sessions. No bulk role conversion is performed. See
[Mobile / Web Hub Handoff](Mobile_Web_Hub_Contract.md) for current deployment
evidence, role naming, validation scope and remaining data-quality findings.

Hub accounts receive only scoped read access on web after approval: their own,
assigned or personally measured materials and related transfers. Approval,
weighing operations and account administration are not granted to operators.
Researchers retain their assigned regional limits; Government remains aggregate-only.

## Identifiers and Measurements

| Information | Source | Meaning |
| --- | --- | --- |
| Assigned weighing Hub | `listings.weighing_hub_id -> users.id` | Operator profile ID, **not** `facilities.id` or `auth.users.id`. |
| Route | `listings.delivery_route` | `via_hub` or `direct`; direct estimated listings are not pending Hub tasks. |
| Physical facility association | `users.scope.facility_ids -> facilities.id` | Existing web scope association. Does not populate `facility_assignments` or assert where an old measurement occurred. |
| Measurement facility | `measurements.facility_id` | Actual recorded provenance; show "Not recorded" when absent, never infer from today's assignment. |
| Hub weighing | `measurements.stage = 'listing'`, or `declaration` with Hub-scale method | Scale declarations are included without treating ordinary participant declarations as Hub weighing. Not collection or completed transfer. |
| Weight and evidence | `weight_kg`, `weight_status`, `method`, `measurement_context` | Preserved without treating missing weights as measured zero. |
| Operator and time | `recorded_by`, `verified_by`, `measured_at` | Account provenance and Philippine-time display. |
| Corrections | `supersedes_measurement_id` | History retained. Only the latest non-superseded Hub measurement per batch contributes to latest weighed mass. |
| Transfer validation | `measurements.stage = 'validation'` | Separate from Hub weighing. |
| Recipient activity | Completed transfers referencing the listing | Recipient mass is explicitly labeled **agreed**, not independently weighed or recovered. |

Original owner is joined through the transfer's listing when present; otherwise
the earliest listing for the batch is used, matching mobile history behavior.
Draft/available/archived listings can be weighed only when not disposed,
reserved, a pending split remainder or associated with an active transfer.
Other listings are marked locked. The web does not execute weighing mutations.

## Metrics and Filters

- Hub directory counts reflect **current** operator approval/assignment state.
  Global region, city, organization and facility filters apply, alongside its
  local search and approval filter. Historical dates and material categories
  do not change an operator's current approval status. Weighing record counts
  in this directory are all-time; use monitoring for cohort-based evidence.
- Weighing Monitoring uses the existing global **batch-registration cohort**:
  dates, region, textile and other supported filters. History includes recorded
  evidence for that cohort through the current as-of time. It is not a historical
  approval-state reconstruction or a measurement-date cohort.
- Awaiting weighing counts only eligible routed Hub tasks with unknown mass.
  Unknown batch mass is explicitly labeled and excluded from known-mass totals.
- Latest weighed mass counts one active Hub measurement per batch. Record count
  includes historical measurements, so these two metrics have different units.
- A Hub listing measurement never inserts collection/recycling/recovery records
  or completes transfers. Listing weighing is not physical collection or diversion.
- Operational data refreshes on view entry, relevant web changes, return to a
  visible tab, reconnect and every 30 seconds while the page is active. Hidden
  pages do not poll. Editing dialogs pause polling. Analytics additionally
  respects the existing server cache (normally up to 60 seconds total latency).
  This is polling, not a Supabase Realtime subscription.

### Overview Evidence Definitions (19 October 2026)

- **Recorded Hub Disposal** replaces the former **Confirmed Reuse + Recycling**
  main tile. It sums unique `hub_disposals.weight_kg` entries linked to the
  selected batch-registration cohort, including archived materials, through the
  current as-of time. The same helper supplies Hub monitoring and operation totals.
  Partial disposal entries are additive; `listings.disposed_weight_kg` is a
  cumulative stock counter and is never added to the ledger. Duplicate IDs count
  once; conflicting duplicates, invalid/future weights or dates, missing reasons,
  unknown operators and broken links cannot inflate the sum. Historical records
  survive later role/approval changes. A missing feed displays Not available;
  invalid-only evidence displays Pending evidence. An available empty ledger
  reports zero recorded events. Values are converted from kilograms to metric tons.
  Example: two entries of 2 kg and 3 kg equal 5 kg (0.005 t), not 10 kg after adding
  the cumulative listing counter. The registration-date basis is not mobile's
  disposal-event-date basis. Disposal does not enter the recovery-share numerator
  or establish landfill diversion. Final reuse/recycling outputs remain available
  in lifecycle charts, reports and governance calculations.
- **Total Textiles Declared:** sum of declared weights once per registered material
  batch in the selected authorization scope and registration period. This replaces
  the former Total Textiles Collected headline and uses the same Total Textiles
  Declared label in the evidence summary and Material Flow report under identical
  filters. Its sparkline groups declarations by registration month. Missing weights
  are excluded, with no physical receipt or transfer-completion requirement.
- **Textiles Physically Received (separate lifecycle evidence):** validated `Collection` recovery-record output,
  once per batch, regardless of textile condition. Where no collection record
  exists, a single unambiguous, non-superseded Verified receipt with verifier
  and linked non-cancelled transfer can establish intake. Collection and receipt
  are never added for the same batch. Multiple intake records need reconciliation.
  Charts, Governance and reports use this display name; existing `collectedKg`
  fields and the import CSV's `collected_kg` remain unchanged for compatibility.
  Recyclable Textiles Received is the recyclable-eligible subset of this intake,
  not a subset calculated from declarations alone. Recovery share still uses
  supported physical intake as its denominator, never the declared headline.
- **Confirmed Recycling Output:** balanced, validated final `Processing` or
  `Recovery` output with `outcome=Recycling`, linked to a completed transfer.
  Recovery takes precedence over Processing for the same portion. Recyclable
  classification, sorting output, receipt and completed status alone do not qualify.
- **Completed Textile Transfers:** activity mass, preferring one current Verified
  validation measurement with verifier, otherwise reported receipt weight. Agreed
  quantities are not final weights. Missing final weights are disclosed/excluded;
  repeated custody movements can overlap and must not be called unique diversion.
- **Confirmed Reuse + Recycling:** validated final outputs, not a landfill claim.
  Reuse includes repair, redistribution and upcycling outcomes. Unbalanced outputs,
  duplicate final records, remainder lineage and multiple final transfer portions
  without a root-lot allocation contract are withheld rather than silently capped.
- **Confirmed Recovery Share:** final output linked to validated collected batches
  divided by all validated collection in that cohort, including collected stock
  without an outcome. Outputs without matching intake are disclosed separately.
  No matched final evidence, zero collection or unresolved allocation conflicts
  means no published rate. A validated zero-output outcome can establish a real 0%.

Example: 100 kg collected, 80 kg transferred, and 72 kg validated final recycling
output means 72% confirmed recovery share, not 80%. The remaining 28 kg has no
confirmed circular outcome; it is not automatically landfill disposal. Stage
quantities overlap and are not additive. Charts and material-flow exports use
the same aggregation helper, `server/materialEvidence.ts`.

Dates continue to select the **batch-registration cohort**; outcomes are those
known through the as-of timestamp. These are not collection-event-month totals.
Existing qualifying receipt measurements can supply intake; a receipt without
matching verified measurement/collection evidence remains pending. The web now
reads `hub_disposals` separately for disposal oversight (see below). Disposal rows
do not establish final destination or avoided landfill. CO2e, water and landfill
equivalents remain disabled. No mobile, shared schema, seed or live-record changes
are required for these web-side definitions.

### Completed Synthetic Lifecycle Dataset

The optional `synthetic-lifecycle-v2` demo repair supplies the missing final
outcomes in the January-September and October fixtures. Each source cohort is
partitioned into disjoint reuse and recycling batches. Declaration, collection
and sorting totals are distributed between those batches without changing the
source mass totals. Existing transfer quantities, requests and rewards remain
unchanged. Each completed transfer receives a validated final Recovery record,
Verified output measurement and a timestamped processing event before completion.
Unprocessed stock is retained; it is not counted as recovery or landfill disposal.

`npm run db:supabase:complete-demo` previews the plan. With explicit synthetic-seed
authorization, append `-- --apply --rollback-only` to test and roll back the
transaction, or `-- --apply` to commit it. The script only permits known generated
SYN IDs in six lifecycle tables, checks references from other records, preserves
custom listing statuses, and refuses changed ownership or unexpected mass edits.
It handles only the exact timestamp variants from the original demo seed.
Protected rows are fingerprinted across public tables; accounts, registry records,
requests and rewards are not written. A private synthetic-only backup is generated
under `/tmp` before committing. Re-running the repair must produce no mutations.
Use `node --import tsx scripts/verify-synthetic-lifecycles.ts` for a read-only
check against the live Supabase snapshot, chart totals and regional totals.

## Mobile Evidence and Statuses

- Material Registry offers only Estimated and Measured weight statuses. Historical
  Verified weights display and filter as Measured, including the measured-mass
  summary, without rewriting canonical records or verifier history. Missing status
  remains unclassified. Registry registration/correction cannot assign Verified;
  an unrelated metadata edit preserves existing verification and current stock,
  while a changed weight requires a new Estimated/Measured reading. Other modules
  retain canonical verification checks for collection and final-outcome analytics.
- Native drafts, archives, revised/expired/withdrawn requests and transfer
  processing/closure states remain distinct and round-trip without rewriting
  the original state. Unknown states are explicitly labeled and not actionable.
- Listings distinguish recorded, reserved and currently requestable kilograms.
  Partial disposal locks weighing, even when `disposed_at` is still null.
- Flow-only handover/receipt weights remain reported evidence. They never become
  verified weights merely because a transfer completed. Processing events are
  not relabeled as validation events.
- Recovery output, rejected material and `loss_kg` remain separate. Balance is
  input = output + rejects + processing loss. Reward summaries include reversals.
- Migration `20261018091000_dashboard_mobile_evidence.sql` extends only the
  existing service-only snapshot projection with those fields and measurement
  provenance. Existing grants and business records remain unchanged.
- Disposal/remainder flags are visible on listings. The existing disposal ledger
  is read-only on web; remainder ownership decisions remain mobile-owned.

## Web Corrections and Bulk Demo Import (19 October 2026)

- Recovery Monitoring > Hub Disposals reads the existing
  `hub_disposals` fields: `id`, `listing_id`, `operator_id`, `listing_title`,
  `category`, `weight_kg`, `reason`, `disposed_at`. They join the original listing
  to the batch cohort, preserve archived disposal history, exclude incomplete
  quantities, and withhold operator/listing details for aggregate-only accounts.
  Approved native Hub accounts and compatible Recycler operators retain their
  original roles; web does not execute physical disposal or change mobile RPCs.
- The ledger has no structured final destination or avoided-landfill baseline.
  **Recorded disposal mass is not diverted-from-landfill mass.** Disposal,
  collection, transfer activity and validated final recovery remain distinct.
- Listing Oversight uses the mobile **My textiles** categories: `draft` -> Draft,
  `available` -> Available, `matched` / `reserved` -> In progress,
  `completed` -> Completed, `closed` / `archived` -> Closed. The original mobile
  state remains visible beneath the category and is never rewritten by grouping.
  Unknown source states remain Unknown, not available or completed.
- Disposal and remainder flags have a separate Handling column and filter; they
  do not replace the mobile listing status. Partially disposed stock can remain
  Available, while a pending-remainder draft stays Draft. Reserved,
  partially/fully disposed and pending-remainder stock cannot be reopened by
  administrative moderation. Refresh reads current shared records; visible pages
  also refresh on focus and every 30 seconds without changing mobile workflows.
- Traceability uses one shared status grouping, including `processed`,
  `processing`, `collected` and closed states. Completed rows without a final
  weight no longer fall back to agreed quantities. Batch details show original
  user, custody and measurement IDs, operator/verifier, facility and corrections.
- Facility capacity includes matching idle registered facilities; it is not
  limited to facilities that already have recovery records. Processing duration
  is "Not reported" unless supported, rather than a fixed fabricated duration.
- Producer permissions cover supplied materials and provider actions; Consumer
  permissions cover requests and recipient receipt. Consumers cannot create
  producer listings or independently validate recovery. Producer accounts cannot
  make recipient requests or validate incoming material. This applies to web
  APIs only; mobile source and shared role triggers are unchanged.
- Advanced diagnostic analytics focuses on intake-evidence gaps, transfer
  completion and material-level recovery support. Waste Analytics retains the
  trend, category and regional charts. Predictive models remain separate.
- Data Quality publishes its source/rule catalogue: weights, structured geography,
  stale custody, missing references, configured variance thresholds and balanced
  stage records. Weight-verification coverage is not final-recovery coverage.
- Governance uses the same collection-based recovery-share formula as Overview,
  actual export permission, synthetic forecast caveats and the Hub disposal
  distinction. It does not publish prescriptive analytics or compliance claims.

### Import Contract

Material Registry > **Import demo CSV** is administrator-only and accepts up to
500 rows / 256,000 bytes per file. Download the template to obtain the exact
headers and existing Producer, receiving-partner and facility IDs. Values in the
CSV are **kilograms**; timestamps must include a timezone. City/region come from
the selected source profile. Real operational-data import is not enabled.

Each external ID represents one unique demo batch with at most one final outcome
(`Reuse` or `Recycling`). Blank collection/outcome cells mean missing evidence,
not invented recovery. Declared >= collected >= sorted >= output; the generated
stage records preserve rejects and link measurements, requests and transfers.
All created records are marked or named demo; existing accounts, mobile records,
reward credits and schema definitions are never updated by this import.

Preview validates every row without writes and reports the incremental declared,
collected, reused and recycled mass. Confirmation requires an import reason and
explicit synthetic-data acknowledgement. Reusing the same external IDs skips
already-imported rows; changed content or partial collisions are rejected rather
than overwritten. IDs are deterministic `IMP-DEMO-*`, separate from `SYN-*`.

The existing persistence RPC permits 200 canonical mutations per transaction.
Imports therefore commit five-row atomic chunks with an audit record. If a later
chunk fails, the UI explicitly reports partial completion; previewing/retrying
the same file skips committed rows. There is no whole-file rollback after a
successful chunk. HTTP saves are limited to 25 CSV rows per request; the browser
continues with a server-returned row cursor and displays checked/imported/skipped
progress. Each request revalidates the full CSV and current administrator access.
Supabase duplicate checks retrieve only deterministic IDs and conflict fields,
without loading or joining unrelated measurement and transfer histories.

If a response is lost, it does not prove that the save failed. The modal discards
the stale preview and asks for a new preview of the exact same file. Already
committed rows are skipped, including when the last response was lost after the
entire file completed. Do not rename external IDs to retry. Concurrent or changed
records are not overwritten. No in-process job state or database migration is
required for continuation. Analytics refresh after completion or interruption,
not after every intermediate window; date, region,
textile and role filters still apply to the newly added records.

Verification commands:

```sh
npm test
npm run typecheck:api
npm run build:render
npm run test:web-corrections:ui
npm run test:imports:ui
npm run test:stakeholders:ui
node --import tsx scripts/test-management-sql.ts
```

The SQL test uses an isolated PGlite installation under `/tmp`, not the shared
database. Browser tests perform imports only into disposable in-memory fixtures.
No shared demo imports or live-record edits were performed during this work.

To apply the three idempotent function updates using privately configured credentials:

```sh
DOTENV_CONFIG_PATH=.env.supabase node --import tsx scripts/apply-hub-compatibility.ts --apply --evidence --signup
```

Do not reapply the ZIP's older migrations 013-016 over the installed functions.
They predate current routing, disposal and remainder protections.

## Unified PoC Presentation

Stakeholders has three presentation groups: Producers, Consumers & Recyclers,
and BalikTela Hubs. NGO profiles are omitted from this directory, not deleted
from accounts or transaction history. Grouping does not merge accounts or grant
Consumer accounts Recycler permissions. Explicit Hub roles are recognized;
legacy Recycler profiles appear as Hubs only with explicit Hub metadata,
listing assignments or recorded Hub weighing evidence. Names and approval alone
do not establish a Hub identity. Each profile appears once, with its original
account role retained in the response.

Hub cards use the shared database for approval, assigned listings, waiting work,
weighing records, latest non-superseded batch readings, assigned facilities and
associated transfers. Date/material filters select batch activity; registered
idle Hubs can appear with no evidence under unrestricted material filters and
authorized profile-region scope. Missing locations, weighings or facilities are
reported as missing, never inferred. Listing-scale readings are not final
recovery or landfill-diversion evidence. Aggregate-only access withholds profiles.

Routine dashboard views combine synthetic scenario and shared operational records
under identical lifecycle, mass-balance, date, scope and percentage rules. Overview
shows one material-batch cohort rather than separate demo/operational counts;
listing, material, transfer and disposal views do not repeat origin badges.
The CSV action is labeled **Import CSV**; its administrator-only import dialog
still requires acknowledgement of synthetic inputs and retains duplicate guards.

This is a presentation policy, not a data conversion. Original `is_demo` flags,
IDs, source names, lifecycle notes, audit records and mobile records are preserved.
Governance and exported report caveats disclose the combined PoC boundary. The
footer identifies the PoC workspace. Platform Engagement reads source records,
not synthetic interaction summaries (see below). The
undefined stakeholder reliability score is omitted from the profile drawer.
Forecasts retain their fixed synthetic training snapshot and methodology details;
importing lifecycle records does not retrain them. No missing links, weights,
physical outcomes or environmental evidence are manufactured by this policy.

## Record-Based Platform Engagement

- Registered Accounts counts unique Auth UUIDs on current profiles, excluding
  unlinked/seeded profiles, invalid dates and registrations after the as-of time.
  This includes real test registrations and disabled accounts; it is not distinct
  people, active accounts or new registrations within the selected dates. Profile
  geography, organization, stakeholder role and caller scope apply, not textile
  category. The same count replaces the old active-user tile on Overview.
- Material listings, match requests (all states) and completed/processed transfers
  count unique IDs within the existing selected batch cohort. Synthetic lifecycle
  records remain included under the disclosed PoC scope, not relabeled as actual
  observed usage. Imports update these counts once; they do not create accounts.
- Report exports count `report.exported` Report audit events within the selected
  Philippine reporting dates. Admins see platform counts; other roles see only
  their own events. CSV and print generation count, not previews or failed requests.
  Material filters do not select export events. A failed audit feed is unavailable,
  not zero. Supabase reads only matching events through bounded keyset pages.
- Active users, sessions and average session duration remain null/unavailable.
  Existing synthetic `system_interactions` rows are retained but ignored; the web
  does not claim mobile/web telemetry coverage or manufacture sessions from logins.
- Successful exports invalidate the web analytics cache so returning to Overview
  reloads the audit-derived count. No mobile code, schema or real records are changed.

## Verification

### Hub Workspace Location

Recovery Monitoring is the only page hosting Hub Collection & Disposal, Hub
Management (or the read-only Hub Directory), and Hub Disposals. Hub accounts open
directly on Recovery Monitoring after sign-in. Existing `hubs.read` / `hubs.manage`
permissions still control read access and administrative approval/assignment.
Aggregate-only viewers may open the monitoring workspace, but receive regional
summaries without operator/listing identities or processing-record actions.
The Processing Records tab and its stage-record creation/management interface
have been removed for all web roles. Recovery Monitoring requires `hubs.read`;
`recovery.read` alone no longer exposes a page that has no Hub functionality.
Existing recovery records and backend evidence calculations remain intact for
analytics, data quality and reports. No mobile data or database records are deleted.

Traceability retains transfers and permission-gated historical listing weights;
it does not host Hub handling or management. Hub Facilities provides the Hub
analytics table and capacity/utilization calculations without operational Hub
tabs. Overview retains summary analytics, not a second Hub operations workspace.
This is a web navigation change, not a mobile workflow or database migration.

### Hubs: One Registry

All seven existing facility records are registered **Hubs**, not a separate
category of sites. Their existing `facilities` records and IDs remain the same
ones used by Hub Management assignments, receipt measurements and historical
records. There is no extra site registry and no duplicate Hub creation. The
registered-Hub count comes from these records, never from the number of login
accounts. Two Hub accounts do not reduce the seven registered Hubs to two or
increase them to nine. Accounts are authorized to operate assigned Hubs.

The shared database keeps its `facilities` table/column names and historical type
values for mobile compatibility. User-facing classifications are Hub. No new
login accounts or permissions are created by this reconciliation, and missing
account-to-Hub links remain explicit as **No operator assigned**.

Hub Facilities now uses the `hubStorage` payload for storage capacity, stock held,
incoming reservations, utilization, disposal and intake availability. Overview's
Hub Storage Utilization chart uses the same rows. The older `facilities` payload
remains historical period-handling performance, not current storage availability.
No registry records or historical handling metrics are rewritten.

Handling intake counts each batch once per Hub, using a measured collection
receipt when available, otherwise its earliest balanced validated operation
(collection output or another stage's input). Receipt evidence replaces that
batch's operation intake rather than being added a second time. Later sorting,
processing and recovery stages do not multiply handling volume. Missing
processing time remains not reported; stored intake counters are not used.

The separate `hubFacilities` operational-evidence payload retains canonical Hub
collection/disposal attribution and balances for monitoring/reconciliation. Its
account-link gaps do not disable the registered-Hub performance table. Intake
from historical operation inputs is a handling-volume measure, not proof of a
Hub collection receipt, disposal, or landfill diversion. Historical confirmed
reuse/recycling output is never labeled Hub disposal.

An explicit Hub ID (the legacy `facility_id`) on a collection receipt establishes
its location. Otherwise a single current account-to-Hub assignment is used and
disclosed as such, not as a proven historical assignment. Missing or multiple
possible Hubs remain unattributed; weights are never divided among Hubs by
guesswork. The page reports unattributed batch/weight totals separately. Accounts
with no Hub assignment require an administrator's assignment in Recovery Monitoring.

Storage capacity is configured in Organization administration's Hub editor and
persisted as `facilities.storage_capacity_kg`. This is maximum physical storage,
not monthly throughput. New Hubs require a positive capacity in kilograms (the UI
accepts metric tons). Existing monthly handling targets and old intake counters
remain historical fields; they cannot be edited through this form and do not
supply storage capacity or stock. New operational Hubs without capacity remain
unavailable until configured. Existing demo Hubs without this setting retain
explicitly labeled illustrative limits from `shared/hubStorage.ts`; a configured
capacity takes precedence without relabeling synthetic activity as operational.

Current stock uses all recorded history, including
archived batches and all textile categories, not the selected reporting cohort.
Stock = supported physical intake - unique disposal - evidenced outbound movement.
Pending published consumer batches reserve original declared weight once per batch;
a receipt replaces that reservation. Missing or conflicting balances withhold
availability, not manufacture zero stock. Aggregate-only viewers receive regional
groups without Hub/account identifiers; regional groups are never selectable.

Intake pauses when stock plus reservations reaches 90% of storage capacity.
Headroom = max(0, 90% capacity - stock - reservations). Supported disposal releases
space on the next refresh, without clearing history or changing capacity. Only
approved, operational Hubs with known balances become available again. A complete
disposal reaches 0% only if nothing remains; reservations still consume headroom.
Actions remain in Recovery Monitoring, not Hub Facilities or Traceability.

This is dashboard reporting, not enforced admission control. The additive storage
capacity migration extends the service-only snapshot without changing existing
rows, RLS, or grants. No mobile code is changed. Mobile must call a shared transactional
check-and-reserve operation that locks the physical Hub, validates the positive
submission weight fits headroom, and writes a unique reservation keyed to the
submission. Recheck on commit; a stale picker response must not admit excess stock.
Release reservations on cancellation, replace on receipt, and make retries and
disposal events idempotent. Per-operator quotas cannot substitute for site totals.

### Linked Hub Storage Simulation

The approved small dataset `SYN-HUBSIM-V1-` links seven batches and listings to
the seven existing demo Hubs; it creates no additional Hub registry records.
It includes twelve declaration/intake measurements and four disposal ledger
entries. Scenario totals: 20,500 kg declared/sent, 17,250 kg physically received,
2,900 kg disposed, 14,350 kg held and 3,250 kg reserved awaiting receipt.

Profiles are disabled non-login fixtures with no Auth IDs, passwords, verified
email timestamps, public stock, published available listings or rewards. They
are not real approved operators and must not appear as active mobile destinations.
Storage may show their explicitly labeled **Simulation only** capacity state;
`selectable` remains false. The narrow display-only recognition requires the
dataset operator prefix, Recycler role, fixed synthetic profile note, disabled
state, null Auth/password and reserved invalid email domain. This works with
compact snapshots that omit stakeholder labels. It does not grant any permission
or alter normal Hub approval.

Run `node --import tsx scripts/seed-hub-simulation.ts` to preview. Application
requires `SUPABASE_SYNTHETIC_SEED=true` plus `--apply`; first use
`--apply --rollback-only` to verify a non-committing insert. Full repeat runs
verify existing fixture values and make no writes. Partial or edited datasets
are refused. Every existing row in 38 public tables was fingerprint-protected
during the initial operation. No schema, Auth account, existing assignment,
transaction, reward or real mobile record is rewritten.

Manila's existing unrelated intake/disposal evidence gap remains visible in the
combined Hub stock. The simulation cannot manufacture receipts for those real
records. Simulation-only masses reconcile independently; combined reporting must
keep unknown balances unknown.

### Governance and Policy Monitoring

Governance uses the global reporting filters and the same registration cohort,
validated intake, outcome allocation and recovery-share calculator as Overview.
Its four sections map to blueprint GOV-01 through GOV-06:

- Policy Summary: current/prior material evidence, intake coverage, source
  organization participation and a separate Hub disposal summary.
- Regional Performance: collection comparisons, final outcomes, missing intake,
  participating source accounts, participating approved Hubs and matching sites.
- Producer Evidence: original source-organization/region groups, not downstream
  ownership. Government and aggregate-only viewers receive regional groups with
  no organization names, account identifiers or individual records.
- Accountability and Methodology: scoped quality counts, evidence limitations,
  current privacy/export permissions and permission-aware links to existing
  records, audit and report modules. Report exports retain their existing checks.

The read-only governance endpoint does not create policy approvals, regulatory
certifications or environmental conversions. Missing collection stays unknown;
no collection baseline means no percentage change. Disposal includes archived
history under the selected registration filters and never becomes diversion.
Regional footprint counts are not a certification of geographic service coverage.
Current and prior values use outcomes known at the same reporting timestamp.

Run `npm run test:governance:ui` for isolated role, filtering, pagination, refresh,
empty/error-state and desktop/mobile checks. No live database writes are needed.

`npm test` includes Hub contract, nullable-mass, measurement provenance, approval,
permission, privacy and session-revocation checks. `npm run test:hubs:ui` checks
admin decisions, filtering, pagination, aggregate-only views and responsiveness
from 320px to 2560px with isolated fixtures. Build first; the UI test serves the
built app on an ephemeral local port and never writes to Supabase.

## Organization Type Alignment

The latest supplied mobile archive (`baliktelaprogressive-main (1).zip`) uses
Consumer/Recycler signup choices and recognizes Hub accounts in `src/lib/domain.ts`.
These are account roles, not an organization-type registration vocabulary.
The web organization registry uses the existing shared `organizations.type`
constraint: Producer/Retailer, Recycler, Upcycler, NGO/Community, LGU/MRF,
Collection point, School, Research institution, Government agency and Other.
School is distinct from Research institution; the additive
`20261021032000_school_organization_type.sql` migration extends the existing
type constraint without reclassifying any organizations or user accounts.

`shared/registry.ts` is the single list for the web form, API validation and
schema. Legacy Producer, Research, Government, NGO and LGU/Collection Point
aliases normalize to existing canonical values when read, edited or saved;
they are not duplicate dropdown entries. Existing organization IDs, links and
provenance remain intact. Existing shared rows are not changed.
Organization classification never assigns a user role, grants Hub approval or
creates a physical Hub; Hub registration and account authorization stay separate.
