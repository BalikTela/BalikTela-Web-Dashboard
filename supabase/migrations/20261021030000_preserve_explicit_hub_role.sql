-- Explicit Hub roles are supported by the users constraint and mobile Hub RPCs.
-- Preserve them rather than silently expanding them into Recycler accounts.
begin;
create or replace function public.normalize_recycler_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.role = 'BalikTela Hub' then
    NEW.stakeholder := 'Collection personnel';
  elsif NEW.role = 'LGU/Collection Point' and NEW.stakeholder = 'Collection personnel' then
    -- Keep the unrelated legacy LGU compatibility rule unchanged.
    NEW.role := 'Recycler';
    NEW.stakeholder := 'Recycler / Upcycler';
  end if;
  return NEW;
end;
$$;
commit;
