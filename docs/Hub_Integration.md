# Hub Management and Weighing Monitoring

Contract checked against the shared Supabase SQL definitions on 18 October 2026.
This web change includes narrowly scoped shared-function compatibility updates;
it does not create tables, seed records or change the mobile application.
Browser/unit tests use isolated fixtures.

## Roles and Approval

| Purpose | Shared contract | Web behavior |
| --- | --- | --- |
| Hub operator | `users.role = 'BalikTela Hub'` | Explicit mobile-compatible role, managed under Facility Analytics > Hub Management. Never grants administrator access. |
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
`normalize_recycler_role` trigger converting native Hub writes to Recycler,
matching the current mobile login's Recycler label. The deployed weighing
workflow remains compatible. Per the user's web-only instruction, that shared
normalization remains unchanged; no role-rewrite migration is included. See
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

- **Total Textiles Collected:** validated `Collection` recovery-record output,
  once per batch, regardless of textile condition. Where no collection record
  exists, a single unambiguous, non-superseded Verified receipt with verifier
  and linked non-cancelled transfer can establish intake. Collection and receipt
  are never added for the same batch. Multiple intake records need reconciliation.
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

- Recovery Monitoring and Facility Analytics > Hub Disposals read the existing
  `hub_disposals` fields: `id`, `listing_id`, `operator_id`, `listing_title`,
  `category`, `weight_kg`, `reason`, `disposed_at`. They join the original listing
  to the batch cohort, preserve archived disposal history, exclude incomplete
  quantities, and withhold operator/listing details for aggregate-only accounts.
  Approved native Hub accounts and compatible Recycler operators retain their
  original roles; web does not execute physical disposal or change mobile RPCs.
- The ledger has no structured final destination or avoided-landfill baseline.
  **Recorded disposal mass is not diverted-from-landfill mass.** Disposal,
  collection, transfer activity and validated final recovery remain distinct.
- Listing status filtering and displayed labels use the same disposal/remainder
  rules. Reserved, partially/fully disposed and pending-remainder stock cannot
  be reopened by administrative moderation.
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
footer identifies the PoC workspace. Reported engagement summaries are labeled
**Reported Active Users**, not measured distinct authenticated accounts. The
undefined stakeholder reliability score is omitted from the profile drawer.
Forecasts retain their fixed synthetic training snapshot and methodology details;
importing lifecycle records does not retrain them. No missing links, weights,
physical outcomes or environmental evidence are manufactured by this policy.

## Verification

`npm test` includes Hub contract, nullable-mass, measurement provenance, approval,
permission, privacy and session-revocation checks. `npm run test:hubs:ui` checks
admin decisions, filtering, pagination, aggregate-only views and responsiveness
from 320px to 2560px with isolated fixtures. Build first; the UI test serves the
built app on an ephemeral local port and never writes to Supabase.
