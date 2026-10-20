-- Read-only admin adapter for web sessions. Mobile publication and wallet rules stay unchanged.
CREATE OR REPLACE FUNCTION public.dashboard_rewards(p_view text DEFAULT 'leaderboard', p_page integer DEFAULT 1, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO '' AS $$
DECLARE result jsonb;
BEGIN
  IF p_view NOT IN ('leaderboard', 'activity') OR p_view IS NULL THEN
    RAISE EXCEPTION 'Invalid rewards view' USING ERRCODE = '22023';
  END IF;
  WITH eligible AS MATERIALIZED (
    SELECT id, name FROM public.users WHERE active AND role IN ('Consumer')
  ), totals AS (
    SELECT u.id, u.name, greatest(0, coalesce(sum(r.points), 0))::bigint AS points
    FROM eligible u LEFT JOIN public.reward_ledger r
      ON r.user_id = u.id AND r.entry_type IN ('earned', 'reversal', 'adjustment')
    GROUP BY u.id, u.name
  ), ranked AS MATERIALIZED (
    SELECT *, rank() OVER (ORDER BY points DESC) AS rank FROM totals
  ), activity AS MATERIALIZED (
    SELECT r.id, r.user_id AS "userId", u.name, r.title, r.points,
      r.entry_type AS "entryType", r.created_at AS "createdAt"
    FROM public.reward_ledger r JOIN eligible u ON u.id = r.user_id
    WHERE p_view = 'activity'
  ), counts AS (
    SELECT CASE WHEN p_view = 'leaderboard' THEN (SELECT count(*) FROM ranked)
      ELSE (SELECT count(*) FROM activity) END AS total,
      least(100, greatest(1, coalesce(p_limit, 20))) AS size
  ), bounds AS (
    SELECT *, greatest(1, ceil(total::numeric / size)::integer) AS pages FROM counts
  ), paging AS (
    SELECT *, least(pages, greatest(1, coalesce(p_page, 1))) AS page FROM bounds
  ), leaderboard_page AS (
    SELECT * FROM ranked WHERE p_view = 'leaderboard' ORDER BY points DESC, lower(name), id
    LIMIT (SELECT size FROM paging) OFFSET (SELECT (page::bigint - 1) * size FROM paging)
  ), activity_page AS (
    SELECT * FROM activity ORDER BY "createdAt" DESC, id DESC
    LIMIT (SELECT size FROM paging) OFFSET (SELECT (page::bigint - 1) * size FROM paging)
  )
  SELECT jsonb_build_object(
    'view', p_view,
    'summary', jsonb_build_object('consumers', (SELECT count(*) FROM ranked),
      'consumersWithPoints', (SELECT count(*) FROM ranked WHERE points > 0),
      'accumulatedPoints', (SELECT coalesce(sum(points), 0) FROM ranked)),
    'leaderboard', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.points DESC, lower(p.name), p.id) FROM leaderboard_page p), '[]'::jsonb),
    'activity', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."createdAt" DESC, p.id DESC) FROM activity_page p), '[]'::jsonb),
    'total', total, 'page', page, 'pages', pages, 'limit', size
  ) INTO result FROM paging;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_rewards(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_rewards(text, integer, integer) TO service_role;
NOTIFY pgrst, 'reload schema';
