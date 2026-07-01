-- ============================================================
-- Reference Control Plane — 0007 usage aggregates
-- The dashboard reads these rolled-up tables, never the raw firehose.
-- rollup_usage(day) is idempotent on the unique keys; run it on a schedule
-- (a scheduled edge function) or on demand.
-- ============================================================

create table public.usage_daily (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  day          date not null,
  event_name   text not null,
  event_count  bigint not null default 0,
  unique_users bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (product_id, day, event_name)
);

create index usage_daily_product_day_idx on public.usage_daily (product_id, day);

create trigger usage_daily_set_updated_at
  before update on public.usage_daily
  for each row execute function public.update_updated_at();

create table public.usage_active_users (
  id         uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  day        date not null,
  dau        bigint not null default 0,
  wau        bigint not null default 0,
  mau        bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, day)
);

create index usage_active_users_product_day_idx on public.usage_active_users (product_id, day);

create trigger usage_active_users_set_updated_at
  before update on public.usage_active_users
  for each row execute function public.update_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────
-- Employees (incl. admins) read aggregates. Rollup writes via service role.
alter table public.usage_daily enable row level security;
alter table public.usage_active_users enable row level security;

create policy usage_daily_employee_read on public.usage_daily
  for select to authenticated using (public.is_employee());

create policy usage_active_users_employee_read on public.usage_active_users
  for select to authenticated using (public.is_employee());

-- ── Rollup ────────────────────────────────────────────────────────────────
-- Idempotent upsert of one day's per-event counts and DAU/WAU/MAU. Safe to
-- re-run; conflicts update in place.
create or replace function public.rollup_usage(target_day date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Per-event daily counts + unique users.
  insert into public.usage_daily (product_id, day, event_name, event_count, unique_users)
  select
    product_id,
    target_day,
    event_name,
    count(*),
    count(distinct anon_id)
  from public.usage_events
  where occurred_at >= target_day
    and occurred_at < target_day + 1
  group by product_id, event_name
  on conflict (product_id, day, event_name)
  do update set
    event_count = excluded.event_count,
    unique_users = excluded.unique_users,
    updated_at = now();

  -- Active users (DAU/WAU/MAU) as of target_day, per product.
  insert into public.usage_active_users (product_id, day, dau, wau, mau)
  select
    product_id,
    target_day,
    count(distinct anon_id) filter (
      where occurred_at >= target_day and occurred_at < target_day + 1
    ),
    count(distinct anon_id) filter (
      where occurred_at >= target_day - 6 and occurred_at < target_day + 1
    ),
    count(distinct anon_id) filter (
      where occurred_at >= target_day - 29 and occurred_at < target_day + 1
    )
  from public.usage_events
  where occurred_at >= target_day - 29
    and occurred_at < target_day + 1
  group by product_id
  on conflict (product_id, day)
  do update set
    dau = excluded.dau,
    wau = excluded.wau,
    mau = excluded.mau,
    updated_at = now();
end;
$$;
