-- Change only web display ranks. Preserve points, pagination, permissions and mobile functions.
begin;
set local lock_timeout = '5s';
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.dashboard_rewards(text,integer,integer)'::regprocedure);
  if position('dense_rank() OVER (ORDER BY points DESC)' in definition) = 0 then
    if position('rank() OVER (ORDER BY points DESC)' in definition) = 0 then
      raise exception 'Review dashboard rewards ranking before migration.';
    end if;
    definition := replace(definition, 'rank() OVER (ORDER BY points DESC)', 'dense_rank() OVER (ORDER BY points DESC)');
    execute definition;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
