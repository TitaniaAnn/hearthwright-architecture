# Reference Control Plane

A reference architecture for a small software studio's control plane: one
Next.js app (App Router, React Server Components) serving a public
marketing/CMS site, an admin CMS, and an internal telemetry dashboard — over a
single Supabase Postgres with row-level security, fronted by an API-key-gated
telemetry ingestion pipeline.

This is a curated, secret-free subset published to make its architectural
decisions verifiable. The full application is private. **[ARCHITECTURE.md](ARCHITECTURE.md)
is the primary document**; the code exists to back its claims.

## Stack

- **Next.js 16** (App Router) on **React 19** — Server Components + Server
  Actions, no client-side data layer
- **TypeScript** end to end, **Zod** at every input boundary
- **Supabase** — Postgres + Auth + Storage + Edge Functions, `@supabase/ssr`
  for cookie-based SSR auth
- **Row-level security** on every table, resting on `SECURITY DEFINER` role
  helpers — with the base-table grant layer beneath it made explicit
- **pg_cron** for in-database scheduled rollups and sweeps
- **Console-first observability** — structured error logs, an optional webhook
  sink, and a request correlation id threaded client → app → edge

## What's worth reading

| Concern | File |
|---|---|
| Four Supabase clients (browser / server / middleware / service-role) | `src/lib/supabase/` |
| Three-layer authz (middleware → server guard → RLS) | `middleware.ts`, `src/lib/auth.ts` |
| Server-Action mutations with Zod + surgical revalidation | `src/app/admin/posts/actions.ts` |
| API-key auth: hash-at-rest, scopes, nonce replay protection | `src/app/admin/api-keys/actions.ts`, `supabase/functions/_shared/verify-api-key.ts` |
| Batch ingestion as one shared pipeline + per-endpoint config | `supabase/functions/_shared/batch-ingest.ts`, `supabase/functions/ingest-usage/` |
| RLS role helpers + firehose isolation | `supabase/migrations/0002`, `0006`, `0007` |
| Explicit base-table grants beneath RLS | `supabase/migrations/0020`–`0022` |
| Privileged RPCs locked to the service role | `supabase/migrations/0018` |
| Fixed-window rate limiting that fails open | `supabase/migrations/0019`, `src/lib/rate-limit.ts` |
| Structured error logging + correlation id + health probe | `src/lib/observability.ts`, `src/lib/request-context.ts`, `src/app/api/health/route.ts` |
| Counted downloads (private bucket + atomic RPC + signed URL) | `src/app/api/downloads/[version]/route.ts`, `supabase/migrations/0005` |
| In-database scheduling | `supabase/migrations/0017`, `0019` |

## Verifying

```bash
npm install
npm test                                              # pure-logic invariants + wiring guards, no DB
supabase db reset                                     # applies every migration
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql                  # RLS predicates & firehose isolation
psql "$DATABASE_URL" -f supabase/tests/grants_test.sql               # grant matrix + RLS coverage
psql "$DATABASE_URL" -f supabase/tests/function_privileges_test.sql  # privileged RPC lockdown
psql "$DATABASE_URL" -f supabase/tests/rate_limit_test.sql           # rate limiter behaviour
```

See [ARCHITECTURE.md](ARCHITECTURE.md) § "What this cut leaves out" for the
documented gaps — this is a subset, not a clean checkout.

## License

MIT — see [LICENSE](LICENSE).
