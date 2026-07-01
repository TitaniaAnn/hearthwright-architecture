-- ============================================================
-- Reference Control Plane — 0005 releases
-- Self-hosted download artifacts. Files live in the PRIVATE `releases` storage
-- bucket; this table is the authoritative metadata + download counter. Public
-- downloads stream through src/app/api/downloads/[version]/route.ts, which bumps
-- the counter via the atomic increment_download() RPC and 307-redirects to a
-- short-lived signed URL. The bucket stays private so every download is counted
-- and the published checksum is authoritative.
-- ============================================================

create table public.releases (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  version       text not null,
  channel       text not null default 'stable',  -- stable | beta
  storage_path  text not null,                   -- path within the private bucket
  file_name     text not null,
  checksum_sha256 text,
  is_published  boolean not null default false,
  download_count bigint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, version, channel)
);

create index releases_lookup_idx on public.releases (product_id, version, is_published);

create trigger releases_set_updated_at
  before update on public.releases
  for each row execute function public.update_updated_at();

-- ── Atomic counter ──────────────────────────────────────────────────────
-- One statement, no read-modify-write race. The download route calls this via
-- the service role (RLS is bypassed) for every served artifact. Preferring an
-- RPC over "select count, then update count+1" is the same discipline used for
-- every balance/counter mutation in the wider codebase: the database does the
-- increment atomically so two concurrent downloads can't lose a count.
create or replace function public.increment_download(release_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.releases
     set download_count = download_count + 1,
         updated_at = now()
   where id = release_id;
$$;

-- ── RLS ────────────────────────────────────────────────────────────────
-- Public reads published release METADATA (version list, checksum). The actual
-- file is never exposed by a public policy — it leaves only through a signed
-- URL minted server-side. Admins manage releases.
alter table public.releases enable row level security;

create policy releases_public_read on public.releases
  for select to anon, authenticated
  using (is_published or public.is_admin());

create policy releases_admin_write on public.releases
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
