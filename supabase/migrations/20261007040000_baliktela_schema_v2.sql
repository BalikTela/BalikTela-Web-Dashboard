-- BalikTela canonical PostgreSQL schema for Supabase.

-- Generated from server/database/schema.ts; edit the source contract, then regenerate.

begin;

create table if not exists public."schema_versions" (
  "id" text primary key not null,
  "__v" bigint,
  "version" text not null,
  "status" text not null check ("status" in ('active', 'superseded', 'rolled_back')),
  "applied_at" timestamptz not null,
  "applied_by" text not null,
  "notes" text
);

create table if not exists public."users" (
  "id" text primary key not null,
  "auth_user_id" uuid unique references auth.users(id) on delete set null,
  "__v" bigint,
  "email" text not null,
  "passwordHash" text not null,
  "name" text not null,
  "username" text,
  "role" text not null check ("role" in ('Administrator', 'Government', 'Researcher', 'Producer', 'Recycler', 'Consumer', 'NGO', 'LGU/Collection Point', 'Upcycler')),
  "active" boolean not null,
  "stakeholder" text not null,
  "organization_id" text,
  "organization" text,
  "organization_verified" boolean not null,
  "verification_status" text check ("verification_status" in ('pending', 'verified', 'rejected', 'suspended')),
  "account_status" text not null check ("account_status" in ('active', 'pending_verification', 'suspended', 'deactivated')),
  "bio" text,
  "location" text,
  "city" text,
  "region" text,
  "phone" text,
  "avatar_uri" text,
  "rating" numeric,
  "swaps" bigint,
  "privacy_consent" boolean not null,
  "research_consent" boolean not null,
  "notification_enabled" boolean not null,
  "scope" jsonb not null,
  "profile" jsonb,
  "trust_placeholder" numeric,
  "last_login_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."auth_account_security" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "email_verified_at" timestamptz,
  "password_changed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."organizations" (
  "id" text primary key not null,
  "__v" bigint,
  "name" text not null,
  "type" text not null check ("type" in ('Research institution', 'Government agency', 'Producer/Retailer', 'Recycler', 'Upcycler', 'NGO/Community', 'LGU/MRF', 'Collection point', 'Other')),
  "verification_status" text not null check ("verification_status" in ('pending', 'verified', 'rejected', 'suspended')),
  "status" text not null check ("status" in ('active', 'prospective', 'inactive')),
  "record_label" text check ("record_label" in ('operational', 'demo', 'sample')),
  "region" text not null,
  "city" text not null,
  "address" text,
  "service_areas" text[] not null,
  "accepted_materials" text[] not null,
  "contact_email" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."sessions" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "client" text not null check ("client" in ('web', 'mobile', 'api')),
  "token_hash" text not null,
  "used_token_hashes" text[],
  "csrf_hash" text not null,
  "expires_at" timestamptz not null,
  "revoked_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."auth_challenges" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "type" text not null check ("type" in ('password_reset', 'email_verification')),
  "token_hash" text not null,
  "client" text not null check ("client" in ('web', 'mobile', 'api')),
  "expires_at" timestamptz not null,
  "consumed_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."auth_rate_limits" (
  "id" text primary key not null,
  "__v" bigint,
  "scope" text not null check ("scope" in ('login', 'password_reset', 'email_verification')),
  "subject_hash" text not null,
  "attempts" bigint not null,
  "window_started_at" timestamptz not null,
  "locked_until" timestamptz,
  "expires_at" timestamptz not null,
  "updated_at" timestamptz not null default now()
);

create table if not exists public."consent_history" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "privacy" boolean not null,
  "research" boolean not null,
  "policy_version" text not null,
  "recorded_by" text not null,
  "source" text check ("source" in ('web', 'mobile', 'administrator')),
  "created_at" timestamptz not null default now()
);

