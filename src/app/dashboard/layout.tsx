import { requireRole } from "@/lib/auth";
import { WorkspaceShell, type NavItem } from "@/components/workspace-shell";

// Sections without an href ship in later phases (rendered as "soon").
const NAV: NavItem[] = [
  { label: "Overview", href: "/dashboard" },
  { label: "Triage", href: "/dashboard/triage" },
  { label: "Usage", href: "/dashboard/usage" },
  { label: "Errors", href: "/dashboard/errors" },
  { label: "Wiki", href: "/dashboard/wiki" },
  { label: "Design specs", href: "/dashboard/design-specs" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, role } = await requireRole("employee");

  return (
    <WorkspaceShell
      badge={role === "admin" ? "Admin" : "Team"}
      nav={NAV}
      userEmail={user.email ?? ""}
    >
      {children}
    </WorkspaceShell>
  );
}
