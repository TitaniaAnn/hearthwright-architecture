import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";

/**
 * Best-effort client IP from the proxy headers. We only need a stable-ish key
 * to bucket abuse by; a spoofed/missing value just falls into a shared bucket.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Fixed-window rate limit for the public, anon-writable server actions. Returns
 * true when the request is within budget, false when it should be throttled.
 *
 * Fails OPEN: if the limiter RPC errors (DB hiccup, misconfig) we let the write
 * through rather than block a legitimate user. The honeypot + validation still
 * apply, so failing open degrades to "no rate limit", not "no protection".
 */
export async function rateLimitOk(
  action: string,
  max: number,
  windowSecs: number,
): Promise<boolean> {
  try {
    const ip = await clientIp();
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("rate_limit_check", {
      p_bucket: `${action}:${ip}`,
      p_max: max,
      p_window_secs: windowSecs,
    });
    // Fail open, but not silently: an unobserved limiter outage means abuse
    // protection has quietly stopped working with no way to know.
    if (error) {
      logError("rate-limit.rpc", error, { action });
      return true;
    }
    return data !== false;
  } catch (e) {
    logError("rate-limit.exception", e, { action });
    return true; // fail open
  }
}
