-- ============================================================
-- Reference Control Plane — 0003 products
-- The product catalog the marketing site links to and everything else
-- (usage events, posts, releases, API keys) is scoped by.
-- Public reads published rows only; admins manage everything.
-- ============================================================

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  name         text not null,
  tagline      text,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index products_published_idx on public.products (is_published);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.update_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────
-- The public-read-published / admin-write pair is the workhorse policy shape
-- for every CMS-style table in this architecture (products, posts, releases,
-- status, ...). Anonymous visitors see only published rows; admins see and
-- mutate everything. Drafts never leak because the SELECT predicate gates on
-- is_published for the anon/authenticated roles.
alter table public.products enable row level security;

create policy products_public_read on public.products
  for select to anon, authenticated
  using (is_published or public.is_admin());

create policy products_admin_write on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
