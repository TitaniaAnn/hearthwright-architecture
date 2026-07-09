/**
 * Validate a user-supplied redirect target as a safe, same-origin relative
 * path. Rejects protocol-relative (`//evil.com`) and backslash (`/\evil.com`)
 * forms that browsers resolve as absolute cross-origin URLs. Returns `fallback`
 * for anything unsafe.
 */
export function safeRelativePath(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return fallback;
  }
  return value;
}

/**
 * Return `href` only if it's a safe link target — a same-origin relative path
 * or an http(s)/mailto/tel URL — else null. Blocks `javascript:`, `data:`, and
 * protocol-relative URLs in authored content (CTA links, etc.).
 */
export function safeLinkHref(href: string): string | null {
  if (href.startsWith("/")) {
    return href.startsWith("//") || href.startsWith("/\\") ? null : href;
  }
  return /^(https?:\/\/|mailto:|tel:)/i.test(href) ? href : null;
}
