begin;

create or replace function public.sync_auth_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile_id text;
  invitation_confirmation boolean := false;
  password_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    invitation_confirmation := new.invited_at is not null
      and old.email_confirmed_at is null and new.email_confirmed_at is not null;
    password_changed := new.encrypted_password is distinct from old.encrypted_password
      and not invitation_confirmation;
  else
    password_changed := new.invited_at is null and nullif(new.encrypted_password, '') is not null;
  end if;
  profile_id := substr(md5(new.id::text), 1, 24);
  insert into public.users(id, auth_user_id, email, name, username, role,
    active, stakeholder, organization_verified, account_status, privacy_consent,
    research_consent, notification_enabled, scope, bio, location, phone, avatar_uri)
  values (profile_id, new.id, lower(new.email),
    left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), 'Participant'), 100),
    'user_' || profile_id, 'Consumer', true, 'Consumer / Beneficiary',
    false, 'active', false, false, true, '{}'::jsonb,
    left(coalesce(new.raw_user_meta_data ->> 'bio', ''), 2000),
    left(coalesce(new.raw_user_meta_data ->> 'location', ''), 300),
    left(coalesce(new.raw_user_meta_data ->> 'phone', ''), 40), '')
  on conflict(auth_user_id) do update set email = excluded.email, updated_at = now()
  returning id into profile_id;
  insert into public.auth_account_security(id, user_id, email_verified_at, password_changed_at)
  values (profile_id, profile_id, new.email_confirmed_at, case when password_changed then now() else null end)
  on conflict(user_id) do update set
    email_verified_at = excluded.email_verified_at,
    password_changed_at = case when invitation_confirmation then null
      when password_changed then now() else public.auth_account_security.password_changed_at end,
    updated_at = now();
  return new;
end;
$$;

-- Keep the existing shared profile IDs and role assignments; never trust metadata for roles.
drop trigger if exists baliktela_auth_profile on auth.users;
create trigger baliktela_auth_profile
  after insert or update of email, email_confirmed_at, encrypted_password on auth.users
  for each row when (new.email is not null) execute function public.sync_auth_user_profile();

-- Previously generated, still-unconfirmed invitations have not initialized a password.
update public.auth_account_security security set password_changed_at = null, updated_at = now()
from public.users profile join auth.users identity on identity.id = profile.auth_user_id
where security.user_id = profile.id and identity.invited_at is not null
  and identity.email_confirmed_at is null and security.password_changed_at is not null;

notify pgrst, 'reload schema';
commit;