create table if not exists public."facilities" (
  "id" text primary key not null,
  "__v" bigint,
  "organization_id" text not null,
  "name" text not null,
  "type" text not null check ("type" in ('Collection point', 'Sorting facility', 'MRF', 'Recycler', 'Upcycling hub', 'Repair hub', 'Donation center')),
  "address" text not null,
  "city" text not null,
  "region" text not null,
  "location" jsonb not null,
  "categories" text[] not null,
  "pathways" jsonb not null,
  "schedule" text not null,
  "instructions" text not null,
  "service_areas" text[],
  "monthly_capacity_kg" numeric,
  "current_intake_kg" numeric,
  "is_demo" boolean,
  "verification_status" text not null check ("verification_status" in ('pending', 'verified', 'rejected', 'suspended')),
  "status" text not null check ("status" in ('available', 'near_capacity', 'maintenance', 'onboarding', 'inactive')),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."facility_assignments" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "facility_id" text not null,
  "role" text not null check ("role" in ('manager', 'collector', 'receiver', 'verifier', 'processor', 'viewer')),
  "active" boolean not null,
  "assigned_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."collection_events" (
  "id" text primary key not null,
  "__v" bigint,
  "facility_id" text not null,
  "title" text not null,
  "starts_at" timestamptz not null,
  "ends_at" timestamptz not null,
  "description" text not null,
  "status" text not null check ("status" in ('draft', 'pending_approval', 'published', 'completed', 'cancelled')),
  "created_by" text not null,
  "approved_by" text,
  "approved_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."event_registrations" (
  "id" text primary key not null,
  "__v" bigint,
  "event_id" text not null,
  "user_id" text not null,
  "status" text not null check ("status" in ('registered', 'cancelled', 'attended', 'no_show')),
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."material_batches" (
  "id" text primary key not null,
  "__v" bigint,
  "source_user_id" text not null,
  "source_organization_id" text,
  "material_category" text not null,
  "composition" text,
  "waste_source" text not null check ("waste_source" in ('Pre-consumer', 'Post-consumer', 'Obsolete inventory', 'Household', 'Institutional', 'Unknown')),
  "waste_form" text not null check ("waste_form" in ('Garments', 'Offcuts', 'Fabric rolls', 'Fiber', 'Mixed textiles', 'Other')),
  "condition" text not null check ("condition" in ('Reusable', 'Repairable', 'Recyclable', 'For assessment', 'Rejected')),
  "intended_pathway" text not null check ("intended_pathway" in ('Collection', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Diversion', 'For assessment')),
  "final_pathway" text check ("final_pathway" in ('Collection', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Diversion', 'For assessment')),
  "declared_weight_kg" numeric not null,
  "current_weight_kg" numeric not null,
  "weight_status" text not null check ("weight_status" in ('Estimated', 'Measured', 'Verified')),
  "secondary_quantity" numeric,
  "secondary_unit" text check ("secondary_unit" in ('pieces', 'meters', 'bags', 'bales', 'other')),
  "location" jsonb not null,
  "current_status" text not null check ("current_status" in ('recorded', 'draft', 'listed', 'reserved', 'in_transit', 'collected', 'received', 'processing', 'reused', 'upcycled', 'recycled', 'recovered', 'rejected', 'closed', 'archived')),
  "current_custodian_id" text not null,
  "validation_status" text not null check ("validation_status" in ('pending', 'valid', 'flagged', 'excluded')),
  "is_demo" boolean,
  "archived_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."measurements" (
  "id" text primary key not null,
  "__v" bigint,
  "batch_id" text not null,
  "transfer_id" text,
  "facility_id" text,
  "flow_event_id" text,
  "stage" text not null check ("stage" in ('declaration', 'listing', 'handover', 'collection', 'receipt', 'processing_input', 'recovery_output', 'rejection', 'loss', 'validation')),
  "weight_kg" numeric not null,
  "weight_status" text not null check ("weight_status" in ('Estimated', 'Measured', 'Verified')),
  "method" text not null,
  "measurement_context" text,
  "recorded_by" text not null,
  "verified_by" text,
  "measured_at" timestamptz not null,
  "note" text,
  "supersedes_measurement_id" text,
  "created_at" timestamptz not null default now()
);

create table if not exists public."listings" (
  "id" text primary key not null,
  "__v" bigint,
  "batch_id" text not null,
  "owner_id" text not null,
  "owner_organization_id" text,
  "owner_name" text,
  "title" text not null,
  "description" text not null,
  "looking_for" text[],
  "media" jsonb,
  "available_weight_kg" numeric not null,
  "reserved_kg" numeric not null,
  "category" text,
  "condition" text,
  "location" text,
  "city" text,
  "region" text,
  "weight_kg" numeric,
  "weight_status" text check ("weight_status" in ('Estimated', 'Measured', 'Verified')),
  "waste_source" text,
  "waste_form" text,
  "pathway" text check ("pathway" in ('Collection', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Diversion', 'For assessment')),
  "reward_points" bigint,
  "is_demo" boolean,
  "status" text not null check ("status" in ('draft', 'available', 'matched', 'reserved', 'completed', 'closed', 'archived')),
  "published_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."favorites" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "listing_id" text not null,
  "created_at" timestamptz not null default now()
);

create table if not exists public."match_requests" (
  "id" text primary key not null,
  "__v" bigint,
  "requester_id" text not null,
  "requester_organization_id" text,
  "listing_id" text not null,
  "listing_title" text,
  "requester_name" text,
  "provider_id" text,
  "requested_kg" numeric not null,
  "terms" text not null,
  "incentive_points" bigint,
  "status" text not null check ("status" in ('pending', 'revised', 'accepted', 'rejected', 'withdrawn', 'expired')),
  "version" bigint not null,
  "previous_terms" jsonb,
  "responded_by" text,
  "responded_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."transfers" (
  "id" text primary key not null,
  "__v" bigint,
  "listing_id" text not null,
  "batch_id" text not null,
  "match_request_id" text not null,
  "provider_id" text not null,
  "provider_organization_id" text,
  "recipient_id" text not null,
  "recipient_organization_id" text,
  "material_category" text,
  "agreed_weight_kg" numeric not null,
  "transfer_type" text not null check ("transfer_type" in ('barter', 'donation', 'collection', 'reuse', 'recycling', 'upcycling', 'recovery')),
  "status" text not null check ("status" in ('reserved', 'in_progress', 'handed_over', 'collected', 'received', 'processing', 'validated', 'completed', 'cancelled', 'rejected', 'disputed')),
  "agreed_terms" text not null,
  "circular_outcome" text check ("circular_outcome" in ('Collection', 'Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Diversion', 'For assessment')),
  "discrepancy_kg" numeric,
  "discrepancy_reason" text,
  "pending_reward_points" bigint,
  "reward_issued_at" timestamptz,
  "is_demo" boolean,
  "validation_status" text not null check ("validation_status" in ('pending', 'valid', 'flagged', 'excluded')),
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."flow_events" (
  "id" text primary key not null,
  "__v" bigint,
  "batch_id" text not null,
  "listing_id" text,
  "transfer_id" text not null,
  "actor_id" text not null,
  "actor_name" text,
  "facility_id" text,
  "stage" text not null check ("stage" in ('reserved', 'handover', 'collection', 'receipt', 'processing', 'validation', 'completion', 'cancellation', 'rejection', 'dispute')),
  "sequence" bigint not null,
  "event_status" text not null check ("event_status" in ('completed', 'exception', 'reversed')),
  "weight_kg" numeric,
  "weight_status" text check ("weight_status" in ('Estimated', 'Measured', 'Verified')),
  "measurement_id" text,
  "location" text,
  "note" text,
  "occurred_at" timestamptz not null,
  "created_at" timestamptz not null default now()
);

create table if not exists public."collection_receipts" (
  "id" text primary key not null,
  "__v" bigint,
  "transfer_id" text not null,
  "batch_id" text not null,
  "facility_id" text not null,
  "facility_name" text not null,
  "source_user_id" text not null,
  "actor_id" text not null,
  "measurement_id" text not null,
  "weight_kg" numeric not null,
  "weight_status" text not null check ("weight_status" in ('Measured', 'Verified')),
  "measurement_context" text,
  "note" text,
  "created_at" timestamptz not null default now()
);

create table if not exists public."recovery_records" (
  "id" text primary key not null,
  "__v" bigint,
  "transfer_id" text not null,
  "batch_id" text not null,
  "facility_id" text not null,
  "organization_id" text not null,
  "actor_id" text not null,
  "validated_by" text,
  "stage" text check ("stage" in ('Collection', 'Sorting', 'Processing', 'Recovery', 'Rejection')),
  "input_kg" numeric not null,
  "output_kg" numeric not null,
  "rejected_kg" numeric not null,
  "loss_kg" numeric not null,
  "outcome" text not null check ("outcome" in ('Reuse', 'Repair', 'Redistribution', 'Upcycling', 'Recycling', 'Recovery', 'Rejected')),
  "status" text not null check ("status" in ('recorded', 'validated', 'flagged', 'reversed')),
  "is_demo" boolean,
  "note" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."conversations" (
  "id" text primary key not null,
  "__v" bigint,
  "listing_id" text not null,
  "transfer_id" text,
  "participant_ids" text[] not null,
  "participant_names" text[],
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."messages" (
  "id" text primary key not null,
  "__v" bigint,
  "conversation_id" text not null,
  "sender_id" text not null,
  "sender_name" text,
  "body" text not null,
  "read_by" jsonb,
  "created_at" timestamptz not null default now(),
  "edited_at" timestamptz
);

create table if not exists public."notifications" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "type" text not null check ("type" in ('match', 'offer', 'transfer', 'collection', 'event', 'verification', 'reward', 'system')),
  "title" text not null,
  "body" text not null,
  "entity_type" text,
  "entity_id" text,
  "is_read" boolean not null,
  "read_at" timestamptz,
  "created_at" timestamptz not null default now()
);

create table if not exists public."reward_rules" (
  "id" text primary key not null,
  "__v" bigint,
  "title" text not null,
  "points" bigint not null,
  "active" boolean not null,
  "version" bigint not null,
  "eligibility" text not null,
  "created_by" text,
  "approved_by" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."reward_ledger" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "transfer_id" text,
  "rule_id" text,
  "points" bigint not null,
  "entry_type" text not null check ("entry_type" in ('earned', 'reversal', 'redemption', 'adjustment')),
  "title" text not null,
  "idempotency_key" text,
  "created_at" timestamptz not null default now()
);

create table if not exists public."wallet_accounts" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "balance_points" bigint not null,
  "updated_at" timestamptz not null default now()
);

create table if not exists public."reports" (
  "id" text primary key not null,
  "__v" bigint,
  "reporter_id" text not null,
  "target_type" text not null check ("target_type" in ('user', 'organization', 'listing', 'transfer', 'message', 'facility')),
  "target_id" text not null,
  "reason" text not null,
  "details" text not null,
  "status" text not null check ("status" in ('submitted', 'under_review', 'resolved', 'dismissed')),
  "assigned_to" text,
  "resolution" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."support_tickets" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text not null,
  "category" text not null check ("category" in ('support', 'feedback', 'uat', 'privacy', 'account', 'other')),
  "subject" text not null,
  "details" text not null,
  "attachment_uri" text,
  "status" text not null check ("status" in ('open', 'in_progress', 'resolved', 'closed')),
  "assigned_to" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."activity_logs" (
  "id" text primary key not null,
  "__v" bigint,
  "actor_id" text not null,
  "action" text not null,
  "entity_type" text not null,
  "entity_id" text not null,
  "details" jsonb not null,
  "ip_hash" text,
  "occurred_at" timestamptz not null
);

create table if not exists public."configurations" (
  "id" text primary key not null,
  "__v" bigint,
  "key" text not null,
  "version" bigint not null,
  "status" text not null check ("status" in ('draft', 'active', 'retired')),
  "value" jsonb not null,
  "effective_from" timestamptz,
  "updated_by" text not null,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."data_quality_issues" (
  "id" text primary key not null,
  "__v" bigint,
  "entity_type" text not null,
  "entity_id" text not null,
  "rule_code" text not null,
  "severity" text not null check ("severity" in ('info', 'warning', 'critical')),
  "status" text not null check ("status" in ('open', 'acknowledged', 'resolved', 'excluded')),
  "description" text not null,
  "evidence" jsonb,
  "detected_at" timestamptz not null,
  "assigned_to" text,
  "resolved_by" text,
  "resolved_at" timestamptz,
  "resolution_note" text,
  "updated_at" timestamptz not null default now()
);

create table if not exists public."system_interactions" (
  "id" text primary key not null,
  "__v" bigint,
  "user_id" text,
  "organization_id" text,
  "session_id" text,
  "event_name" text not null,
  "client" text not null check ("client" in ('web', 'mobile')),
  "properties" jsonb,
  "privacy_classification" text not null check ("privacy_classification" in ('aggregate', 'pseudonymized', 'restricted')),
  "occurred_at" timestamptz not null
);

create table if not exists public."methodologies" (
  "id" text primary key not null,
  "__v" bigint,
  "name" text not null,
  "type" text not null check ("type" in ('environmental_impact', 'diversion', 'matching', 'predictive', 'prescriptive')),
  "version" text not null,
  "status" text not null check ("status" in ('draft', 'validation', 'approved', 'retired', 'disabled')),
  "definition" jsonb not null,
  "limitations" text,
  "approved_by" text,
  "approved_at" timestamptz,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

create table if not exists public."model_runs" (
  "id" text primary key not null,
  "__v" bigint,
  "methodology_id" text not null,
  "status" text not null check ("status" in ('queued', 'running', 'completed', 'failed', 'invalidated')),
  "target" text not null,
  "input_period" jsonb not null,
  "filters" jsonb,
  "output" jsonb,
  "metrics" jsonb not null,
  "created_by" text not null,
  "created_at" timestamptz not null default now(),
  "completed_at" timestamptz
);

create table if not exists public."report_exports" (
  "id" text primary key not null,
  "__v" bigint,
  "requested_by" text not null,
  "report_type" text not null,
  "scope" jsonb not null,
  "privacy_classification" text check ("privacy_classification" in ('aggregate', 'deidentified', 'restricted')),
  "status" text not null check ("status" in ('requested', 'generated', 'failed', 'expired')),
  "row_count" bigint,
  "file_uri" text,
  "requested_at" timestamptz not null,
  "generated_at" timestamptz,
  "expires_at" timestamptz
);

create unique index if not exists "uq_schema_version" on public."schema_versions" ("version" asc);

create unique index if not exists "uq_users_email" on public."users" ("email" asc);

create unique index if not exists "uq_users_username_present" on public."users" ("username" asc) where "username" is not null;

create index if not exists "idx_users_role_active" on public."users" ("role" asc, "active" asc);

create index if not exists "idx_users_organization_active" on public."users" ("organization_id" asc, "active" asc);

create index if not exists "idx_users_region" on public."users" ("region" asc);

create unique index if not exists "uq_auth_account_security_user" on public."auth_account_security" ("user_id" asc);

create unique index if not exists "uq_organizations_name" on public."organizations" ("name" asc);

create index if not exists "idx_organizations_type_status" on public."organizations" ("type" asc, "status" asc);

create index if not exists "idx_organizations_location" on public."organizations" ("region" asc, "city" asc);

create unique index if not exists "uq_sessions_token_hash" on public."sessions" ("token_hash" asc);

create index if not exists "idx_sessions_user_active" on public."sessions" ("user_id" asc, "revoked_at" asc);

create unique index if not exists "uq_auth_challenges_token_hash" on public."auth_challenges" ("token_hash" asc);

create index if not exists "idx_auth_challenges_user_type_active" on public."auth_challenges" ("user_id" asc, "type" asc, "consumed_at" asc);

create unique index if not exists "uq_auth_rate_limit_subject" on public."auth_rate_limits" ("scope" asc, "subject_hash" asc);

create index if not exists "idx_consent_user_history" on public."consent_history" ("user_id" asc, "created_at" desc);

create unique index if not exists "uq_facilities_organization_name" on public."facilities" ("organization_id" asc, "name" asc);

create index if not exists "idx_facilities_region_type_verified" on public."facilities" ("region" asc, "type" asc, "verification_status" asc);

create unique index if not exists "uq_facility_assignment" on public."facility_assignments" ("user_id" asc, "facility_id" asc, "role" asc);

create index if not exists "idx_collection_events_facility_start" on public."collection_events" ("facility_id" asc, "starts_at" asc);

create index if not exists "idx_collection_events_status_start" on public."collection_events" ("status" asc, "starts_at" asc);

create unique index if not exists "uq_event_registration" on public."event_registrations" ("event_id" asc, "user_id" asc);

create index if not exists "idx_event_registration_user" on public."event_registrations" ("user_id" asc, "created_at" desc);

create index if not exists "idx_batches_source_user" on public."material_batches" ("source_user_id" asc, "created_at" desc);

create index if not exists "idx_batches_source_organization" on public."material_batches" ("source_organization_id" asc, "created_at" desc);

create index if not exists "idx_batches_pathway_weight_period" on public."material_batches" ("intended_pathway" asc, "weight_status" asc, "created_at" desc);

create index if not exists "idx_batches_validation_status" on public."material_batches" ("validation_status" asc, "current_status" asc);

create index if not exists "idx_measurements_batch_time" on public."measurements" ("batch_id" asc, "measured_at" asc);

create index if not exists "idx_measurements_transfer_stage" on public."measurements" ("transfer_id" asc, "stage" asc);

create index if not exists "idx_measurements_facility_time" on public."measurements" ("facility_id" asc, "measured_at" desc);

create index if not exists "idx_measurements_status_time" on public."measurements" ("weight_status" asc, "measured_at" desc);

create unique index if not exists "uq_active_listing_per_batch" on public."listings" ("batch_id" asc) where "status" in ('draft', 'available', 'matched', 'reserved');

create index if not exists "idx_listings_owner_time" on public."listings" ("owner_id" asc, "created_at" desc);

create index if not exists "idx_listings_status_time" on public."listings" ("status" asc, "created_at" desc);

create index if not exists "text_listings_discovery" on public."listings" ("title" asc, "description" asc);

create unique index if not exists "uq_favorite" on public."favorites" ("user_id" asc, "listing_id" asc);

create index if not exists "idx_match_requests_listing_status" on public."match_requests" ("listing_id" asc, "status" asc, "created_at" desc);

create index if not exists "idx_match_requests_requester_time" on public."match_requests" ("requester_id" asc, "created_at" desc);

create unique index if not exists "uq_transfer_match_request" on public."transfers" ("match_request_id" asc);

create index if not exists "idx_transfers_batch_time" on public."transfers" ("batch_id" asc, "created_at" asc);

create index if not exists "idx_transfers_provider_status" on public."transfers" ("provider_id" asc, "status" asc, "updated_at" desc);

create index if not exists "idx_transfers_recipient_status" on public."transfers" ("recipient_id" asc, "status" asc, "updated_at" desc);

create index if not exists "idx_transfers_status_completion" on public."transfers" ("status" asc, "completed_at" desc);

create unique index if not exists "uq_flow_event_sequence" on public."flow_events" ("transfer_id" asc, "sequence" asc);

create index if not exists "idx_flow_events_batch_time" on public."flow_events" ("batch_id" asc, "occurred_at" asc);

create index if not exists "idx_flow_events_stage_time" on public."flow_events" ("stage" asc, "occurred_at" desc);

create unique index if not exists "uq_collection_receipt_transfer" on public."collection_receipts" ("transfer_id" asc);

create index if not exists "idx_collection_receipts_facility_time" on public."collection_receipts" ("facility_id" asc, "created_at" desc);

create index if not exists "idx_collection_receipts_source_time" on public."collection_receipts" ("source_user_id" asc, "created_at" desc);

create index if not exists "idx_recovery_transfer_time" on public."recovery_records" ("transfer_id" asc, "created_at" asc);

create index if not exists "idx_recovery_facility_time" on public."recovery_records" ("facility_id" asc, "created_at" desc);

create index if not exists "idx_recovery_organization_outcome" on public."recovery_records" ("organization_id" asc, "outcome" asc, "created_at" desc);

create index if not exists "idx_recovery_status_time" on public."recovery_records" ("status" asc, "created_at" desc);

create index if not exists "idx_messages_conversation_time" on public."messages" ("conversation_id" asc, "created_at" asc);

create index if not exists "idx_messages_sender_time" on public."messages" ("sender_id" asc, "created_at" desc);

create index if not exists "idx_notifications_user_unread" on public."notifications" ("user_id" asc, "is_read" asc, "created_at" desc);

create index if not exists "idx_reward_rules_active_version" on public."reward_rules" ("active" asc, "version" desc);

create unique index if not exists "uq_reward_ledger_idempotency" on public."reward_ledger" ("idempotency_key" asc);

create index if not exists "idx_reward_ledger_user_time" on public."reward_ledger" ("user_id" asc, "created_at" desc);

create index if not exists "idx_reward_ledger_transfer_rule" on public."reward_ledger" ("transfer_id" asc, "rule_id" asc);

create unique index if not exists "uq_wallet_account_user" on public."wallet_accounts" ("user_id" asc);

create index if not exists "idx_reports_status_time" on public."reports" ("status" asc, "created_at" desc);

create index if not exists "idx_reports_target" on public."reports" ("target_type" asc, "target_id" asc);

create index if not exists "idx_support_status_time" on public."support_tickets" ("status" asc, "created_at" desc);

create index if not exists "idx_support_user_time" on public."support_tickets" ("user_id" asc, "created_at" desc);

create index if not exists "idx_activity_entity_time" on public."activity_logs" ("entity_type" asc, "entity_id" asc, "occurred_at" desc);

create index if not exists "idx_activity_actor_time" on public."activity_logs" ("actor_id" asc, "occurred_at" desc);

create index if not exists "idx_activity_action_time" on public."activity_logs" ("action" asc, "occurred_at" desc);

create unique index if not exists "uq_configuration_version" on public."configurations" ("key" asc, "version" asc);

create unique index if not exists "uq_configuration_active" on public."configurations" ("key" asc) where "status" = 'active';

create index if not exists "idx_quality_entity_rule_status" on public."data_quality_issues" ("entity_type" asc, "entity_id" asc, "rule_code" asc, "status" asc);

create index if not exists "idx_quality_severity_status_time" on public."data_quality_issues" ("severity" asc, "status" asc, "detected_at" desc);

create index if not exists "idx_interactions_event_time" on public."system_interactions" ("event_name" asc, "occurred_at" desc);

create index if not exists "idx_interactions_user_time" on public."system_interactions" ("user_id" asc, "occurred_at" desc);

create index if not exists "idx_interactions_organization_time" on public."system_interactions" ("organization_id" asc, "occurred_at" desc);

create unique index if not exists "uq_methodology_type_version" on public."methodologies" ("type" asc, "version" asc);

create index if not exists "idx_methodology_type_status" on public."methodologies" ("type" asc, "status" asc);

create index if not exists "idx_model_runs_methodology_time" on public."model_runs" ("methodology_id" asc, "created_at" desc);

create index if not exists "idx_model_runs_status_time" on public."model_runs" ("status" asc, "created_at" desc);

create index if not exists "idx_report_exports_requester_time" on public."report_exports" ("requested_by" asc, "requested_at" desc);

create index if not exists "idx_report_exports_status_time" on public."report_exports" ("status" asc, "requested_at" desc);


create or replace function public.consume_auth_challenge(p_token_hash text, p_type text, p_consumed_at timestamptz)
returns setof public.auth_challenges
language sql
security definer
set search_path = public
as $$
  update public.auth_challenges
     set consumed_at = p_consumed_at, updated_at = p_consumed_at
   where id = (
     select id from public.auth_challenges
      where token_hash = p_token_hash and type = p_type and consumed_at is null and expires_at > now()
      order by created_at desc for update skip locked limit 1
   )
  returning *;
$$;

create or replace function public.rotate_auth_session(
  p_id text, p_presented_hash text, p_next_hash text, p_next_csrf_hash text, p_updated_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare current_session public.sessions%rowtype;
begin
  select * into current_session from public.sessions where id = p_id for update;
  if not found or current_session.revoked_at is not null or current_session.expires_at <= now() then return 'invalid'; end if;
  if p_presented_hash = any(current_session.used_token_hashes) then
    update public.sessions set revoked_at = p_updated_at, updated_at = p_updated_at where id = p_id;
    return 'replayed';
  end if;
  if current_session.token_hash <> p_presented_hash then return 'invalid'; end if;
  update public.sessions
     set token_hash = p_next_hash,
         csrf_hash = p_next_csrf_hash,
         used_token_hashes = (current_session.used_token_hashes || p_presented_hash)[greatest(1, cardinality(current_session.used_token_hashes || p_presented_hash) - 19):],
         updated_at = p_updated_at
   where id = p_id;
  return 'rotated';
end;
$$;

create or replace function public.record_auth_rate_limit_failure(
  p_id text, p_scope text, p_subject_hash text, p_now timestamptz,
  p_window_seconds integer, p_max_attempts integer, p_lock_seconds integer
) returns setof public.auth_rate_limits
language plpgsql
security definer
set search_path = public
as $$
declare current_limit public.auth_rate_limits%rowtype;
begin
  select * into current_limit from public.auth_rate_limits where id = p_id for update;
  if not found then
    insert into public.auth_rate_limits(id, scope, subject_hash, attempts, window_started_at, locked_until, expires_at, updated_at)
    values (p_id, p_scope, p_subject_hash, 1, p_now, case when p_max_attempts <= 1 then p_now + make_interval(secs => p_lock_seconds) else null end,
            p_now + make_interval(secs => greatest(p_window_seconds, p_lock_seconds) * 2), p_now)
    returning * into current_limit;
  else
    if current_limit.window_started_at <= p_now - make_interval(secs => p_window_seconds) then
      current_limit.attempts := 1; current_limit.window_started_at := p_now; current_limit.locked_until := null;
    else
      current_limit.attempts := current_limit.attempts + 1;
    end if;
    if current_limit.attempts >= p_max_attempts and (current_limit.locked_until is null or current_limit.locked_until <= p_now) then
      current_limit.locked_until := p_now + make_interval(secs => p_lock_seconds);
    end if;
    update public.auth_rate_limits
       set scope = p_scope, subject_hash = p_subject_hash, attempts = current_limit.attempts,
           window_started_at = current_limit.window_started_at, locked_until = current_limit.locked_until,
           expires_at = p_now + make_interval(secs => greatest(p_window_seconds, p_lock_seconds) * 2), updated_at = p_now
     where id = p_id returning * into current_limit;
  end if;
  return next current_limit;
end;
$$;


alter table public."schema_versions" enable row level security;

revoke all on table public."schema_versions" from anon, authenticated;

grant all on table public."schema_versions" to service_role;

alter table public."users" enable row level security;

revoke all on table public."users" from anon, authenticated;

grant all on table public."users" to service_role;

alter table public."auth_account_security" enable row level security;

revoke all on table public."auth_account_security" from anon, authenticated;

grant all on table public."auth_account_security" to service_role;

alter table public."organizations" enable row level security;

revoke all on table public."organizations" from anon, authenticated;

grant all on table public."organizations" to service_role;

alter table public."sessions" enable row level security;

revoke all on table public."sessions" from anon, authenticated;

grant all on table public."sessions" to service_role;

alter table public."auth_challenges" enable row level security;

revoke all on table public."auth_challenges" from anon, authenticated;

grant all on table public."auth_challenges" to service_role;

alter table public."auth_rate_limits" enable row level security;

revoke all on table public."auth_rate_limits" from anon, authenticated;

grant all on table public."auth_rate_limits" to service_role;

alter table public."consent_history" enable row level security;

revoke all on table public."consent_history" from anon, authenticated;

grant all on table public."consent_history" to service_role;

alter table public."facilities" enable row level security;

revoke all on table public."facilities" from anon, authenticated;

grant all on table public."facilities" to service_role;

alter table public."facility_assignments" enable row level security;

revoke all on table public."facility_assignments" from anon, authenticated;

grant all on table public."facility_assignments" to service_role;

alter table public."collection_events" enable row level security;

revoke all on table public."collection_events" from anon, authenticated;

grant all on table public."collection_events" to service_role;

alter table public."event_registrations" enable row level security;

revoke all on table public."event_registrations" from anon, authenticated;

grant all on table public."event_registrations" to service_role;

alter table public."material_batches" enable row level security;

revoke all on table public."material_batches" from anon, authenticated;

grant all on table public."material_batches" to service_role;

alter table public."measurements" enable row level security;

revoke all on table public."measurements" from anon, authenticated;

grant all on table public."measurements" to service_role;

alter table public."listings" enable row level security;

revoke all on table public."listings" from anon, authenticated;

grant all on table public."listings" to service_role;

alter table public."favorites" enable row level security;

revoke all on table public."favorites" from anon, authenticated;

grant all on table public."favorites" to service_role;

alter table public."match_requests" enable row level security;

revoke all on table public."match_requests" from anon, authenticated;

grant all on table public."match_requests" to service_role;

alter table public."transfers" enable row level security;

revoke all on table public."transfers" from anon, authenticated;

grant all on table public."transfers" to service_role;

alter table public."flow_events" enable row level security;

revoke all on table public."flow_events" from anon, authenticated;

grant all on table public."flow_events" to service_role;

alter table public."collection_receipts" enable row level security;

revoke all on table public."collection_receipts" from anon, authenticated;

grant all on table public."collection_receipts" to service_role;

alter table public."recovery_records" enable row level security;

revoke all on table public."recovery_records" from anon, authenticated;

grant all on table public."recovery_records" to service_role;

alter table public."conversations" enable row level security;

revoke all on table public."conversations" from anon, authenticated;

grant all on table public."conversations" to service_role;

alter table public."messages" enable row level security;

revoke all on table public."messages" from anon, authenticated;

grant all on table public."messages" to service_role;

alter table public."notifications" enable row level security;

revoke all on table public."notifications" from anon, authenticated;

grant all on table public."notifications" to service_role;

alter table public."reward_rules" enable row level security;

revoke all on table public."reward_rules" from anon, authenticated;

grant all on table public."reward_rules" to service_role;

alter table public."reward_ledger" enable row level security;

revoke all on table public."reward_ledger" from anon, authenticated;

grant all on table public."reward_ledger" to service_role;

alter table public."wallet_accounts" enable row level security;

revoke all on table public."wallet_accounts" from anon, authenticated;

grant all on table public."wallet_accounts" to service_role;

alter table public."reports" enable row level security;

revoke all on table public."reports" from anon, authenticated;

grant all on table public."reports" to service_role;

alter table public."support_tickets" enable row level security;

revoke all on table public."support_tickets" from anon, authenticated;

grant all on table public."support_tickets" to service_role;

alter table public."activity_logs" enable row level security;

revoke all on table public."activity_logs" from anon, authenticated;

grant all on table public."activity_logs" to service_role;

alter table public."configurations" enable row level security;

revoke all on table public."configurations" from anon, authenticated;

grant all on table public."configurations" to service_role;

alter table public."data_quality_issues" enable row level security;

revoke all on table public."data_quality_issues" from anon, authenticated;

grant all on table public."data_quality_issues" to service_role;

alter table public."system_interactions" enable row level security;

revoke all on table public."system_interactions" from anon, authenticated;

grant all on table public."system_interactions" to service_role;

alter table public."methodologies" enable row level security;

revoke all on table public."methodologies" from anon, authenticated;

grant all on table public."methodologies" to service_role;

alter table public."model_runs" enable row level security;

revoke all on table public."model_runs" from anon, authenticated;

grant all on table public."model_runs" to service_role;

alter table public."report_exports" enable row level security;

revoke all on table public."report_exports" from anon, authenticated;

grant all on table public."report_exports" to service_role;

revoke all on function public.consume_auth_challenge(text, text, timestamptz) from public, anon, authenticated;

revoke all on function public.rotate_auth_session(text, text, text, text, timestamptz) from public, anon, authenticated;

revoke all on function public.record_auth_rate_limit_failure(text, text, text, timestamptz, integer, integer, integer) from public, anon, authenticated;

grant execute on function public.consume_auth_challenge(text, text, timestamptz) to service_role;

grant execute on function public.rotate_auth_session(text, text, text, text, timestamptz) to service_role;

grant execute on function public.record_auth_rate_limit_failure(text, text, text, timestamptz, integer, integer, integer) to service_role;

insert into public.schema_versions(id, version, status, applied_at, applied_by, notes)
   values ('2.0.0', '2.0.0', 'active', now(), 'supabase-migration', 'BalikTela Supabase/PostgreSQL canonical contract.')
   on conflict (id) do update set status = excluded.status, applied_at = excluded.applied_at, applied_by = excluded.applied_by, notes = excluded.notes;

update public.schema_versions set status = 'superseded' where id <> '2.0.0' and status = 'active';

commit;

