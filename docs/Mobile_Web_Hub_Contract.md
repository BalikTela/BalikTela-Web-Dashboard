# Mobile / Web Hub Integration Handoff

Review date: 19 October 2026 (Asia/Manila).

## Ownership and Evidence

Web owns account governance, approval, monitoring, analytics and traceability.
Mobile owns participant signup, listing entry, physical weighing and transfer
actions. This work does not edit or deploy the mobile application.

Mobile source reference: the supplied `baliktelaprogressive-main.zip`, archive
revision `4fa095378372cf2ade999b93a488535dd9f2a70e` (17 October). The current
private GitHub repository could not be read with the available GitHub account;
no issue or pull request has been sent to that repository.

The deployed PWA was also inspected read-only on 19 October: `/login` now labels
the weighing account **Recycler**. Its public bundle
`/_next/static/chunks/891-46823b5c33e6e0be.js` recognizes **both Recycler and
BalikTela Hub** in its Hub-account helper. Its weighing helper additionally
requires `organization_verified === true`. This is newer than the ZIP; the
ZIP's missing Recycler frontend support is **not a confirmed current defect**.
No mobile role patch is needed for that already-deployed compatibility.

## Agreed Role Contract

| Account | Weighing authority | Web behavior |
| --- | --- | --- |
| Current Recycler signup | Pending Recycler, also used as the mobile weighing account | Listed once in Hub Management; no weighing until approval |
| Explicit `account_type=hub` signup | Currently normalized to Recycler by the shared database | Still one profile, not a second Hub account |
| Approved, active `BalikTela Hub` | May weigh the assigned listing through mobile RPC | Scoped, read-only monitoring; no administrator powers |
| Approved, active `Recycler` | Compatible weighing role in the installed SQL | Existing role preserved; no second account |
| Pending, suspended or deactivated operator | No weighing authority | Approval gate or revoked session |
| Consumer / Producer / Administrator | No mobile weighing authority from that role alone | Existing role-specific permissions |

The installed `public.normalize_recycler_role()` trigger rewrites native Hub
roles to Recycler **after the signup mapping**. This matches the current mobile
login's Recycler label. Web treats those existing accounts as Hub candidates;
approval does not create a duplicate Hub account or change the stored role.

An alternative preserving distinct native Hub roles was investigated inside a
rolled-back transaction only. Per the user's web-only instruction, it was not
applied and was removed from the deployable migration directory. No shared role
normalization or mobile code/deployment is changed by this validation task.

## Coordination Notes

1. Keep the current deployed Recycler + BalikTela Hub compatibility in the
   source repository. Do not overwrite it with the older ZIP's helper. Do not
   make all Recycler accounts automatically approved.
2. Review the standalone legacy LGU frontend allowance against the installed
   SQL policy. The database normalizes collection-personnel LGU records to
   Recycler; web does not migrate these users.
3. Hide weighing controls for explicitly inactive/suspended/deactivated accounts.
   Always let the RPC recheck current authorization; frontend flags are not an
   authorization boundary.
4. Refresh `auth/me` on return to the app and on a weighing authorization error.
   Revocation must remove actions without relying on stale cached profile flags.
5. Keep listing assignment IDs as `public.users.id`. Never replace them with
   Auth UUIDs or facility IDs. Pending Hub accounts must not appear in the
   eligible weighing directory.
6. Add tests for native Hub and compatible Recycler approval/revocation, denied
   ordinary users, wrong-Hub assignment, and repeat submissions with one key.

These are handoff notes, not requested changes to the mobile repository or
deployment. The existing labeled mobile-review account was signed in, its
profile read, and that review session signed out. It remains an active,
email-confirmed, **pending/unapproved Recycler**. No account fields were changed.

## Field and Measurement Mappings

| Mobile / shared source | Web representation | Reconciliation rule |
| --- | --- | --- |
| `users.auth_user_id` | Private authentication linkage | One profile per Auth UUID; never display as operator ID |
| `listings.weighing_hub_id` | Assigned Hub operator | Join `users.id`, not `facilities.id` |
| `listings.delivery_route` | Direct / via Hub | Only routed eligible unknown-weight stock awaits Hub weighing |
| `material_batches.id` / `listings.batch_id` | Material Registry / traceability | Same batch ID throughout the flow |
| `measurements.stage=listing` | Hub weighing history | Not collection, recycling or transfer validation |
| Measurement `recorded_by`, `verified_by`, `measured_at` | Operator, verifier, Philippine-time display | Preserve source ID and instant; no invented facility |
| `measurements.facility_id` | Recorded facility | Missing is "Not recorded", not today's assigned facility |
| `available_weight_kg`, `reserved_kg` | Remaining and requestable stock | Requestable = max(0, available - reserved) |
| `match_requests.id`, `transfers.match_request_id` | Request / transfer linkage | Do not create a second transfer for a retry |
| `flow_events.stage`, `weight_kg`, `weight_status` | Timestamped lifecycle evidence | Estimated receipts remain reported evidence |
| `reward_ledger.points`, `entry_type` | Net reward activity | Include reversals; no reward invented by web |
| `recovery_records` output, rejects, loss | Recovery Monitoring | Input = output + rejected + loss; output is not Hub intake |

