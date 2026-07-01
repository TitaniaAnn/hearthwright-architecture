-- ============================================================
-- Reference Control Plane — 0002 users & roles
-- A public.users mirror of auth.users, an employee_roles table, and the
-- SECURITY DEFINER role helpers that every later RLS policy depends on.
-- Standard SECURITY DEFINER role-helper pattern; see ARCHITECTURE.md §4.
-- ============================================================

-- ── Identity mirror ────────────────────────────────────────────────────────
create table public.users (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  email         citext,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.update_updated_at();

-- Mirror every new auth user into public.users. SECURITY DEFINER so the insert
-- bypasses RLS; runs as the auth schema's trigger on sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (auth_user_id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Roles ──────────────────────────────────────────────────────────────────
-- No row in employee_roles = a public user. One role per user.
create type public.app_role as enum ('admin', 'employee');

create table public.employee_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references public.users(id) on delete cascade,
  role        public.app_role not null,
  granted_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger employee_roles_set_updated_at
  before update on public.employee_roles
  for each row execute function public.update_updated_at();

-- ── Role helpers (SECURITY DEFINER STABLE) ──────────────────────────────────
-- app_user_id(): the public.users.id for the current auth session, or null.
create or replace function public.app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_user_id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_roles er
    join public.users u on u.id = er.user_id
    where u.auth_user_id = auth.uid()
      and er.role = 'admin'
  )
$$;

-- Employees include admins (admins can do anything an employee can).
create or replace function public.is_employee()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.employee_roles er
    join public.users u on u.id = er.user_id
    where u.auth_user_id = auth.uid()
  )
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.users enable row level security;
alter table public.employee_roles enable row level security;

-- A user can read their own mirror row; employees can read everyone (needed for
-- assignee pickers, comment authorship, etc.).
create policy users_select_self_or_employee on public.users
  for select to authenticated
  using (auth_user_id = auth.uid() or public.is_employee());

-- A user can edit their own profile fields.
create policy users_update_self on public.users
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- A user can see their own role; admins manage all roles.
create policy employee_roles_select on public.employee_roles
  for select to authenticated
  using (user_id = public.app_user_id() or public.is_admin());

create policy employee_roles_admin_write on public.employee_roles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
