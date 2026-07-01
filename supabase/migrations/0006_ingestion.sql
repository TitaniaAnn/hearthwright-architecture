-- ============================================================
-- Reference Control Plane — 0006 ingestion
-- Per-product API keys, the raw usage-event firehose, and a nonce table for
-- replay protection. Edge functions read/write these via the service role;
-- nothing here is reachable by anon or authenticated roles directly.
-- ============================================================

-- ── API keys ────────────────────────────────────────────────────────────
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,                 -- shown in the UI, e.g. rcp_live_AbCd
  key_hash     text not null unique,          -- sha-256 hex of the full key
  scopes       text[] not null default '{}',  -- usage|error|feedback:write|blog:read|wiki:write|wiki:read
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_by   uuid references public.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index api_keys_product_idx on public.api_keys (product_id);

create trigger api_keys_set_updated_at
  before update on public.api_keys
  for each row execute function public.update_updated_at();

-- ── Usage events (firehose) ──────────────────────────────────────────────
create table public.usage_events (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  event_name  text not null,
  anon_id     text,            -- hashed client id, no PII
  session_id  text,
  platform    text,
  app_version text,
  properties  jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);

create index usage_events_product_time_idx on public.usage_events (product_id, occurred_at);

-- ── Replay-protection nonces ─────────────────────────────────────────────
create table public.ingest_nonces (
  id         uuid primary key default gen_random_uuid(),
  api_key_id uuid not null references public.api_keys(id) on delete cascade,
  nonce      text not null,
  seen_at    timestamptz not null default now(),
  unique (api_key_id, nonce)
);

create index ingest_nonces_key_time_idx on public.ingest_nonces (api_key_id, seen_at);

-- ── RLS ────────────────────────────────────────────────────────────────
-- api_keys: admin-only management. Edge functions read via service role.
alter table public.api_keys enable row level security;
create policy api_keys_admin_all on public.api_keys
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- usage_events + ingest_nonces: NO anon/authenticated access at all. RLS is
-- enabled with no policies, so only the service role (which bypasses RLS) can
-- touch them. The dashboard reads rolled-up aggregates, never the firehose.
alter table public.usage_events enable row level security;
alter table public.ingest_nonces enable row level security;

-- Sweep nonces older than 2x the edge skew window (the edge function uses a
-- ~90s skew bound; keep 3 minutes). Call from a scheduled edge function.
create or replace function public.sweep_ingest_nonces()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.ingest_nonces where seen_at < now() - interval '3 minutes';
$$;
