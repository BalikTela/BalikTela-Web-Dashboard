# Mobile Database Schema Alignment Review

> Historical review: the decisions raised here were resolved in [BalikTelaPH Shared Database Schema v1.0.3](BalikTela_Database_Schema_v1.md). Use the v1.0.3 contract for implementation; retain this document as source-analysis history.

Review date: 2026-10-05

## Sources reviewed

- `BalikTela-Database-Schema.sql`
- `BalikTela-Database-Schema.docx`
- `mobile-implementation.md`
- `mobile-requirements.csv`
- Web models in `server/types.ts`
- Web persistence adapter in `server/store.ts`

The mobile SQL and DOCX describe the same SQLite version 7 schema with 24 tables. The CSV describes functional requirements and does not define additional database fields.

## Important conclusion

The supplied mobile documentation is an export of a device-local SQLite schema. It is not a MongoDB Compass export and does not describe an existing shared MongoDB database. Before the web and mobile applications use one database, the team must approve a canonical backend MongoDB schema and synchronization API.

Database field names should be identical at the persistence boundary. UI and API DTOs may use a different convention only when the mapping is explicit and tested. To minimize mobile migration work, use the mobile schema's snake_case names for shared MongoDB fields unless the team approves a different convention.

## Collection alignment

| Mobile SQLite table | Current web collection/model | Alignment status |
| --- | --- | --- |
| `activity_logs` | `auditRecords` | Rename and reshape required |
| `collection_events` | None | Missing on web |
| `collection_receipts` | Partly represented by `measurements` and `recoveryRecords` | Dedicated record missing |
| `consent_history` | Current consent timestamps on `users` | History collection missing |
| `conversations` | `conversations` | Same purpose, different participant fields |
| `event_registrations` | None | Missing on web |
| `facilities` | `facilities` | Same purpose, substantially different fields |
| `facility_assignments` | Facility IDs inside user scope | Dedicated relationship missing |
| `favorites` | None | Missing on web |
| `flow_events` | Embedded `transfers.events` plus `measurements` | Storage design conflict |
| `listings` | `listings` plus `materialBatches` | Same area, different entity boundary and fields |
| `match_requests` | `offers` plus `transfers` | Semantic and lifecycle conflict |
| `messages` | `messages` | Close, but fields differ |
| `notifications` | None | Missing on web |
| `offers` | `offers` | Different offer structure |
| `recovery_records` | `recoveryRecords` | Same purpose, different fields |
| `reports` | None | Missing on web |
| `reward_ledger` | `walletEntries` | Rename and reshape required |
| `reward_rules` | Part of `configurations` | Dedicated collection missing |
| `settings` | `configurations` | Different scope and structure |
| `support_tickets` | None | Missing on web |
| `transactions` | No equivalent; web `transfers` are material transfers | Name collision with different meaning |
| `users` | `users` | Same entity, substantially different fields |
| `wallet_accounts` | No account collection; balance is derived | Missing on web |

Web-only collections are `organizations`, `materialBatches`, `measurements`, `transfers`, and `configurations`. These support dashboard governance and traceability but need approved names and relationships in the shared schema.

## Critical field differences

### Users

Mobile fields are `id`, `name`, `username`, `email`, `password`, `bio`, `location`, `phone`, `avatar_uri`, `rating`, `swaps`, `created_at`, `stakeholder`, `organization`, `organization_verified`, `privacy_consent`, `research_consent`, and `notification_enabled`.

Web fields are `id`, `email`, `passwordHash`, `fullName`, `role`, `organizationId`, `organization`, `city`, `region`, `joinedAt`, `consentAt`, `verification`, `accountStatus`, `scope`, `trustPlaceholder`, and `profile`.

Recommended shared names include `password_hash`, never `password`; `full_name`; `role`; `organization_id`; `created_at`; `account_status`; and explicit consent fields. The mobile documentation states that its current password storage is local-pilot behavior, so the plaintext `password` field must not be copied into MongoDB.

### Listings and material batches

Mobile `listings` stores both the material record and marketplace state. It uses fields including `owner_id`, `category`, `size`, `condition`, `location`, `looking_for`, `impact_kg`, `media_json`, `weight_kg`, `waste_source`, `waste_form`, `pathway`, `weight_status`, and `status`.

