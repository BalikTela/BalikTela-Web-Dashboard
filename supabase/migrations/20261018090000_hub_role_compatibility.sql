-- Compatibility only: no account creation, role conversion, seeding or table changes.
CREATE OR REPLACE FUNCTION public.mobile_can_weigh(p_user public.users)
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(p_user.organization_verified
    AND p_user.role IN ('Recycler', 'BalikTela Hub')
    AND p_user.active AND p_user.account_status = 'active', false);
$$;
REVOKE ALL ON FUNCTION public.mobile_can_weigh(public.users) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mobile_weighing_hubs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.mobile_actor();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id', u.id, 'name', u.name, 'location', u.location,
    'bio', u.bio, 'organization', u.organization) ORDER BY u.name, u.id)
    FROM public.users u WHERE public.mobile_can_weigh(u)), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.mobile_weighing_hubs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mobile_weighing_hubs() TO authenticated;

-- Preserve the installed workflow (including disposal/remainder protections).
-- Only replace the old role predicate in the assigned-Hub validation.
DO $$
DECLARE definition text;
BEGIN
  definition := pg_get_functiondef('public.mobile_mutate(text,text,jsonb,text)'::regprocedure);
  IF position('u.role=''Recycler'' AND u.organization_verified' IN definition) > 0 THEN
    definition := replace(definition,
      'u.role=''Recycler'' AND u.organization_verified', 'public.mobile_can_weigh(u)');
    EXECUTE definition;
  ELSIF position('public.mobile_can_weigh(u)' IN definition) = 0 THEN
    RAISE EXCEPTION 'Unknown assigned-Hub contract. Review mobile_mutate before applying this migration.';
  END IF;
END;
$$;
