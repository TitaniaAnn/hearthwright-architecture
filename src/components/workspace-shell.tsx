import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { NavLink } from "@/components/nav-link";

export type NavItem = { label: string; href?: string };

/**
 * Shared chrome for the authenticated areas (/admin and /dashboard): a top bar
 * with the workspace name + signed-in user, and a left nav. Nav items without
 * an href render as muted "soon" placeholders for sections shipping in later
 * phases.
 */
export function WorkspaceShell({
  badge,
  nav,
  userEmail,
  children,
}: {
  badge: string;
  nav: NavItem[];
  userEmail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="border-b border-slate bg-white">
        <div className="px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-display text-lg font-semibold">
              Reference Control Plane
            </Link>
            <span className="rounded-full bg-charcoal px-2 py-0.5 text-xs font-medium text-cream">
              {badge}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-charcoal-2">{userEmail}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="w-56 shrink-0 border-r border-slate bg-cream/60 p-3">
          <nav className="flex flex-col gap-1">
            {nav.map((item) =>
              item.href ? (
                <NavLink key={item.label} href={item.href}>
                  {item.label}
                </NavLink>
              ) : (
                <span
                  key={item.label}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-slate-2"
                >
                  {item.label}
                  <span className="text-[10px] uppercase tracking-wide">
                    soon
                  </span>
                </span>
              ),
            )}
          </nav>
        </aside>

        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
