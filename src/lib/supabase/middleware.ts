import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Refreshes the Supabase auth session on every request and returns the current
 * user. Cookie writes are mirrored onto the response so the refreshed session
 * propagates back to the browser. Call from the root middleware.
 *
 * Also threads the correlation id (`requestId`): forwarded to the handler on the
 * request headers (so a server action / route reads it via `headers()` and it
 * matches the server log lines) and echoed on the response (client-visible and
 * joinable with the edge functions). The cookie-refresh `setAll` path is left
 * exactly as-is — session propagation is untouched.
 */
export async function updateSession(
  request: NextRequest,
  requestId: string,
): Promise<{ response: NextResponse; user: User | null }> {
  // Clone request.headers (includes the cookie header) and add the id, so the
  // forwarded request carries both the session cookies and the correlation id.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-rcp-request-id", requestId);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the token with the auth server; don't
  // trust getSession() in server code.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Echo the id on whichever response object is current (the setAll path may
  // have replaced it), so every response carries it regardless of a refresh.
  response.headers.set("x-rcp-request-id", requestId);
  return { response, user };
}
