-- Add an institutional category without changing existing records or user roles.
begin;
set local lock_timeout = '5s';
alter table public.organizations drop constraint if exists organizations_type_check;
alter table public.organizations add constraint organizations_type_check check (
  type in ('Research institution', 'Government agency', 'Producer/Retailer',
    'Recycler', 'Upcycler', 'NGO/Community', 'LGU/MRF', 'Collection point', 'School', 'Other')
);
commit;
