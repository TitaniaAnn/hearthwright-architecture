-- ============================================================
-- Reference Control Plane — public-form rate limiter test
-- Guards migration 0019: rate_limit_check() must enforce the fixed-window cap.
-- (Its service_role-only EXECUTE lockdown is asserted alongside the other
-- privileged RPCs in function_privileges_test.sql.)
--
-- Usage:  psql "$DATABASE_URL" -f supabase/tests/rate_limit_test.sql
-- ============================================================

begin;

-- Behaviour: a 2-request budget in one window — calls 1 and 2 pass, call 3 is
-- denied. Runs as the owner (the app calls it as service_role); the 1-hour
-- window guarantees all three calls land in the same fixed window.
do $$
begin
  if not public.rate_limit_check('test:behaviour', 2, 3600) then
    raise exception 'RATE-LIMIT FAIL: call 1 of 2 was denied';
  end if;
  if not public.rate_limit_check('test:behaviour', 2, 3600) then
    raise exception 'RATE-LIMIT FAIL: call 2 of 2 was denied';
  end if;
  if public.rate_limit_check('test:behaviour', 2, 3600) then
    raise exception 'RATE-LIMIT FAIL: call 3 exceeded the cap but was allowed';
  end if;
end $$;

-- Buckets are independent: exhausting one must not throttle another.
do $$
begin
  if not public.rate_limit_check('test:other-bucket', 2, 3600) then
    raise exception 'RATE-LIMIT FAIL: a fresh bucket was throttled by another bucket''s hits';
  end if;
end $$;

rollback;  -- never persist counter rows