Web separates `materialBatches` from `listings`, using fields such as `batchId`, `materialCategory`, `declaredWeightKg`, `currentWeightKg`, `circularPathway`, `quantityKg`, and `currentStatus`. The separation provides stronger provenance, but it cannot share the mobile database without an agreed migration or adapter.

### Offers and transfers

Mobile uses `offers` for listing-for-listing barter and `match_requests` for quantity-based requests. Web uses `offers` followed by a separate `transfers` lifecycle. Status values also differ: mobile uses lowercase values such as `pending`, while web uses title-case values such as `Pending`.

The team must select one status vocabulary and one authoritative transfer workflow. Values must match exactly, including capitalization.

### Weights and traceability

Mobile uses `kg`, `weight_kg`, `requested_kg`, `input_kg`, `output_kg`, `rejected_kg`, and `loss_kg`. Web uses descriptive camelCase fields such as `agreedWeightKg`, `receiptWeightKg`, `verifiedWeightKg`, `inputWeightKg`, and `residualWeightKg`.

Recommended shared storage uses descriptive snake_case fields, for example `agreed_weight_kg`, `handover_weight_kg`, `receipt_weight_kg`, `verified_weight_kg`, `input_weight_kg`, `output_weight_kg`, `rejected_weight_kg`, and `loss_weight_kg`. Avoid a generic `kg` field when the measurement stage matters.

### Dates and JSON

Mobile timestamps use snake_case ISO text fields such as `created_at` and `updated_at`. Web uses camelCase strings. Shared MongoDB documents should use snake_case names and BSON `Date` values at the persistence layer.

SQLite JSON text fields such as `details_json`, `media_json`, and `looking_for` should become native MongoDB documents or arrays, while retaining approved field names without the `_json` suffix if the shared contract explicitly records that change.

## Required decisions before model changes

1. Approve the shared MongoDB collection list and field naming convention.
2. Decide whether `listings` remains a combined material/listing record or is split into `material_batches` and `listings`.
3. Decide whether `match_requests` becomes the authoritative transfer aggregate or remains an offer/request preceding `transfers`.
4. Approve exact role, status, weight-status, pathway, and verification enum values.
5. Replace local plaintext passwords with backend password hashes and server-managed authentication.
6. Decide whether lifecycle events are embedded in transfers or stored in `flow_events`.
7. Define required indexes, uniqueness rules, retention rules, and consent history.
8. Publish one versioned schema contract and seed dataset used by both teams.

Do not rename the current web fields in isolation. That would make the UI compile while leaving the mobile workflow and persisted records incompatible. Implement the approved contract in the persistence/API layer, then adapt both clients to it.

## Local MongoDB and Compass setup on this Mac

This machine is Apple Silicon (`arm64`), has Homebrew, and currently has neither MongoDB Community Server nor MongoDB Compass installed.

1. Install MongoDB Community Server:

   ```bash
   brew tap mongodb/brew
   brew install mongodb-community@8.0
   ```

2. Start MongoDB as a macOS service:

   ```bash
   brew services start mongodb-community@8.0
   ```

3. Verify the server:

   ```bash
   brew services list
   mongosh "mongodb://127.0.0.1:27017"
   ```

4. Install MongoDB Compass from the official MongoDB Compass download page, move it to Applications, and open it.

5. In Compass, select **Add new connection**, enter the following URI, and connect:

   ```text
   mongodb://127.0.0.1:27017
   ```

6. Configure `BalikTela Dev/.env`:

   ```dotenv
   PORT=4000
   CLIENT_ORIGIN=http://localhost:5173
   MONGODB_URI=mongodb://127.0.0.1:27017
   MONGODB_DB=baliktela_dev
   JWT_SECRET=replace-with-a-long-random-local-secret
   ```

7. Start the project from `BalikTela Dev`:

   ```bash
   npm run dev
   ```

8. Refresh Compass. The `baliktela_dev` database appears after the application performs its first write. MongoDB does not display an empty database with no collections.

The current web server automatically inserts demo records when the configured database has no users. This is acceptable only for a local disposable development database. Demo seeding must become explicitly opt-in before Atlas or any shared database is used.

## Mobile MongoDB collection export review

Reviewed source: `collections-20261006T073408Z-1-001.zip`, received 2026-10-06.

The archive contains 29 CSV files. Every file has a header and zero data rows. It therefore confirms collection and field names only. It does not establish BSON types, required/optional fields, defaults, enum values, references, indexes, uniqueness rules, schema validators, or representative document shapes.

### What the export confirms

