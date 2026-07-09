import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/observability";
import { withRequestId } from "@/lib/request-context";

// A probe must reflect current state — never statically optimized or cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Liveness/readiness probe for external uptime monitors. Pings the database with
 * a HEAD read (no rows, no PII) and returns 200 when it's reachable, 503 when it
 * isn't. Public and intentionally low-information — it never leaks error detail;
 * the underlying failure is captured server-side via logError. Any failure
 * (query error, missing env, client construction) resolves to 503, never a crash.
 */
export async function GET() {
  return withRequestId(async () => {
    try {
      // Use the anon client (least privilege) for a plain connectivity check:
      // anon has base SELECT on the public-read tables (migrations 0020/0021),
      // whereas service_role is intentionally not granted it, and this exercises
      // the same read path real visitors hit. A public product row is enough to
      // prove the DB is reachable.
      const supabase = await createClient();
      const { error } = await supabase.from("products").select("id").limit(1);
      if (error) throw error;
      return NextResponse.json(
        { status: "ok", db: "ok" },
        { status: 200, headers: NO_STORE },
      );
    } catch (e) {
      logError("health.db", e);
      return NextResponse.json(
        { status: "degraded", db: "error" },
        { status: 503, headers: NO_STORE },
      );
    }
  });
}
