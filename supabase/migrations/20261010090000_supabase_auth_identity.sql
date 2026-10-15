alter table public."users"
  alter column "passwordHash" drop not null;

create index if not exists "idx_users_auth_user_id"
  on public."users" ("auth_user_id")
  where "auth_user_id" is not null;

comment on column public."users"."auth_user_id" is
  'Supabase Auth identity. Credentials remain exclusively in auth.users.';

comment on column public."users"."passwordHash" is
  'Legacy compatibility field. Must be null after an account is linked to Supabase Auth.';
