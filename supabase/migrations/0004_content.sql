-- ============================================================
-- Reference Control Plane — 0004 content (posts)
-- A product/company blog as a worked example of the CMS write path. The admin
-- server action in src/app/admin/posts/actions.ts mutates this table; the
-- public marketing site reads published rows. Same public-read-published /
-- admin-write RLS shape as products (0003).
-- ============================================================

create table public.posts (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  excerpt        text,
  body_md        text,
  tags           text[] not null default '{}',
  product_id     uuid references public.products(id) on delete set null,
  author_user_id uuid references public.users(id) on delete set null,
  is_published   boolean not null default false,
  published_at   timestamptz,
  deleted_at     timestamptz,                 -- soft delete
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index posts_published_idx on public.posts (is_published, published_at);

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.update_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────
-- Public reads live, non-deleted rows; admins manage everything. The soft
-- delete (deleted_at) is folded into the public predicate so a delete hides
-- the row from the marketing site without losing the audit trail.
alter table public.posts enable row level security;

create policy posts_public_read on public.posts
  for select to anon, authenticated
  using ((is_published and deleted_at is null) or public.is_admin());

create policy posts_admin_write on public.posts
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
