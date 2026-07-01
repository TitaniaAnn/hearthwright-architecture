import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "employee";

/** The current session's public.users.id, or null. */
export async function getAppUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  return data?.id ?? null;
}

/** The current employee role, or null for a public/unauthenticated user. */
export async function getRole(): Promise<Role | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS limits this to the caller's own row.
  const { data } = await supabase
    .from("employee_roles")
    .select("role")
    .maybeSingle();

  return (data?.role as Role | undefined) ?? null;
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

  const { data } = await supabase
    .from("employee_roles")
    .select("role")
    .maybeSingle();
  const role = data?.role as Role | undefined;

  const ok =
    required === "employee"
      ? role === "employee" || role === "admin"
      : role === "admin";

  if (!ok) redirect("/?error=forbidden");

  return { user, role: role! };
}
