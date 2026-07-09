-- ============================================================
-- Reference Control Plane — privileged RPC lockdown test
-- Guards migrations 0018/0019. The SECURITY DEFINER functions that do
-- RLS-bypassing writes/jobs must not be callable by the PostgREST-exposed
-- anon/authenticated roles — only by the service role (edge functions, server
-- actions) and the owner (pg_cron).
--
-- Usage:  psql "$DATABASE_URL" -f supabase/tests/function_privileges_test.sql
-- ============================================================

begin;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.sweep_ingest_nonces()',
    'public.rollup_usage(date)',
    'public.rate_limit_check(text,integer,integer)',
    'public.sweep_rate_limits()'
  ] loop
    if has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FN-PRIV FAIL: anon can execute %', fn;
    end if;
    if has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'FN-PRIV FAIL: authenticated can execute %', fn;
    end if;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'FN-PRIV FAIL: service_role cannot execute % (edge/actions depend on it)', fn;
    end if;
  end loop;
end $$;

-- The identity helpers must STAY callable — RLS policies evaluate them as
-- anon/authenticated; revoking these would break every policy at once.
do $$
declare fn text;
begin
  foreach fn in array array['public.is_admin()', 'public.is_employee()', 'public.app_user_id()'] loop
    if not has_function_privilege('anon', fn, 'EXECUTE') then
      raise exception 'FN-PRIV FAIL: anon lost execute on % (RLS policies call it)', fn;
    end if;
  end loop;
end $$;

-- Sanity: the intentionally-public counter RPC stays anon-callable (0005/0018).
do $$
begin
  if not has_function_privilege('anon', 'public.increment_download(uuid)', 'EXECUTE') then
    raise exception 'FN-PRIV FAIL: anon lost execute on increment_download (intended to stay public)';
  end if;
end $$;

rollback;
