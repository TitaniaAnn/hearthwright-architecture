import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";

/**
 * Per-request correlation id. Every `logError` emitted while handling one
 * request (a server action or route handler) shares the same id, so a burst of
 * failures from a single request is greppable as a unit and a user-reported
 * "Ref" can be tied back to the matching server log lines.
 *
 * The middleware mints the id and forwards it on the `x-rcp-request-id` request
 * header (and echoes it on the response); `withRequestId` picks that up, so the
 * id is shared across client → middleware → server logs → edge. It only falls
 * back to a fresh id when the header is absent (e.g. a request that skips the
 * middleware matcher, or code running outside a request scope).
 *
 * Node-only (`async_hooks`); safe because all of this app's server code runs on
 * the Node runtime (no `runtime = "edge"` routes) and the Edge middleware never
 * imports it.
 */
const requestIdStore = new AsyncLocalStorage<string>();

/**
 * Run `fn` inside a request-id scope, keyed to the middleware-forwarded id when
 * present. Returns whatever `fn` returns (and propagates its throws, including
 * Next's `redirect()`/`notFound()` signals), so a server action wraps as
 * `return withRequestId(() => impl(args))`.
 */
export async function withRequestId<T>(fn: () => Promise<T>): Promise<T> {
  let id: string | undefined;
  try {
    id = (await headers()).get("x-rcp-request-id") ?? undefined;
  } catch {
    // headers() throws outside a request scope — fall back to a fresh id.
  }
  return requestIdStore.run(id ?? randomUUID(), fn);
}

/** The current correlation id, or undefined outside a `withRequestId` scope. */
export function currentRequestId(): string | undefined {
  return requestIdStore.getStore();
}
