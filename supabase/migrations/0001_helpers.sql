-- ============================================================
-- Reference Control Plane — 0001 helpers
-- Extensions + the shared updated_at trigger used by every table.
-- ============================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";      -- case-insensitive email columns

-- Keep updated_at fresh on every UPDATE. Attached per-table as a BEFORE
-- UPDATE trigger (a standard migration convention).
create or replace function public.update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
