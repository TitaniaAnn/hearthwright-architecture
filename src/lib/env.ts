/**
 * Read a required environment variable, failing loudly if it's missing.
 *
 * The Supabase clients previously used `process.env.X!`, which constructs a
 * client with `undefined` when a var is unset and only surfaces an opaque error
 * deep in a later request. `requireEnv` turns a misconfiguration into a clear,
 * immediate failure naming the offending variable.
 *
 * Server-side only: dynamic `process.env[name]` access is NOT inlined by the
 * Next bundler, so this must not be used for `NEXT_PUBLIC_*` vars in Client
 * Components (the browser would always see `undefined`). Client Components read
 * those with static `process.env.NEXT_PUBLIC_X` access instead.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
