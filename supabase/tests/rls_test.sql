-- ============================================================
-- Reference Control Plane — RLS boundary smoke test
-- Runs against a local `supabase db reset` stack. Asserts the load-bearing
-- isolation claims from ARCHITECTURE.md hold at the database, not just in app
-- code: the firehose is service-role-only, the CMS public-read predicates hide
-- drafts and soft-deleted rows, and anon cannot write. Uses set role to
-- simulate callers. Companion files cover base-table grants (grants_test.sql),
-- privileged-RPC lockdown (function_privileges_test.sql), and the public-form
-- rate limiter (rate_limit_test.sql).
--
-- Usage:  psql "$DATABASE_URL" -f supabase/tests/rls_test.sql
-- ============================================================

begin;

-- ── Fixtures (owner; RLS bypassed). Fixed UUIDs keep the assertions
--    independent of seed data; the rollback discards everything. ─────────────
insert into public.products (id, slug, name, is_published)
values ('00000000-0000-0000-0000-0000000000aa', 'draft-app', 'Draft App', false);

insert into public.posts (id, slug, title, is_published, deleted_at) values
  ('00000000-0000-0000-0000-0000000000b1', 'rls-published', 'Published', true,  null),
  ('00000000-0000-0000-0000-0000000000b2', 'rls-draft',     'Draft',     false, null),
  -- published but soft-deleted → anon must NOT see (exercises `deleted_at is null`)
  ('00000000-0000-0000-0000-0000000000b3', 'rls-pub-del',   'Pub Deleted', true, now());

-- ── As the anonymous web visitor ───────────────────────────────────────────
set local role anon;

-- A draft product must be invisible to the anon role.
do $$
declare n int;
begin
  select count(*) into n from public.products where slug = 'draft-app';
  if n <> 0 then
    raise exception 'RLS FAIL: anon can see an unpublished product (got % rows)', n;
  end if;
end $$;

-- posts_public_read: is_published AND deleted_at is null. A weakened predicate
-- (leaking drafts or soft-deleted rows) fails here even though the policy
-- still EXISTS — this exercises the predicate itself.
do $$
begin
  if not exists (select 1 from public.posts where slug = 'rls-published') then
    raise exception 'RLS FAIL: anon cannot see a published post';
  end if;
  if exists (select 1 from public.posts where slug = 'rls-draft') then
    raise exception 'RLS FAIL: anon can see a draft post';
  end if;
  if exists (select 1 from public.posts where slug = 'rls-pub-del') then
    raise exception 'RLS FAIL: anon can see a soft-deleted post';
  end if;
end $$;

-- Writes from the anon role are denied (every public write path is a
-- server action or service-role edge function, never a direct anon insert).
-- Both an RLS-policy violation and a missing table grant raise SQLSTATE 42501,
-- so either way the write is refused.
do $$
begin
  begin
    insert into public.products (slug, name) values ('anon-prod', 'Anon Product');
    raise exception 'RLS FAIL: anon inserted a product directly';
  exception when insufficient_privilege then
    null;  -- blocked, which is the pass condition
  end;
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
