-- Fetch the dashboard's canonical source data in one database round trip.
-- The API still applies role scope, filters, and presentation calculations.

begin;

create or replace function public.get_dashboard_source_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'materialBatches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', batch.id, 'source_user_id', batch.source_user_id,
        'source_organization_id', batch.source_organization_id,
        'material_category', batch.material_category, 'waste_source', batch.waste_source,
        'waste_form', batch.waste_form, 'condition', batch.condition,
        'intended_pathway', batch.intended_pathway, 'final_pathway', batch.final_pathway,
        'declared_weight_kg', batch.declared_weight_kg, 'current_weight_kg', batch.current_weight_kg,
        'weight_status', batch.weight_status, 'secondary_quantity', batch.secondary_quantity,
        'secondary_unit', batch.secondary_unit, 'location', batch.location,
        'current_status', batch.current_status, 'current_custodian_id', batch.current_custodian_id,
        'is_demo', batch.is_demo, 'created_at', batch.created_at, 'updated_at', batch.updated_at
      ) order by batch.id)
      from public.material_batches batch
    ), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', transfer_record.id, 'listing_id', transfer_record.listing_id,
          'batch_id', transfer_record.batch_id, 'match_request_id', transfer_record.match_request_id,
          'provider_id', transfer_record.provider_id, 'recipient_id', transfer_record.recipient_id,
          'material_category', transfer_record.material_category,
          'agreed_weight_kg', transfer_record.agreed_weight_kg, 'status', transfer_record.status,
          'agreed_terms', transfer_record.agreed_terms, 'circular_outcome', transfer_record.circular_outcome,
          'discrepancy_kg', transfer_record.discrepancy_kg,
          'discrepancy_reason', transfer_record.discrepancy_reason,
          'pending_reward_points', transfer_record.pending_reward_points,
          'reward_issued_at', transfer_record.reward_issued_at, 'is_demo', transfer_record.is_demo,
          'created_at', transfer_record.created_at, 'updated_at', transfer_record.updated_at,
          '_handover_weight_kg', (select measurement.weight_kg from public.measurements measurement where measurement.transfer_id = transfer_record.id and measurement.stage = 'handover' order by measurement.measured_at desc limit 1),
          '_receipt_weight_kg', (select measurement.weight_kg from public.measurements measurement where measurement.transfer_id = transfer_record.id and measurement.stage = 'receipt' order by measurement.measured_at desc limit 1),
          '_validation_weight_kg', (select measurement.weight_kg from public.measurements measurement where measurement.transfer_id = transfer_record.id and measurement.stage = 'validation' order by measurement.measured_at desc limit 1),
          '_flow_events', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', flow_event.id, 'stage', flow_event.stage,
              'actor_id', flow_event.actor_id, 'actor_name', flow_event.actor_name,
              'event_status', flow_event.event_status, 'measurement_id', flow_event.measurement_id,
              'location', flow_event.location, 'note', flow_event.note,
              'occurred_at', flow_event.occurred_at
            ) order by flow_event.sequence)
            from public.flow_events flow_event
            where flow_event.transfer_id = transfer_record.id
          ), '[]'::jsonb)
        ) order by transfer_record.id
      )
      from public.transfers transfer_record
    ), '[]'::jsonb),
    'measurements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', measurement.id, 'batch_id', measurement.batch_id,
        'transfer_id', measurement.transfer_id, 'stage', measurement.stage,
        'weight_kg', measurement.weight_kg, 'weight_status', measurement.weight_status,
        'method', measurement.method, 'recorded_by', measurement.recorded_by,
        'verified_by', measurement.verified_by, 'measured_at', measurement.measured_at,
        'note', measurement.note
      ) order by measurement.id)
      from public.measurements measurement
    ), '[]'::jsonb),
    'recoveryRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', recovery.id, 'transfer_id', recovery.transfer_id, 'batch_id', recovery.batch_id,
        'facility_id', recovery.facility_id, 'organization_id', recovery.organization_id,
        'actor_id', recovery.actor_id, 'validated_by', recovery.validated_by,
        'stage', recovery.stage, 'input_kg', recovery.input_kg, 'output_kg', recovery.output_kg,
        'rejected_kg', recovery.rejected_kg, 'outcome', recovery.outcome,
        'status', recovery.status, 'is_demo', recovery.is_demo,
        'note', recovery.note, 'created_at', recovery.created_at
      ) order by recovery.id)
      from public.recovery_records recovery
    ), '[]'::jsonb),
    'listings', coalesce((
      select jsonb_agg(to_jsonb(listing) order by listing.id)
      from public.listings listing
    ), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(to_jsonb(offer_record) order by offer_record.id)
      from public.match_requests offer_record
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', user_record.id, 'auth_user_id', user_record.auth_user_id,
          'email', user_record.email, 'name', user_record.name, 'role', user_record.role,
          'organization_id', user_record.organization_id, 'organization', user_record.organization,
          'city', user_record.city, 'region', user_record.region,
          'active', user_record.active, 'account_status', user_record.account_status,
          'organization_verified', user_record.organization_verified,
          'verification_status', user_record.verification_status,
          'privacy_consent', user_record.privacy_consent, 'scope', user_record.scope,
          'profile', user_record.profile, 'trust_placeholder', user_record.trust_placeholder,
          'created_at', user_record.created_at, '_security', to_jsonb(security_record)
        )
        order by user_record.id
      )
      from public.users user_record
      left join public.auth_account_security security_record on security_record.user_id = user_record.id
    ), '[]'::jsonb),
    'organizations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', organization.id, 'name', organization.name, 'type', organization.type,
        'verification_status', organization.verification_status, 'status', organization.status,
        'record_label', organization.record_label, 'region', organization.region,
        'city', organization.city, 'service_areas', organization.service_areas,
        'accepted_materials', organization.accepted_materials,
        'contact_email', organization.contact_email
      ) order by organization.id)
      from public.organizations organization
    ), '[]'::jsonb),
    'facilities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', facility.id, 'organization_id', facility.organization_id,
        'name', facility.name, 'type', facility.type, 'city', facility.city,
        'region', facility.region, 'service_areas', facility.service_areas,
        'categories', facility.categories, 'monthly_capacity_kg', facility.monthly_capacity_kg,
        'current_intake_kg', facility.current_intake_kg, 'status', facility.status,
        'verification_status', facility.verification_status, 'is_demo', facility.is_demo
      ) order by facility.id)
      from public.facilities facility
    ), '[]'::jsonb),
    'walletEntries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', entry.id, 'user_id', entry.user_id, 'transfer_id', entry.transfer_id,
        'points', entry.points, 'entry_type', entry.entry_type,
        'title', entry.title, 'created_at', entry.created_at
      ) order by entry.id)
      from public.reward_ledger entry
    ), '[]'::jsonb),
    'systemInteractions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', interaction.id, 'user_id', interaction.user_id,
        'organization_id', interaction.organization_id, 'session_id', interaction.session_id,
        'event_name', interaction.event_name, 'client', interaction.client,
        'properties', interaction.properties,
        'privacy_classification', interaction.privacy_classification,
        'occurred_at', interaction.occurred_at
      ) order by interaction.id)
      from public.system_interactions interaction
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_dashboard_source_snapshot() from public, anon, authenticated;
grant execute on function public.get_dashboard_source_snapshot() to service_role;

commit;
