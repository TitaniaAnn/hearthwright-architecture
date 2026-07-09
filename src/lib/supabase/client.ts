import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components (runs in the browser). */
export function createClient() {
  // Static `process.env.NEXT_PUBLIC_*` access (not the dynamic requireEnv) so
  // the Next bundler inlines these into the client bundle; validate the inlined
  // values so a misconfigured build fails loudly instead of silently.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return createBrowserClient(url, anonKey);
}
