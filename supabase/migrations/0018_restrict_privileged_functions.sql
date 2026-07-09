-- ============================================================
-- Reference Control Plane — 0018 restrict privileged functions
--
-- Postgres grants EXECUTE to PUBLIC by default, and PostgREST exposes public
-- schema functions as RPC (POST /rest/v1/rpc/<fn>). These SECURITY DEFINER
-- functions do privileged, RLS-bypassing work and are only ever invoked by the
-- service role (the ingestion/maintenance edge functions) or by pg_cron (which
-- runs as the owner, postgres). Left on the default PUBLIC grant,
-- anon/authenticated could call them directly to:
--   * sweep_ingest_nonces  → purge replay nonces, defeating replay protection
--   * rollup_usage         → trigger a full usage_events scan/aggregate on demand
--
-- Revoke the default PUBLIC grant and re-grant only to service_role. (postgres
-- owns the functions, so pg_cron keeps working.) The identity helpers
-- is_admin()/is_employee()/app_user_id() are deliberately NOT touched — RLS
-- policies call them as anon/authenticated, so they must keep EXECUTE.
-- increment_download(uuid) is also left callable: it is the public download
-- counter and exposes nothing (see 0005).
-- ============================================================

revoke execute on function public.sweep_ingest_nonces() from public;
grant execute on function public.sweep_ingest_nonces() to service_role;

revoke execute on function public.rollup_usage(date) from public;
grant execute on function public.rollup_usage(date) to service_role;
