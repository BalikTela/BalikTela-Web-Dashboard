-- Extend the existing service-only read RPC without changing grants or business rows.
DO $$
DECLARE definition text; fragment text;
BEGIN
  definition := pg_get_functiondef('public.get_dashboard_source_snapshot()'::regprocedure);
  IF position('flow_event.weight_kg' IN definition) = 0 THEN
    fragment := '''location'', flow_event.location, ''note'', flow_event.note,';
    IF position(fragment IN definition) = 0 THEN RAISE EXCEPTION 'Review dashboard flow-event projection before migration.'; END IF;
    definition := replace(definition, fragment, fragment || E'\n              ''weight_kg'', flow_event.weight_kg, ''weight_status'', flow_event.weight_status,');
  END IF;
  IF position('recovery.loss_kg' IN definition) = 0 THEN
    fragment := '''rejected_kg'', recovery.rejected_kg,';
    IF position(fragment IN definition) = 0 THEN RAISE EXCEPTION 'Review dashboard recovery projection before migration.'; END IF;
    definition := replace(definition, fragment, fragment || ' ''loss_kg'', recovery.loss_kg,');
  END IF;
  IF position('measurement.measurement_context' IN definition) = 0 THEN
    fragment := '''note'', measurement.note';
    IF position(fragment IN definition) = 0 THEN RAISE EXCEPTION 'Review dashboard measurement projection before migration.'; END IF;
    definition := replace(definition, fragment, fragment || E',\n        ''measurement_context'', measurement.measurement_context, ''facility_id'', measurement.facility_id,\n        ''supersedes_measurement_id'', measurement.supersedes_measurement_id');
  END IF;
  EXECUTE definition;
END;
$$;
