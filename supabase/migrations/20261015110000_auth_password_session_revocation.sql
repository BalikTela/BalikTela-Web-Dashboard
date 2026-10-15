begin;

create or replace function public.revoke_web_sessions_on_password_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Invitation confirmation may create a provider-generated hash, not a user-selected password.
  if new.invited_at is not null and old.email_confirmed_at is null and new.email_confirmed_at is not null then
    return new;
  end if;
  update public.sessions session set revoked_at = now(), updated_at = now()
  from public.users profile
  where profile.auth_user_id = new.id and session.user_id = profile.id and session.revoked_at is null;
  return new;
end;
$$;

revoke all on function public.revoke_web_sessions_on_password_change() from public, anon, authenticated;
drop trigger if exists baliktela_auth_password_sessions on auth.users;
create trigger baliktela_auth_password_sessions
  after update of encrypted_password on auth.users
  for each row when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.revoke_web_sessions_on_password_change();

commit;
