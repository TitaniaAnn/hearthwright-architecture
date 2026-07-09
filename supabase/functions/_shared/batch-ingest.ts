// Shared handler for the batch ingestion endpoints. This cut ships one
// (ingest-usage); the omitted error/feedback/wiki functions follow the same
// shape:
//
//   auth (bearer key + scope) → rate limit → pull the batch array → bound its
//   size → map+validate each item to a row (dropping invalid ones) → persist →
//   respond { accepted }.
//
// Only the scope, batch key, caps, per-row mapping, and the persist call differ,
// so those are the config; everything else lives here once.

import {
  verifyApiKeyRequest,
  enforceRateLimit,
  jsonResponse,
  errorResponse,
  adminClientFromEnv,
  VerifyError,
  type ApiKeyRow,
} from "./verify-api-key.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

type Row = Record<string, unknown>;

export interface BatchIngestConfig {
  /** Required API-key scope, e.g. "usage" or "feedback:write". */
  scope: string;
  /** Per-key request budget passed to enforceRateLimit. */
  rateLimit: number;
  /** The body field holding the batch array, e.g. "events". */
  arrayKey: string;
  /** Noun for the 400 messages: "no <noun>" / "too many <noun>". */
  noun: string;
  /** Hard cap on items per request. */
  maxItems: number;
  /** Map one raw item to a row, or null to drop it (validation failed). */
  mapRow: (item: Record<string, unknown>, apiKey: ApiKeyRow) => Row | null;
  /** Persist the validated rows. Return the PostgREST { error }. */
  persist: (
    admin: SupabaseClient,
    rows: Row[],
  ) => Promise<{ error: { message: string } | null }>;
}

/** Wire up `Deno.serve` for one batch ingestion endpoint. */
export function serveBatchIngest(config: BatchIngestConfig): void {
  Deno.serve(async (req) => {
    try {
      const admin = adminClientFromEnv();
      const { apiKey, body } = await verifyApiKeyRequest<
        { nonce: string; timestamp: string } & Record<string, unknown>
      >(req, admin, config.scope);
      await enforceRateLimit(admin, apiKey.id, config.rateLimit);

      const raw = body[config.arrayKey];
      const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : [];
      if (items.length === 0) {
        return jsonResponse(400, { error: `no ${config.noun}` });
      }
      if (items.length > config.maxItems) {
        throw new VerifyError(
          400,
          `too many ${config.noun} (max ${config.maxItems})`,
        );
      }

      const rows: Row[] = [];
      for (const item of items) {
        const row = config.mapRow(item, apiKey);
        if (row !== null) rows.push(row);
      }
      if (rows.length === 0) {
        return jsonResponse(400, { error: `no valid ${config.noun}` });
      }

      const { error } = await config.persist(admin, rows);
      if (error) throw new VerifyError(500, error.message);

      return jsonResponse(200, { accepted: rows.length });
    } catch (e) {
      return errorResponse(e);
    }
  });
}
