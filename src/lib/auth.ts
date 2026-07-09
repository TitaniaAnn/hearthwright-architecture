import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Role = "admin" | "employee";

/** Resolve the public.users.id for an auth user id, or null. */
async function appUserIdFor(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  return data?.id ?? null;
}

/** The current session's public.users.id, or null. */
export async function getAppUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return appUserIdFor(supabase, user.id);
}

/**
 * The caller's employee role, or null. Scoped to the caller's OWN row: the
 * employee_roles SELECT policy is `user_id = app_user_id() OR is_admin()`, so it
 * also exposes every row to admins (so they can manage roles). An unfiltered
 * `.maybeSingle()` therefore returns multiple rows for an admin once a second
 * employee exists and silently resolves to null — locking admins out. Filter by
 * the caller's user id so exactly their row (0 or 1) comes back.
 */
async function roleForAuthUser(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<Role | null> {
  const appUserId = await appUserIdFor(supabase, authUserId);
  if (!appUserId) return null;

  const { data } = await supabase
    .from("employee_roles")
    .select("role")
    .eq("user_id", appUserId)
    .maybeSingle();
  return (data?.role as Role | undefined) ?? null;
}

/** The current employee role, or null for a public/unauthenticated user. */
export async function getRole(): Promise<Role | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return roleForAuthUser(supabase, user.id);
}

/**
 * Require at least `required` access for a server-rendered segment.
 * Redirects unauthenticated users to /login and under-privileged users home.
 * Returns the authenticated user and their role.
 */
export async function requireRole(required: Role) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const role = await roleForAuthUser(supabase, user.id);

  const ok =
    required === "employee"
      ? role === "employee" || role === "admin"
      : role === "admin";

  if (!ok) redirect("/?error=forbidden");

  return { user, role: role! };
}
