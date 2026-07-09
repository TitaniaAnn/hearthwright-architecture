// Shared payload helpers for the ingestion edge functions (untrusted product
// input). Kept tiny and pure so they're easy to unit-test.

/** Clamp a value to a non-empty string of at most `max` chars, else null. */
export function str(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.slice(0, max);
}

/**
 * Return `v` (an object/array) only if its JSON serialization is within
 * `maxBytes`, else an empty object. Bounds the size of the free-form jsonb
 * fields products send (usage `properties`, error `context`) independently of
 * the per-batch row caps.
 */
export function clampJson(v: unknown, maxBytes: number): unknown {
  if (!v || typeof v !== "object") return {};
  try {
    if (JSON.stringify(v).length <= maxBytes) return v;
  } catch {
    // non-serializable (e.g. circular) — drop it
  }
  return {};
}

/**
 * The value as an ISO-8601 UTC timestamp if it parses, else null. Use to gate an
 * optional client-supplied filter (e.g. a `?since=` cursor) so a malformed value
 * is ignored rather than thrown straight at a timestamptz comparison (→ 500).
 */
export function validTimestamp(v: unknown): string | null {
  if (typeof v === "string") {
    const t = new Date(v);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return null;
}

/**
 * Normalize a client-supplied timestamp to an ISO-8601 UTC string. Invalid or
 * missing values fall back to now(), so one malformed `occurred_at` can't fail a
 * whole batch insert into a timestamptz column — and ISO-UTC normalization makes
 * lexicographic comparison of timestamps (e.g. "latest seen") correct.
 */
export function normalizeTimestamp(v: unknown): string {
  return validTimestamp(v) ?? new Date().toISOString();
}
