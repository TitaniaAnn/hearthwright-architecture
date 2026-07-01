# CLAUDE.md

Guidance for working in this repository.

## What this repo is

A **reference architecture**, not a runnable product. It publishes a curated,
secret-free subset of a private multi-surface Next.js + Supabase control plane.
[ARCHITECTURE.md](ARCHITECTURE.md) and [README.md](README.md) are the primary
deliverables; the code exists to make their claims verifiable. The canonical
check is `npm test` (pure-logic, no DB) plus `supabase db reset` +
`supabase/tests/rls_test.sql` for the RLS boundary.

`npm run dev` is **not** the intended entry point — the marketing/admin/dashboard
*pages* are deliberately omitted from this cut (see ARCHITECTURE.md § "What this
cut leaves out"). The `layout.tsx` guards and `actions.ts` write paths are
included because that's where the architecture lives.

## Conventions worth knowing before editing

- **Four Supabase clients, one per context** (`src/lib/supabase/`): browser /
  request-server / middleware / service-role. The service-role client is fenced
  behind `import "server-only"` — never import it into a Client Component.
- **Authorization is checked three times** (middleware presence gate → server
  `requireRole` → RLS). Don't fold the role check into middleware; middleware
  runs without a DB and only gates session presence.
- **`getUser()`, never `getSession()`** in server code. `getUser()` revalidates
  the token; `getSession()` trusts the cookie.
- **Mutations are Server Actions with a Zod boundary** (`src/app/admin/*/actions.ts`):
  `requireRole` → Zod-parse `FormData` → write under RLS → surgical
  `revalidatePath`. No client-side fetch-to-API-route path.
- **RLS rests on `SECURITY DEFINER` role helpers** (`is_admin`, `is_employee`,
  `app_user_id` in `0002`). Write new policies in terms of them; don't inline a
  table lookup that would re-enter the RLS evaluator.
- **The telemetry firehose has RLS enabled and no policy** (`0006`) — service
  role only. The dashboard reads the rollup tables (`0007`), never the raw
  events. Keep that separation.
- **Counters and balances mutate via atomic RPCs**, not read-modify-write in
  app code (`increment_download` in `0005`).
- **Migration numbers preserve the production sequence**; gaps (0008–0016) are
  intentional and the runner tolerates them. New migrations append; never edit
  an applied one.

## What NOT to do

- Don't add real secrets. `.env.example` ships with blanks; `.env*.local` is
  gitignored.
- Don't "fix the build" by writing the omitted pages/migrations to make
  `npm run dev` work — that changes what the cut demonstrates. Confirm scope
  first.
- Don't reintroduce references to the private upstream repos or product names;
  this cut is intentionally generic.