Weights remain kilograms in storage; the web displays metric tonnes (`kg/1000`).
Hub-scale verification is not verified receipt or recovery. Completion based on
agreed/estimated quantities remains visible but contributes no invented verified
diversion. Missing structured batch geography is reported as missing; a free-text
mobile address is not silently asserted to be a validated region.

## Repeatable Validation

```sh
DOTENV_CONFIG_PATH=.env.supabase npm run test:hubs:integration
```

To also test the older `account_type=hub` signup request against the current
installed normalization, without changing it:

```sh
DOTENV_CONFIG_PATH=.env.supabase npm run test:hubs:integration -- --legacy-hub-signup
```

The test uses the installed signup trigger, authenticated mobile SQL RPCs,
management mutation function, snapshot projection, web approval route and web
analytics builders. All synthetic identities, measurements, transfers, audit
records run in **one rolled-back transaction**. No functions are changed.
It verifies no fixture identities/profiles/idempotency receipts remain afterward.
No signup email, physical measurement or real-user approval is performed.

Web sessions in this integration harness are isolated in memory. Separate
authentication tests cover database sessions. This SQL-level cross-client test
does not prove email delivery, PWA/browser behavior or deployment synchronization.

It fails fast if the workflow lock is busy; run outside active weighing activity
because installed mobile mutation functions hold a shared transaction lock.
Results are written to `/tmp/baliktela-hub-integration/result-recycler.json` and
`result-legacy-hub.json`, outside the repository and without credentials or real identities.
The independent read-only shared-data audit is available with:

```sh
DOTENV_CONFIG_PATH=.env.supabase npm run audit:mobile-web
```

It checks duplicate identities/transfers, broken references, stock balances,
measurement timestamps, flow ordering, recovery mass balance and the backend
REST snapshot adapter. It never repairs operational records automatically.

Additional fixture-only browser checks:

```sh
npm run test:hubs:ui
npm run test:mobile-alignment:ui
```

Web polling refreshes visible operational views every 30 seconds and on focus /
reconnect. Analytics caching can extend visibility to about 60 seconds. This is
not a Supabase Realtime subscription.

## Validation Results

The current Recycler contract passed the rollback-only integration test on
19 October. The web-only fix extends assignment/measurement-based monitoring
to **approved Recycler Hub operators**, not just the literal BalikTela Hub role.
It does not grant administrator privileges or permit editing someone else's
transfer. Unapproved, suspended and unrelated accounts do not gain this scope.

| Check | Result |
| --- | --- |
| SQL signup / confirmation trigger and existing web approval route | Passed; one profile, original role retained |
| Unknown-weight listing | One awaiting task; no invented mass |
| Hub weighing | One 125.5 kg measurement = 0.1255 metric tonnes |
| Repeated listing / weighing / completion operation keys | No duplicate records |
| Transfer lifecycle | Reserved, handed over, received, completed preserved |
| Complete transfer stock | 0 kg remaining; 0 kg reserved |
| Operator, listing, batch, transfer, event IDs and measurement time | Reconciled across mobile SQL and web projection |
| Estimated handover and receipt | Visible evidence; no fabricated scale measurements |
| Verified diversion / reward credits | Both zero; a Hub scale alone is not a verified recovery outcome |
| Approval revoked | Mobile profile flag false; old web session denied |
| Rollback | No test identities, profiles or operation receipts left |

Web regression suite: 136 tests passed. Production build and API typecheck passed.
Fixture browser checks passed at 320, 375, 768, 1366, 1440, 1920 and 2560 pixels;
status-refresh checks also passed at 375, 1366 and 2560 pixels.

The independent shared-data audit found no duplicate Auth profiles or request
transfers, stock-balance violations, missing measurement times, duplicate flow
sequences, unbalanced recovery records or leftover test identities. It did find:

- **One existing received transfer references a missing listing.** Its batch
  and match request still exist. Do not recreate or delete anything without
  reviewing the original mobile-side record history and intended relationship.
- **Ten batches lack structured city/region.** They are not silently assigned
  an invented geographic location by web.
- **Three completed transfers lack independently verified weight.** Completion
  remains visible; they are excluded from verified diversion totals.

No mobile source/deployment changes, persistent shared-function changes,
real-account approvals, data repairs or GitHub pushes were made in this task.
