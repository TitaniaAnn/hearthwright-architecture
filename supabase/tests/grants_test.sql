-- ============================================================
-- Reference Control Plane — base-table grants & RLS coverage test
-- Guards migrations 0020–0022. RLS decides which ROWS a role sees, but a role
-- must first hold the base table privilege to REACH the table — and Supabase's
-- hosted default privileges differ from a local CLI stack, so the grants must
-- be explicit for the posture to be uniform. Asserts:
--   * anon holds SELECT on exactly the public-read tables, nothing sensitive;
--   * authenticated can reach the identity tables (requireRole's lookup);
--   * service_role can reach tables at all (it bypasses RLS but not grants);
--   * every base table in public has RLS enabled (the classic new-table leak).
--
-- Usage:  psql "$DATABASE_URL" -f supabase/tests/grants_test.sql
-- ============================================================

begin;

-- ── anon reaches the public-read tables (0020)… ────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['products', 'posts', 'releases'] loop
    if not has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'GRANTS FAIL: anon cannot reach public.% (public-read grant missing)', t;
    end if;
  end loop;
end $$;

-- ── …and nothing else. No public-read policy → no anon grant. ──────────────
do $$
declare t text;
begin
  foreach t in array array['users', 'employee_roles', 'api_keys',
                           'usage_events', 'ingest_nonces', 'rate_limit_hits'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'GRANTS FAIL: anon can reach public.% (must stay ungranted)', t;
    end if;
  end loop;
end $$;

-- anon is read-only even where it can reach: no INSERT anywhere.
do $$
begin
  if has_table_privilege('anon', 'public.products', 'INSERT') then
    raise exception 'GRANTS FAIL: anon holds INSERT on products';
  end if;
end $$;

-- ── authenticated can reach the identity tables (0021), so requireRole()'s
--    role lookup works — RLS still scopes the rows. ──────────────────────────
do $$
begin
  if not has_table_privilege('authenticated', 'public.users', 'SELECT') then
    raise exception 'GRANTS FAIL: authenticated cannot reach users (role lookup breaks)';
  end if;
  if not has_table_privilege('authenticated', 'public.employee_roles', 'SELECT') then
    raise exception 'GRANTS FAIL: authenticated cannot reach employee_roles (role lookup breaks)';
  end if;
end $$;

-- ── service_role bypasses RLS but still needs the base grant (0022). A lost
--    grant surfaces as SQLSTATE 42501 in the health probe / download route. ──
set local role service_role;
do $$
declare n int;
begin
  select count(*) into n from public.products;   -- raises 42501 without 0022
  insert into public.products (slug, name) values ('svc-grant-test', 'Svc Grant Test');
end $$;
reset role;

-- ── Blanket RLS coverage: every base table in public must have RLS enabled —
--    forgetting it on a new table is the classic Supabase data-leak footgun. ─
do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'          -- ordinary base tables only
    and not c.relrowsecurity;    -- RLS not enabled
  if offenders is not null then
    raise exception 'GRANTS FAIL: tables without RLS: %', offenders;
  end if;
end $$;

rollback;  -- never persist test fixtures
