# Architecture

A reference cut of a multi-surface control plane: one Next.js app (App Router,
React Server Components) serving a public marketing/CMS site, an admin CMS, and
an internal team dashboard, over a single Supabase Postgres with row-level
security. A separate edge layer ingests product telemetry behind API keys.

The published code is a curated subset. The full application is private; this
repo exists to make the decisions below verifiable — every claim points at a
file you can read.

The shape:

```
src/app/(marketing)   public site            anon + RLS public-read-published
src/app/admin         CMS                    requireRole("admin") + RLS
src/app/dashboard     internal telemetry     requireRole("employee") + RLS
src/app/api           route handlers         signed downloads, revalidation
supabase/migrations   schema + RLS + RPCs    the source of truth
supabase/functions    telemetry ingestion    API-key auth, service role
```

---

## 1. Four Supabase clients, one per execution context

`src/lib/supabase/` ships four factories, not one, because Next.js runs code in
four places with different cookie semantics and trust levels:

- **`client.ts`** — `createBrowserClient`. Runs in the browser, anon key.
- **`server.ts`** — `createServerClient` bound to the request cookie store.
  Used by Server Components, Server Actions, and Route Handlers. Wraps cookie
  writes in a try/catch because Server Components get a read-only cookie store.
- **`middleware.ts`** — `createServerClient` that refreshes the session on every
  request and mirrors the rotated cookies onto the response.
- **`admin.ts`** — the service-role client. Bypasses RLS, so it is fenced behind
  `import "server-only"`: importing it into a Client Component is a build error,
  not a runtime accident.

The split is the security boundary. The anon key is safe in the browser; the
service-role key can only be reached from server code, and the bundler enforces
it.

## 2. Three-layer authorization

Auth is checked three independent times, and each layer assumes the others can
fail:

1. **Middleware** (`middleware.ts`) gates `/admin` and `/dashboard` on session
   *presence* only — unauthenticated requests redirect to `/login` with a
   `redirectTo`. It deliberately does **not** check role; middleware runs on the
   edge with no DB and shouldn't make trust decisions beyond "is anyone signed
   in."
2. **Server layout** — each protected segment's `layout.tsx` calls
   `requireRole("admin" | "employee")` (`src/lib/auth.ts`), which reads the
   caller's role server-side and redirects under-privileged users. This is where
   the real authorization decision lives.
3. **RLS** is the backstop. Even if both layers above were bypassed, every
   query runs under a Postgres policy keyed on the caller's role.

`src/lib/auth.ts` uses `supabase.auth.getUser()`, never `getSession()`.
`getUser()` revalidates the token against the auth server; `getSession()` trusts
whatever is in the cookie. In server code that difference is the difference
between authorization and a forgeable claim.

## 3. Mutations are Server Actions with a Zod boundary

Every write is a `"use server"` action (`src/app/admin/*/actions.ts`), not a
client `fetch` to an API route. Each action:

1. calls `requireRole("admin")` first,
2. parses `FormData` through a Zod schema (untrusted input never reaches the DB
   un-validated),
3. writes via the request-scoped Supabase client (so RLS applies), and
4. revalidates exactly the affected paths.

`posts/actions.ts::updatePost` revalidates `/admin/posts`, `/posts`, and
`/posts/[slug]` — surgical, not a blanket cache flush. This is the RSC mutation
model done without a client-side data layer: no fetch wrappers, no optimistic
cache to reconcile, the server is the single source of truth and the action
tells the framework precisely what changed.

## 4. RLS rests on SECURITY DEFINER role helpers

`0002_users_and_roles.sql` defines three `STABLE SECURITY DEFINER` functions —
`app_user_id()`, `is_admin()`, `is_employee()` — and every later policy is
written in terms of them (`using (public.is_admin())`).

Two reasons this matters:

- **No recursion.** A policy that inlined "is this user an admin?" by selecting
  from a table that itself has RLS would re-enter the policy evaluator and
  deadlock or error. `SECURITY DEFINER` runs the lookup as the function owner,
  outside the caller's RLS path, breaking the cycle.
- **One definition of "admin."** The predicate lives in one function. Change the
  role model once and all ~12 policies follow. A new auth user is mirrored into
  `public.users` by an `AFTER INSERT` trigger (`handle_new_user`), also
  `SECURITY DEFINER`, so sign-up doesn't need an anon insert policy.

## 5. The telemetry firehose is isolated from the read path

`0006_ingestion.sql` enables RLS on `usage_events` and `ingest_nonces` and
defines **no policy** for them. RLS-enabled-with-no-policy means anon and
authenticated roles can touch *nothing*; only the service role (which bypasses
RLS) can write. The edge functions run as the service role.

