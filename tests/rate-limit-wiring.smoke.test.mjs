// Smoke test for the public-form rate limiter. Source-level, like the other
// smoke tests: the in-database behaviour is exercised by
// supabase/tests/rate_limit_test.sql; this guards the app-side wiring that's
// easy to regress — the helper's server-only + fail-open contract and the
// migration's lockdown. (The public form actions that consult it are omitted
// from this cut; see ARCHITECTURE.md § "What this cut leaves out".)
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

test("rate-limit module is server-only and exports the API", () => {
  assert.ok(existsSync(root + "src/lib/rate-limit.ts"), "src/lib/rate-limit.ts missing");
  const mod = read("src/lib/rate-limit.ts");
  assert.match(mod, /^import "server-only";/m, "must be server-only");
  for (const sym of ["clientIp", "rateLimitOk"]) {
    assert.match(mod, new RegExp(`export\\s+async\\s+function\\s+${sym}`), `missing export ${sym}`);
  }
  assert.match(mod, /rate_limit_check/, "must call the rate_limit_check RPC");
});

test("rateLimitOk fails open on error, but logs first", () => {
  const mod = read("src/lib/rate-limit.ts");
  // Both the RPC error path and the catch must return true (let the write
  // through) — and must log first, so a silent limiter outage is observable.
  assert.match(mod, /if\s*\(error\)\s*\{[\s\S]*?return\s*true/, "RPC error must fail open");
  assert.match(mod, /catch[\s\S]*return\s*true/, "thrown error must fail open");
  assert.match(mod, /logError\("rate-limit\.rpc"/, "RPC error must be logged before failing open");
  assert.match(mod, /logError\("rate-limit\.exception"/, "thrown error must be logged before failing open");
});

test("migration 0019 locks the limiter RPC to service_role", () => {
  const mig = read("supabase/migrations/0019_rate_limit_public_forms.sql");
  assert.match(mig, /revoke execute on function public\.rate_limit_check/, "must revoke PUBLIC execute");
  assert.match(mig, /grant execute on function public\.rate_limit_check\(text, integer, integer\) to service_role/, "must grant service_role");
  assert.match(mig, /enable row level security/, "counter table must have RLS enabled");
});
