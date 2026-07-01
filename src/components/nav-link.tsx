"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ROOTS = new Set(["/admin", "/dashboard"]);

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = ROOTS.has(href)
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? "bg-terracotta/15 text-clay font-medium"
          : "text-charcoal-2 hover:bg-cream-2"
      }`}
    >
      {children}
    </Link>
  );
}
