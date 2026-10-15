begin;

create or replace function public.apply_management_mutations(p_mutations jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mutation jsonb;
  v_table text;
  record_id text;
  current_row jsonb;
  next_row jsonb;
  columns_sql text;
  v_column text;
  had_administrator boolean;
begin
  if jsonb_typeof(p_mutations) <> 'array' or jsonb_array_length(p_mutations) > 200 then
    raise exception 'Invalid mutation batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(14092026);
  had_administrator := exists(select 1 from public.users where role='Administrator' and account_status='active');
  for mutation in select value from jsonb_array_elements(p_mutations) loop
    v_table := mutation ->> 'table';
    record_id := mutation ->> 'id';
    if v_table <> all(array['users','auth_account_security','organizations','facilities',
      'material_batches','measurements','listings','match_requests','transfers','flow_events',
      'recovery_records','reward_ledger','activity_logs','configurations','conversations','messages'])
      or v_table is null or record_id is null then
      raise exception 'Unsupported management table' using errcode = '22023';
    end if;
    if mutation ->> 'mode' not in ('insert','update','upsert') then
      raise exception 'Unsupported management operation' using errcode = '22023';
    end if;
    execute format('select to_jsonb(t) from public.%I t where id = $1 for update', v_table)
      into current_row using record_id;
    if v_table='auth_account_security' and mutation ->> 'mode'='upsert' then
      select to_jsonb(t) into current_row from public.auth_account_security t
        where user_id=mutation -> 'values' ->> 'user_id' for update;
      if current_row is not null then record_id:=current_row ->> 'id'; end if;
    end if;
    if mutation ->> 'mode' = 'insert' and current_row is not null then
      raise exception 'Record already exists' using errcode = '23505';
    end if;
    if mutation ->> 'mode' = 'update' and (current_row is null or not current_row @> coalesce(mutation -> 'expected','{}'::jsonb)) then
      -- A business conflict must not trigger PostgREST's serialization retries.
      raise exception 'Concurrent record change' using errcode = 'PT409';
    end if;
    for v_column in select jsonb_object_keys(mutation -> 'values') loop
      if v_column = 'id' or not exists(select 1 from information_schema.columns
        where table_schema = 'public' and information_schema.columns.table_name = v_table
          and information_schema.columns.column_name = v_column) then
        raise exception 'Unsupported management field' using errcode = '22023';
      end if;
    end loop;
    next_row := public.management_json_merge(coalesce(current_row,'{}'::jsonb), mutation -> 'values')
      || jsonb_build_object('id', record_id);
    select string_agg(format('%I', key), ',') into columns_sql
      from jsonb_object_keys(case when current_row is null then next_row else mutation -> 'values' end) as key;
    if current_row is null then
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
        v_table, columns_sql, columns_sql, v_table) using next_row;
    elsif columns_sql is not null then
      execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where id = $2',
        v_table, columns_sql, columns_sql, v_table) using next_row, record_id;
    end if;
  end loop;
  if had_administrator and not exists(select 1 from public.users where role='Administrator' and account_status='active') then
    raise exception 'At least one active administrator must remain' using errcode='PT409';
  end if;
end;
$$;

revoke all on function public.apply_management_mutations(jsonb) from public,anon,authenticated;
grant execute on function public.apply_management_mutations(jsonb) to service_role;
notify pgrst, 'reload schema';
commit;
