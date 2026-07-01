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
  helpers
- **pg_cron** for in-database scheduled rollups

## What's worth reading

| Concern | File |
|---|---|
| Four Supabase clients (browser / server / middleware / service-role) | `src/lib/supabase/` |
| Three-layer authz (middleware → server guard → RLS) | `middleware.ts`, `src/lib/auth.ts` |
| Server-Action mutations with Zod + surgical revalidation | `src/app/admin/posts/actions.ts` |
| API-key auth: hash-at-rest, scopes, nonce replay protection | `src/app/admin/api-keys/actions.ts`, `supabase/functions/_shared/verify-api-key.ts` |
| RLS role helpers + firehose isolation | `supabase/migrations/0002`, `0006`, `0007` |
| Counted downloads (private bucket + atomic RPC + signed URL) | `src/app/api/downloads/[version]/route.ts`, `supabase/migrations/0005` |
| In-database scheduling | `supabase/migrations/0017` |

## Verifying

```bash
npm install
npm test                                              # pure-logic invariants, no DB
supabase db reset                                     # applies every migration
psql "$DATABASE_URL" -f supabase/tests/rls_test.sql   # RLS boundary asserts
```

See [ARCHITECTURE.md](ARCHITECTURE.md) § "What this cut leaves out" for the
documented gaps — this is a subset, not a clean checkout.

## License

MIT — see [LICENSE](LICENSE).
