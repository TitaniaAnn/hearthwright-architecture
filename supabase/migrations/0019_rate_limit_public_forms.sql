-- ============================================================
-- Reference Control Plane — 0019 rate limit public forms
--
-- The public marketing forms (contact, newsletter, feedback — pages omitted
-- from this cut) are written via service-role server actions guarded only by a
-- honeypot. That leaves them open to scripted abuse: spam rows, and — for the
-- newsletter — a transactional confirm email per submit (a real money /
-- deliverability-reputation cost). Add a small fixed-window counter the server
-- actions consult before writing (src/lib/rate-limit.ts).
--
-- Design: a single counter table keyed by (bucket, window_start). A bucket is
-- "<action>:<client-ip>" chosen by the caller. rate_limit_check() upserts the
-- row for the current window and returns whether the running count is still
-- within the limit. Fixed-window (not sliding) keeps it to one round-trip and
-- one row per caller per window — cheap, and good enough to blunt abuse.
--
-- The function is SECURITY DEFINER and, like the other privileged RPCs (see
-- 0018), is locked to service_role: only the server actions call it, and it
-- must never be reachable as an anon/authenticated PostgREST RPC (an attacker
-- could otherwise burn a victim IP's budget, or probe it). sweep_rate_limits()
-- drops expired rows and is scheduled via pg_cron (mirrors 0017).
-- ============================================================

create table public.rate_limit_hits (
  bucket       text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (bucket, window_start)
);

-- No RLS policies: the table is service-role / owner only. RLS on with zero
-- policies denies anon/authenticated outright (defence in depth alongside the
-- function lockdown below).
alter table public.rate_limit_hits enable row level security;

-- Fixed-window limiter. Returns true while the caller is within p_max requests
-- for the current p_window_secs window, false once the limit is exceeded.
-- SECURITY DEFINER so it can write the counter table under RLS.
create function public.rate_limit_check(
  p_bucket       text,
  p_max          integer,
  p_window_secs  integer
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ws  timestamptz;
  cur integer;
begin
  -- Snap to the start of the current fixed window.
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);

  insert into public.rate_limit_hits (bucket, window_start, count)
    values (p_bucket, ws, 1)
  on conflict (bucket, window_start)
    do update set count = public.rate_limit_hits.count + 1
  returning count into cur;

  return cur <= p_max;
end;
$$;

-- Drop windows that can no longer be current. Idempotent; scheduled hourly.
create function public.sweep_rate_limits() returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rate_limit_hits where window_start < now() - interval '1 day';
$$;

-- ── Lock down execute (consistent with 0018) ───────────────────────────────
revoke execute on function public.rate_limit_check(text, integer, integer) from public;
grant execute on function public.rate_limit_check(text, integer, integer) to service_role;

revoke execute on function public.sweep_rate_limits() from public;
grant execute on function public.sweep_rate_limits() to service_role;

-- ── Schedule the sweep (idempotent, mirrors 0017) ──────────────────────────
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rcp-sweep-rate-limits') then
    perform cron.unschedule('rcp-sweep-rate-limits');
  end if;
end;
$$;

select cron.schedule(
  'rcp-sweep-rate-limits',
  '17 * * * *',
  $$ select public.sweep_rate_limits(); $$
);
