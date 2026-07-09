import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRelativePath } from "@/lib/url";
import { logError } from "@/lib/observability";

/**
 * OAuth / PKCE callback. Exchanges the auth code for a session cookie, then
 * redirects to `next` (defaults to the dashboard). Also serves the password
 * recovery link, which arrives here with a code and `next=/reset-password`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRelativePath(searchParams.get("next"), "/dashboard");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    // A failed exchange bounces the user to /login?error=auth with no other
    // signal — log it so a broken OAuth/recovery config is diagnosable.
    logError("auth.callback.exchange", error);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
