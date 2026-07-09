// Shared API-key auth for Reference Control Plane ingestion edge functions. Each product
// authenticates with a bearer API key. We SHA-256 the presented key,
// match it against api_keys.key_hash, check the required scope, bound replay
// with a per-key nonce, and reject stale timestamps.
//
// Usage:
//   const admin = adminClientFromEnv();
//   const { apiKey, body } = await verifyApiKeyRequest(req, admin, "usage");
//   // apiKey.product_id is now trustworthy.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// 90 seconds. The nonce check makes a single replay impossible regardless of
// skew; this is defense-in-depth. The nonce sweep keeps rows for 3 minutes
// (2x this window).
const MAX_SKEW_MS = 90 * 1000;

// Hard cap on the request body. The per-batch row caps (MAX_EVENTS etc.) bound
// row COUNT but not payload size, so a single request could otherwise ship a
// huge body. ~1 MB is generous for a batch of telemetry/feedback.
const MAX_BODY_BYTES = 1_000_000;

export class VerifyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface ApiKeyRow {
  id: string;
  product_id: string;
  scopes: string[];
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyApiKeyRequest<
  TBody extends { nonce: string; timestamp: string },
>(
  req: Request,
  admin: SupabaseClient,
  requiredScope: string,
): Promise<{ apiKey: ApiKeyRow; body: TBody }> {
  if (req.method !== "POST") {
    throw new VerifyError(405, "method not allowed");
  }

  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new VerifyError(401, "missing bearer token");
  const rawKey = match[1].trim();

  // Reject oversized bodies before buffering/processing. Content-Length covers
  // the common case; the post-read length check backstops chunked uploads.
  const declaredLen = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLen) && declaredLen > MAX_BODY_BYTES) {
    throw new VerifyError(413, "request body too large");
  }
  const bodyText = await req.text();
  if (bodyText.length > MAX_BODY_BYTES) {
    throw new VerifyError(413, "request body too large");
  }
  let body: TBody;
  try {
    body = JSON.parse(bodyText) as TBody;
  } catch {
    throw new VerifyError(400, "invalid json body");
  }

  if (
    !body.nonce ||
    typeof body.nonce !== "string" ||
    body.nonce.length < 8 ||
    body.nonce.length > 128
  ) {
    throw new VerifyError(400, "missing or invalid nonce");
  }
  if (!body.timestamp) throw new VerifyError(400, "missing timestamp");

  const skew = Math.abs(Date.now() - new Date(body.timestamp).getTime());
  if (!Number.isFinite(skew) || skew > MAX_SKEW_MS) {
    throw new VerifyError(400, "timestamp out of range");
  }

  const keyHash = await sha256Hex(rawKey);
  const { data: apiKey, error } = await admin
    .from("api_keys")
    .select("id, product_id, scopes, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) throw new VerifyError(500, `db error: ${error.message}`);
  if (!apiKey) throw new VerifyError(401, "invalid api key");
  if (apiKey.revoked_at) throw new VerifyError(401, "api key revoked");
  if (!Array.isArray(apiKey.scopes) || !apiKey.scopes.includes(requiredScope)) {
    throw new VerifyError(403, "insufficient scope");
  }

  // Replay protection: (api_key_id, nonce) is unique.
  const { error: nonceErr } = await admin
    .from("ingest_nonces")
    .insert({ api_key_id: apiKey.id, nonce: body.nonce });
  if (nonceErr) {
    if ((nonceErr as { code?: string }).code === "23505") {
      throw new VerifyError(401, "replay: nonce already seen");
    }
    throw new VerifyError(500, `nonce insert: ${nonceErr.message}`);
  }

  // Best-effort last-used stamp.
  await admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);

  return {
    apiKey: {
      id: apiKey.id,
      product_id: apiKey.product_id,
      scopes: apiKey.scopes,
    },
    body,
  };
}

/**
 * Lighter auth for read-only GET feeds (feed-blog, feed-wiki-answers): validate
 * the bearer key + scope. No nonce/timestamp — pulls are idempotent reads, so
 * replay isn't a concern.
 */
export async function verifyApiKeyReadOnly(
  req: Request,
  admin: SupabaseClient,
  requiredScope: string,
): Promise<ApiKeyRow> {
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new VerifyError(401, "missing bearer token");

  const keyHash = await sha256Hex(match[1].trim());
  const { data: apiKey, error } = await admin
    .from("api_keys")
    .select("id, product_id, scopes, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (error) throw new VerifyError(500, `db error: ${error.message}`);
  if (!apiKey) throw new VerifyError(401, "invalid api key");
  if (apiKey.revoked_at) throw new VerifyError(401, "api key revoked");
  if (!Array.isArray(apiKey.scopes) || !apiKey.scopes.includes(requiredScope)) {
    throw new VerifyError(403, "insufficient scope");
  }

  await admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id);

  return {
    id: apiKey.id,
    product_id: apiKey.product_id,
    scopes: apiKey.scopes,
  };
}

/** Bound requests per key by counting recent nonce rows. Throws 429 over budget. */
export async function enforceRateLimit(
  admin: SupabaseClient,
  apiKeyId: string,
  maxRequests: number,
  windowSecs = 60,
): Promise<void> {
  const since = new Date(Date.now() - windowSecs * 1000).toISOString();
  const { count, error } = await admin
    .from("ingest_nonces")
    .select("id", { count: "exact", head: true })
    .eq("api_key_id", apiKeyId)
    .gte("seen_at", since);
  if (error) {
    console.warn("[verify-api-key] rate-limit count failed:", error.message);
    return;
  }
  if ((count ?? 0) > maxRequests) {
    throw new VerifyError(429, "rate limit exceeded");
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Best-effort fan-out of an edge 5xx to the same alerting sink the Next app
 * uses (`ERROR_WEBHOOK_URL`). No-op when unset — the console.error line above is
 * the durable record. Without this the ingestion functions — the product-facing
 * telemetry intake — could 500 indefinitely while only the Next app's failures
 * ever paged anyone. Delivery is fire-and-forget; on Supabase edge,
 * `EdgeRuntime.waitUntil` keeps the isolate alive until the POST settles. Set the
 * var for edge with `supabase secrets set ERROR_WEBHOOK_URL=...`.
 */
export function reportEdgeError(scope: string, message: string): void {
  const url = Deno.env.get("ERROR_WEBHOOK_URL");
  if (!url) return;
  const send = fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `[rcp] ${scope}: ${message}`,
      source: "rcp-edge",
      scope,
      message,
      at: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(5000),
  })
    .then(() => {})
    .catch(() => {
      // Best-effort — the stderr line is the durable record.
    });
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (er?.waitUntil) er.waitUntil(send);
  else void send;
}

export function errorResponse(e: unknown): Response {
  if (e instanceof VerifyError) {
    // 4xx messages are our own validation/auth text (safe to return). 5xx
    // VerifyErrors wrap raw DB/PostgREST errors — log those, return generic.
    if (e.status >= 500) {
      console.error("[ingest] internal error:", e.message);
      reportEdgeError("ingest", e.message);
      return jsonResponse(e.status, { error: "internal" });
    }
    return jsonResponse(e.status, { error: e.message });
  }
  const detail = e instanceof Error ? e.message : String(e);
  console.error("[ingest] internal error:", detail);
  reportEdgeError("ingest", detail);
  return jsonResponse(500, { error: "internal" });
}

export function adminClientFromEnv(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new VerifyError(500, "edge function misconfigured");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
