-- ============================================================
-- Reference Control Plane — 0017 schedule maintenance
-- Run the periodic jobs on a schedule, in-database, via pg_cron.
--
-- rollup_usage() and sweep_ingest_nonces() are both SECURITY DEFINER,
-- idempotent SQL functions living in THIS database, so we schedule them
-- directly rather than routing through the maintenance edge function over
-- HTTP (pg_net + a stored secret). Direct scheduling has fewer moving parts,
-- needs no secret in the database, and can't be reached from outside.
--
-- The supabase/functions/maintenance edge function is unchanged and remains the
-- entry point for *external* schedulers / uptime monitors (see
-- docs/OPERATIONS.md). Either path is sufficient on its own; running both is
-- harmless because the jobs are idempotent.
--
-- pg_cron jobs run as the role that scheduled them (postgres, via migrations),
-- which can execute the SECURITY DEFINER functions.
-- ============================================================

create extension if not exists pg_cron;

-- Idempotent (re)scheduling so `supabase db reset` and re-applies are clean:
-- drop any prior job by name, then (re)create it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'rcp-rollup-usage') then
    perform cron.unschedule('rcp-rollup-usage');
  end if;
  if exists (select 1 from cron.job where jobname = 'rcp-sweep-ingest-nonces') then
    perform cron.unschedule('rcp-sweep-ingest-nonces');
  end if;
end;
$$;

-- Roll up today's usage every 15 minutes. rollup_usage() defaults to
-- current_date and upserts on its unique keys, so overlapping/again runs are
-- safe.
select cron.schedule(
  'rcp-rollup-usage',
  '*/15 * * * *',
  $$ select public.rollup_usage(); $$
);

-- Sweep stale ingest nonces every 15 minutes. Scheduled independently so a
-- rollup failure never blocks the sweep (and vice versa).
select cron.schedule(
  'rcp-sweep-ingest-nonces',
  '*/15 * * * *',
  $$ select public.sweep_ingest_nonces(); $$
);
