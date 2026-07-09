import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Refreshes the session on every request and gates the authenticated areas.
 * This only checks that a user is signed in — the actual role check (employee
 * vs admin) happens server-side in each segment's layout, with RLS as the
 * backstop.
 */
export async function middleware(request: NextRequest) {
  // One correlation id per request, spanning client → app → edge. Reuse an
  // inbound id if the caller (a product's edge client, a retry) already set one,
  // so the trace joins up; otherwise mint a fresh one. `crypto` is a global in
  // the Edge runtime.
  const requestId =
    request.headers.get("x-rcp-request-id") ?? crypto.randomUUID();
  const { response, user } = await updateSession(request, requestId);

  const { pathname } = request.nextUrl;
  const isProtected =
    pathname.startsWith("/admin") || pathname.startsWith("/dashboard");

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectTo", pathname);
    const redirect = NextResponse.redirect(url);
    redirect.headers.set("x-rcp-request-id", requestId);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
