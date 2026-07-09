// POST /functions/v1/ingest-usage
// Body: { events: [{ event_name, anon_id?, session_id?, platform?, app_version?,
//                     properties?, occurred_at? }], nonce, timestamp }
// Auth: Authorization: Bearer <product key with "usage" scope>

import { serveBatchIngest } from "../_shared/batch-ingest.ts";
import { str, normalizeTimestamp, clampJson } from "../_shared/payload.ts";

const MAX_EVENTS = 500;

serveBatchIngest({
  scope: "usage",
  rateLimit: 120,
  arrayKey: "events",
  noun: "events",
  maxItems: MAX_EVENTS,
  mapRow: (event, apiKey) => {
    const event_name = str(event.event_name, 200);
    if (!event_name) return null;
    return {
      product_id: apiKey.product_id,
      event_name,
      anon_id: str(event.anon_id, 128),
      session_id: str(event.session_id, 128),
      platform: str(event.platform, 64),
      app_version: str(event.app_version, 64),
      properties: clampJson(event.properties, 8000),
      occurred_at: normalizeTimestamp(event.occurred_at),
    };
  },
  persist: async (admin, rows) => {
    const { error } = await admin.from("usage_events").insert(rows);
    return { error };
  },
});
