// Smoke test for self-observability: the structured error logger, the request
// correlation id threaded client → middleware → server → edge, and the health
// probe. Source-level, like the other smoke tests — the wiring is what's easy
// to regress; behaviour needs a running stack.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

test("observability module is server-only and exports logError", () => {
  assert.ok(existsSync(root + "src/lib/observability.ts"), "src/lib/observability.ts missing");
  const mod = read("src/lib/observability.ts");
  assert.match(mod, /^import "server-only";/m, "must be server-only");
  assert.match(mod, /export\s+function\s+logError/, "must export logError");
  assert.match(mod, /console\.error/, "must log to stderr");
});

test("/api/health probe: DB ping, 200/503, no-store, never leaks detail", () => {
  const p = "src/app/api/health/route.ts";
  assert.ok(existsSync(root + p), `${p} missing`);
  const src = read(p);
  assert.match(src, /export const dynamic = "force-dynamic"/, "must be force-dynamic (never cached)");
  assert.match(src, /from\("products"\)/, "must ping the DB");
  assert.match(src, /status: 200/, "must return 200 when reachable");
  assert.match(src, /status: 503/, "must return 503 when the DB is unreachable");
  assert.match(src, /cache-control.*no-store|NO_STORE/, "responses must be no-store");
  assert.match(src, /logError\("health\.db"/, "must log the underlying failure server-side");
  // Low-information by design: the 503 body must not echo the error detail.
  assert.doesNotMatch(src, /error:\s*e\b|e\.message/, "must not leak error detail to the client");
  // Least privilege: the ping uses the anon client, not the service role.
  assert.match(src, /from "@\/lib\/supabase\/server"/, "must ping via the anon/server client");
  assert.doesNotMatch(src, /createAdminClient/, "must not ping via the service role");
});

test("request-context provides an AsyncLocalStorage correlation id", () => {
  assert.ok(existsSync(root + "src/lib/request-context.ts"), "src/lib/request-context.ts missing");
  const mod = read("src/lib/request-context.ts");
  assert.match(mod, /^import "server-only";/m, "must be server-only");
  assert.match(mod, /AsyncLocalStorage/, "must use AsyncLocalStorage");
  assert.match(mod, /export async function withRequestId/, "must export withRequestId");
  assert.match(mod, /export function currentRequestId/, "must export currentRequestId");
  // Prefers the middleware-forwarded id, falls back to a fresh one.
  assert.match(mod, /headers\(\)\)\.get\("x-rcp-request-id"\)/, "must read the forwarded id from headers()");
  assert.match(mod, /\?\?\s*randomUUID\(\)/, "must fall back to a generated id");
});

test("middleware mints and threads the correlation id", () => {
  const rootMw = read("middleware.ts");
  // Reuse an inbound id (trace join) else mint one; pass it to updateSession.
  assert.match(rootMw, /get\("x-rcp-request-id"\)\s*\?\?\s*crypto\.randomUUID\(\)/, "must reuse-or-mint the id");
  assert.match(rootMw, /updateSession\(request, requestId\)/, "must pass the id to updateSession");
  assert.match(rootMw, /redirect\.headers\.set\("x-rcp-request-id", requestId\)/, "the redirect response must carry the id too");

  const supaMw = read("src/lib/supabase/middleware.ts");
  // Forward on the request (handler-readable) and echo on the response.
  assert.match(supaMw, /requestHeaders\.set\("x-rcp-request-id", requestId\)/, "must forward the id on the request headers");
  assert.match(supaMw, /next\(\{ request: \{ headers: requestHeaders \} \}\)/, "must forward the cloned headers to the handler");
  assert.match(supaMw, /response\.headers\.set\("x-rcp-request-id", requestId\)/, "must echo the id on the response");
});

test("logError folds the correlation id into the line and payload", () => {
  const mod = read("src/lib/observability.ts");
  assert.match(mod, /currentRequestId\(\)/, "must read the current request id");
  assert.match(mod, /requestId: rid/, "must add requestId to the enriched meta");
  // The enriched meta (with requestId) flows to both console and the sink.
  assert.match(mod, /reportToSink\(scope, message, enriched\)/, "the sink payload must carry the enriched meta");
});

test("observability exports selectOrLog, which logs then degrades", () => {
  const mod = read("src/lib/observability.ts");
  assert.match(mod, /export\s+function\s+selectOrLog/, "must export selectOrLog");
  // Logs the query error, then returns data or the fallback (never throws).
  assert.match(mod, /if\s*\(result\.error\)\s*logError\(/, "must log on query error");
  assert.match(mod, /result\.data as T\)\s*\?\?\s*fallback/, "must degrade to the fallback");
});

test("the write actions in this cut log DB failures before surfacing them", () => {
  for (const [path, scopes] of [
    ["src/app/admin/api-keys/actions.ts", ["admin.apiKeys.createApiKey", "admin.apiKeys.revokeApiKey"]],
    ["src/app/admin/posts/actions.ts", ["admin.posts.createPost", "admin.posts.updatePost", "admin.posts.deletePost"]],
  ]) {
    const src = read(path);
    assert.match(src, /import \{ logError \} from "@\/lib\/observability"/, `${path} must import logError`);
    for (const scope of scopes) {
      assert.match(src, new RegExp(`logError\\("${scope.replace(/\./g, "\\.")}"`), `${path} must log scope ${scope}`);
    }
  }
});

test("the download route logs each silent failure point", () => {
  const src = read("src/app/api/downloads/[version]/route.ts");
  for (const scope of [
    "download.route.product",
    "download.route.releases",
    "download.route.counter",
    "download.route.signedUrl",
  ]) {
    assert.match(src, new RegExp(`logError\\("${scope.replace(/\./g, "\\.")}"`), `must log scope ${scope}`);
  }
});

test("the edge error path returns generic 5xx and fans out to the sink", () => {
  const src = read("supabase/functions/_shared/verify-api-key.ts");
  assert.match(src, /export function reportEdgeError/, "must export reportEdgeError");
  assert.match(src, /ERROR_WEBHOOK_URL/, "must read the shared sink env var");
  // 5xx VerifyErrors wrap raw DB errors — never echoed to the caller.
  assert.match(src, /e\.status >= 500/, "must special-case 5xx VerifyErrors");
  assert.match(src, /\{ error: "internal" \}/, "5xx body must be generic");
});
