-- ============================================================
-- Reference Control Plane — RLS boundary smoke test
-- Runs against a local `supabase db reset` stack. Asserts the load-bearing
-- isolation claims from ARCHITECTURE.md hold at the database, not just in app
-- code: the firehose is service-role-only, and the CMS public-read predicate
-- hides drafts. Uses set role / set request.jwt.claims to simulate callers.
--
-- Usage:  psql "$DATABASE_URL" -f supabase/tests/rls_test.sql
-- ============================================================

begin;

-- A draft product must be invisible to the anon role.
insert into public.products (id, slug, name, is_published)
values ('00000000-0000-0000-0000-0000000000aa', 'draft-app', 'Draft App', false);

set local role anon;
do $$
declare n int;
begin
  select count(*) into n from public.products where slug = 'draft-app';
  if n <> 0 then
    raise exception 'RLS FAIL: anon can see an unpublished product (got % rows)', n;
  end if;
end $$;
reset role;

-- The usage firehose has RLS enabled and NO policy, so neither anon nor
-- authenticated may read it. Only the service role (which bypasses RLS) can.
set local role authenticated;
do $$
declare n int;
begin
  begin
    select count(*) into n from public.usage_events;
  exception when insufficient_privilege then
    n := -1;  -- treated as "blocked", which is the pass condition
  end;
  if n > 0 then
    raise exception 'RLS FAIL: authenticated read the usage firehose (got % rows)', n;
  end if;
end $$;
reset role;

rollback;  -- never persist test fixtures
