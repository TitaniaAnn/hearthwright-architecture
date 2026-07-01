// POST /functions/v1/ingest-usage
// Body: { events: [{ event_name, anon_id?, session_id?, platform?, app_version?,
//                     properties?, occurred_at? }], nonce, timestamp }
// Auth: Authorization: Bearer <product key with "usage" scope>

import {
  verifyApiKeyRequest,
  enforceRateLimit,
  jsonResponse,
  errorResponse,
  adminClientFromEnv,
  VerifyError,
} from "../_shared/verify-api-key.ts";

const MAX_EVENTS = 500;

interface UsageEvent {
  event_name?: unknown;
  anon_id?: unknown;
  session_id?: unknown;
  platform?: unknown;
  app_version?: unknown;
  properties?: unknown;
  occurred_at?: unknown;
}

interface Body {
  events?: UsageEvent[];
  nonce: string;
  timestamp: string;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.slice(0, max);
}

Deno.serve(async (req) => {
  try {
    const admin = adminClientFromEnv();
    const { apiKey, body } = await verifyApiKeyRequest<Body>(req, admin, "usage");
    await enforceRateLimit(admin, apiKey.id, 120);

    const events = Array.isArray(body.events) ? body.events : [];
    if (events.length === 0) return jsonResponse(400, { error: "no events" });
    if (events.length > MAX_EVENTS) {
      throw new VerifyError(400, `too many events (max ${MAX_EVENTS})`);
    }

    const rows = events
      .map((e) => ({
        product_id: apiKey.product_id,
        event_name: str(e.event_name, 200),
        anon_id: str(e.anon_id, 128),
        session_id: str(e.session_id, 128),
        platform: str(e.platform, 64),
        app_version: str(e.app_version, 64),
        properties:
          e.properties && typeof e.properties === "object" ? e.properties : {},
        occurred_at:
          typeof e.occurred_at === "string"
            ? e.occurred_at
            : new Date().toISOString(),
      }))
      .filter((r) => r.event_name);

    if (rows.length === 0) {
      return jsonResponse(400, { error: "no valid events" });
    }

    const { error } = await admin.from("usage_events").insert(rows);
    if (error) throw new VerifyError(500, error.message);

    return jsonResponse(200, { accepted: rows.length });
  } catch (e) {
    return errorResponse(e);
  }
});
