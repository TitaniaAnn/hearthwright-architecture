import { requireRole } from "@/lib/auth";
import { WorkspaceShell, type NavItem } from "@/components/workspace-shell";

// Sections without an href ship in later phases (rendered as "soon").
const NAV: NavItem[] = [
  { label: "Overview", href: "/admin" },
  { label: "Pages", href: "/admin/pages" },
  { label: "Products", href: "/admin/products" },
  { label: "Blog", href: "/admin/blog" },
  { label: "Changelog", href: "/admin/changelog" },
  { label: "Releases", href: "/admin/releases" },
  { label: "Status", href: "/admin/status" },
  { label: "Newsletter", href: "/admin/newsletter" },
  { label: "Contact", href: "/admin/contact" },
  { label: "API keys", href: "/admin/api-keys" },
  { label: "Team" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireRole("admin");

  return (
    <WorkspaceShell badge="Admin" nav={NAV} userEmail={user.email ?? ""}>
      {children}
    </WorkspaceShell>
  );
}
