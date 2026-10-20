-- Keep monthly handling targets and old intake counters intact. No inferred backfill.
begin;
set local lock_timeout = '5s';
alter table public.facilities add column if not exists storage_capacity_kg numeric
  constraint facilities_storage_capacity_positive check (storage_capacity_kg is null or (storage_capacity_kg >= 0.001 and storage_capacity_kg < 'Infinity'::numeric));
comment on column public.facilities.storage_capacity_kg is 'Configured maximum physical textile storage in kilograms; independent of monthly throughput. NULL means not configured.';

-- Extend only the facilities projection in the existing service-only snapshot.
do $$
declare definition text; fragment text;
begin
  definition := pg_get_functiondef('public.get_dashboard_source_snapshot()'::regprocedure);
  if position('facility.storage_capacity_kg' in definition) = 0 then
    fragment := '''current_intake_kg'', facility.current_intake_kg,';
    if position(fragment in definition) = 0 then raise exception 'Review dashboard facilities projection before migration.'; end if;
    definition := replace(definition, fragment, fragment || ' ''storage_capacity_kg'', facility.storage_capacity_kg,');
    execute definition;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