- The 24 SQLite tables were carried into MongoDB-style collection names.
- MongoDB uses `_id` instead of the SQLite `id` column.
- Most collections include Mongoose-style `created_at`, `updated_at`, and `__v` fields.
- A second naming style exists for some collections, using `createdAt` and `updatedAt`.
- `users` now uses `passwordHash`, which is appropriate for a backend database and replaces the unsafe local SQLite `password` field.
- `users` adds `role` and `active` while retaining `stakeholder`, creating an authorization-model decision that must be resolved.
- `listings` adds `reserved_kg` for quantity reservation.
- `transactions.amountMinor` and `wallet_accounts.balanceMinor` use integer minor units, which is safer than floating-point values for monetary or credit balances.
- New collections are `sessions`, `auditlogs`, `products`, `inventorymovements`, and `orders`.

### Recommended adoption

| Exported area | Recommendation | Reason |
| --- | --- | --- |
| Mobile participation collection names | Use as the mobile compatibility baseline | They match the implemented mobile workflows and prior schema documentation |
| Snake-case operational fields | Prefer for shared persistence | Most mobile collections already use this convention |
| `_id` | Use as the MongoDB primary identifier | Native MongoDB/Mongoose convention; define whether references are `ObjectId` or strings |
| `passwordHash` | Use, normalized to the approved persistence convention | Never store plaintext passwords |
| `sessions` hash fields | Use after security and expiry review | `tokenHash`, `usedTokenHashes`, `csrfHash`, `expiresAt`, and `revokedAt` support server-managed sessions |
| `reserved_kg` | Use after reservation rules are approved | Supports partial or whole-batch reservation accounting |
| Minor-unit balance fields | Use for monetary values; clarify whether rewards are money or points | Prevents floating-point currency errors |
| `activity_logs` | Use as the canonical operational audit collection | It has user and entity attribution plus structured details |
| `auditlogs` | Merge or deprecate | It duplicates `activity_logs` using a different field vocabulary |
| `products`, `orders`, `inventorymovements` | Keep separate and optional pending scope confirmation | They represent a commerce/inventory subsystem not established by the mobile participation requirements |
| `__v` | Treat as Mongoose metadata, not a business field | It should not appear in API contracts or analytics definitions |
| `*_json` fields | Convert to native MongoDB arrays/documents | MongoDB should not store structured values as JSON strings |

### Naming conflicts to resolve

1. Choose one timestamp convention: `created_at`/`updated_at` is recommended for persistence because it matches most mobile collections. Store values as BSON dates.
2. Choose one authorization field. `role` should control permissions; `stakeholder` may remain a profile classification only.
3. Choose one audit collection and vocabulary. Do not retain both `activity_logs` and `auditlogs` as overlapping sources of truth.
4. Define whether `transactions` means wallet/account entries or material transfers. Material transfers need a distinct canonical collection name.
5. Decide whether the combined mobile `listings` document remains authoritative or whether materials are normalized into `material_batches` plus marketplace `listings`.
6. Standardize reference types. Fields such as `user_id`, `listing_id`, `facility_id`, and `transfer_id` must all use the same identifier type as their target `_id`.
7. Confirm whether rewards are non-monetary integer points or financial balances. Do not mix `points`, `balanceMinor`, and `amountMinor` without an approved accounting definition.

### Collections proposed for the shared design review

Core identity and governance:

- `users`
- `organizations`
- `sessions`
- `consent_history`
- `activity_logs`
- `settings` or a typed `configurations` collection

Material participation and traceability:

- `material_batches`
- `listings`
- `offers`
- `match_requests`
- `transfers`
- `flow_events`
- `measurements`
- `conversations`
- `messages`
- `favorites`

Collection and recovery:

- `facilities`
- `facility_assignments`
- `collection_events`
- `event_registrations`
- `collection_receipts`
- `recovery_records`

Engagement and support:

- `notifications`
- `reward_rules`
- `reward_ledger`
- `wallet_accounts`
- `reports`
- `support_tickets`

Optional commerce collections should remain outside the core operational schema until `products`, `orders`, and `inventorymovements` are confirmed in the finalized product scope.

### Information still required from the mobile backend

Request the actual Mongoose schema/model files or an equivalent JSON Schema export. Also request the index definitions, enum constants, relationship/reference types, validation rules, and one sanitized representative JSON document per collection. A header-only CSV export cannot safely answer those questions.