The dashboard never reads the raw firehose. `0007_usage_aggregates.sql` rolls
events into `usage_daily` and `usage_active_users`, and *those* tables carry an
employee-read policy. So the high-cardinality write target and the
employee-readable aggregates are different tables with different access — a
firehose write can never widen what an employee query can see.

`rollup_usage(day)` is an idempotent upsert keyed on `(product_id, day,
event_name)`; re-running it is safe, which is what lets it run on a schedule
(§8) without coordination.

## 6. API-key authentication with replay protection

Product telemetry authenticates with bearer API keys
(`supabase/functions/_shared/verify-api-key.ts`), and the key handling is the
part worth copying:

- **Hashed at rest.** The admin action (`api-keys/actions.ts`) mints
  `rcp_live_<random>`, stores only the SHA-256 hex and a 14-char display prefix,
  and returns the raw key exactly once. A database leak yields hashes, not keys.
- **Scoped.** Keys carry a `scopes` array validated against an allowlist; the
  verifier checks the required scope per endpoint (`"usage"`, `"error"`, ...).
- **Replay-bounded.** Each request carries a `nonce` and `timestamp`. The
  verifier rejects timestamps outside a 90-second skew window *and* inserts the
  nonce into a `UNIQUE(api_key_id, nonce)` table — a replayed request hits the
  unique violation and is rejected as a seen nonce. A sweep keeps the nonce
  table to ~3 minutes (twice the skew window).
- **Rate-limited.** Recent nonce rows double as a per-key request counter.
- **Revocable.** A `revoked_at` stamp fails auth without deleting the row.

The same module exposes a lighter read-only verifier (no nonce) for idempotent
pull feeds, where replay isn't a threat.

## 7. Counted downloads via a private bucket + atomic RPC

`src/app/api/downloads/[version]/route.ts` never serves a file directly. It
looks up the published release, bumps the counter through the
`increment_download()` RPC (`0005_releases.sql`), then 307-redirects to a
60-second signed URL. The artifact bucket is private.

The counter is a single SQL `UPDATE ... set download_count = download_count + 1`,
not a read-modify-write in application code — two concurrent downloads can't
lose a count. That's the same "let the database do the increment atomically"
discipline applied to any balance or counter in the wider system.

## 8. Periodic jobs run in the database, not over HTTP

`0017_schedule_maintenance.sql` schedules `rollup_usage()` and
`sweep_ingest_nonces()` directly with `pg_cron`. Both are idempotent
`SECURITY DEFINER` functions living in this database, so scheduling them
in-process has fewer moving parts than routing through an edge function over
HTTP with a stored secret — and it can't be reached from outside.

The (re)scheduling block unschedules any prior job of the same name first, so
`supabase db reset` and re-applies stay clean. An edge-function entry point
remains for *external* schedulers/uptime monitors; either path alone suffices,
and running both is harmless because the jobs are idempotent.

## 9. On-demand revalidation for out-of-band writes

Admin actions revalidate in-process (§3). `src/app/api/revalidate/route.ts`
covers the other case — a content change that originates outside the app (a
future webhook). It's a POST gated by a shared secret (`REVALIDATE_SECRET`) that
revalidates a single path. Constant-time-ish secret comparison, same-origin path
guard, 401 on mismatch.

---

## What this cut leaves out

This is a subset chosen to demonstrate the patterns above, not a runnable
product:

- The marketing/admin/dashboard **pages and components** are omitted; the
  `layout.tsx` guards and the `actions.ts` write paths are included because
  they're where the architecture lives. Wiring up `flutter`-style screen code
  adds lines, not decisions.
- Only **one ingestion function** (`ingest-usage`) ships. Error, feedback, and
  wiki ingestion follow the identical verify-key → validate → service-role-insert
  shape; including them would be repetition.
- Migration numbers preserve the production app's original sequence, so there
  are **gaps** (0008–0016 are not in this cut). That's expected, and the
  idempotent runner tolerates it.
- No CI, no `package-lock.json`, no real seed data.

## Verifying the claims

```bash
npm test                      # pure-logic invariants (API-key derivation)
supabase db reset             # applies every migration in order
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # RLS boundary asserts §2, §5
```

`supabase/tests/rls_test.sql` proves the two load-bearing isolation claims at
the database: a draft product is invisible to `anon` (§2's public-read
predicate), and the usage firehose is unreadable by `authenticated` (§5's
no-policy isolation).
