-- ============================================================
-- Reference Control Plane — 0020 explicit public-read grants
--
-- RLS decides which ROWS a role sees, but a role must first hold the base table
-- SELECT privilege to reach the table at all. The public-read tables below all
-- have `..._public_read` policies `to anon, authenticated`, yet the schema never
-- granted those roles SELECT explicitly — it relied on Supabase's default
-- privileges, which only cover tables created by the role that set the default.
-- In the local CLI stack that grant is missing (a `set role anon; select from
-- products` fails with "permission denied"), so the public-read policies are
-- effectively unreachable there, and the posture differs from hosted.
--
-- Make it explicit and uniform: grant SELECT to anon + authenticated on exactly
-- the tables meant to be publicly readable. RLS still filters rows
-- (products_public_read, posts_public_read, releases_public_read), so this only
-- lets the roles reach the table — it exposes no row a policy wouldn't. The
-- staff/ingestion tables (users, employee_roles, api_keys, usage_*,
-- ingest_nonces) are deliberately omitted: they have no public-read policy and
-- must stay unreachable by anon. Idempotent — a no-op where the grant already
-- exists.
-- ============================================================

grant select on table
  public.products,
  public.posts,
  public.releases
to anon, authenticated;
