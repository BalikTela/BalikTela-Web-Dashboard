-- Only future explicit Hub inserts change role. Existing Auth-linked profiles
-- retain their role through the original ON CONFLICT update clause.
DO $$
DECLARE definition text; fragment text;
BEGIN
  definition := pg_get_functiondef('public.sync_auth_user_profile()'::regprocedure);
  IF position('CASE WHEN NEW.raw_user_meta_data->>''account_type''=''hub'' THEN ''BalikTela Hub''' IN definition) = 0 THEN
    fragment := 'CASE WHEN requested_hub THEN ''Recycler'' ELSE ''Consumer'' END';
    IF position(fragment IN definition) = 0 THEN RAISE EXCEPTION 'Review signup role mapping before applying Hub alignment.'; END IF;
    definition := replace(definition, fragment,
      'CASE WHEN NEW.raw_user_meta_data->>''account_type''=''hub'' THEN ''BalikTela Hub'' WHEN requested_hub THEN ''Recycler'' ELSE ''Consumer'' END');
    fragment := 'CASE WHEN requested_hub THEN ''Recycler / Upcycler'' ELSE ''Consumer / Beneficiary'' END';
    IF position(fragment IN definition) = 0 THEN RAISE EXCEPTION 'Review signup stakeholder mapping before applying Hub alignment.'; END IF;
    definition := replace(definition, fragment,
      'CASE WHEN NEW.raw_user_meta_data->>''account_type''=''hub'' THEN ''Collection personnel'' WHEN requested_hub THEN ''Recycler / Upcycler'' ELSE ''Consumer / Beneficiary'' END');
    EXECUTE definition;
  END IF;
END;
$$;
