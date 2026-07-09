import "server-only";
import { after } from "next/server";
import { currentRequestId } from "@/lib/request-context";

type Meta = Record<string, unknown>;

/**
 * Unwrap a Supabase read result, logging (not throwing) on a query error and
 * degrading to `fallback`. The read-path convention across the app is to render
 * a partial/empty result rather than fail the page — a good UX default that,
 * unguarded, silently blanks pages on a DB hiccup with no signal. This keeps the
 * degrade-to-fallback behaviour but makes the underlying error observable.
 *
 *   const posts = selectOrLog<Post[]>("posts.list", await query, []);
 *
 * `data` stays `unknown` because callers hand-type the row shape (the select
 * string can't be inferred back to their interfaces); the cast mirrors the
 * `data as T[]` the call sites already did. An empty array/result is preserved
 * (only a null/undefined `data` falls back).
 */
export function selectOrLog<T>(
  scope: string,
  result: { data: unknown; error: unknown },
  fallback: T,
  meta?: Meta,
): T {
  if (result.error) logError(scope, result.error, meta);
  return (result.data as T) ?? fallback;
}

/**
 * Structured server-side error log.
 *
 * The app swallows a number of failures by design — a failed public-form insert
 * redirects to `?error=1`, a degrading read renders a partial result — so the
 * user is never shown a stack trace. The cost is that those failures are
 * otherwise invisible. `logError` makes them observable: one greppable line per
 * failure (`[scope] message {…meta}`) on stderr, which the host (Vercel/Node)
 * and Supabase platform capture without any extra infra.
 *
 * Console-based on purpose — it mirrors the convention already used in the edge
 * functions' `verify-api-key.ts`, and it can't itself throw or add latency to
 * the request. When `ERROR_WEBHOOK_URL` is set it also fans out to that
 * endpoint for active alerting (see `reportToSink`).
 *
 * Never pass raw PII in `meta` — keep it to ids, counts, and status codes.
 */
export function logError(scope: string, error: unknown, meta?: Meta): void {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  // Fold the request correlation id (if we're inside a withRequestId scope) into
  // the meta, so both the stderr line and the webhook payload carry it — a burst
  // of failures from one request shares an id. Undefined outside a scope, in
  // which case the line is unchanged.
  const rid = currentRequestId();
  const enriched: Meta | undefined = rid ? { requestId: rid, ...meta } : meta;
  if (enriched && Object.keys(enriched).length > 0) {
    console.error(`[${scope}]`, message, enriched);
  } else {
    console.error(`[${scope}]`, message);
  }
  reportToSink(scope, message, enriched);
}

// Coalesce identical alerts during an error storm: at most one webhook POST per
// (scope+message) per window. The failure mode this guards is exactly when the
// sink matters most — one broken query trips hundreds of requests, each calling
// logError — which without this would fan out hundreds of POSTs (Slack rate-limits;
// an on-call gets paged in a loop). In-memory and per-instance (a serverless fleet
// won't share the map), so it blunts rather than eliminates a storm; the stderr
// line is always emitted, so only *duplicate alerts* are dropped, never a record.
const SINK_THROTTLE_MS = 60_000;
const SINK_MAX_KEYS = 500;
const sinkLastSent = new Map<string, number>();

/**
 * Optional, opt-in fan-out to an external sink (`ERROR_WEBHOOK_URL`). No-op and
 * zero-overhead when the env var is unset, so the stderr line above stays the
 * source of truth. The POST is scheduled with `after()` so it runs once the
 * response has flushed — it never blocks the request and survives a `redirect()`
 * thrown from the same action. The payload carries a Slack-friendly `text` field
 * plus structured fields for a generic sink; delivery is strictly best-effort.
 * Repeated identical alerts are coalesced (see `sinkLastSent`).
 */
function reportToSink(scope: string, message: string, meta?: Meta): void {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;

  // Drop duplicate alerts inside the throttle window (the stderr line still fired).
  const key = `${scope} ${message}`;
  const now = Date.now();
  const prev = sinkLastSent.get(key);
  if (prev !== undefined && now - prev < SINK_THROTTLE_MS) return;
  // Bound memory: a flood of *distinct* messages can't grow the map without limit.
  if (sinkLastSent.size >= SINK_MAX_KEYS) sinkLastSent.clear();
  sinkLastSent.set(key, now);

  const send = async () => {
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `[rcp] ${scope}: ${message}`,
          source: "rcp",
          scope,
          message,
          meta: meta ?? {},
          at: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Best-effort — the stderr line is the durable record.
    }
  };

  try {
    after(send);
  } catch {
    // Called outside a Next request scope (after() throws there). Fall back to
    // fire-and-forget so we still attempt delivery without blocking.
    void send();
  }
}
