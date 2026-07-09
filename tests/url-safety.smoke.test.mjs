// Regression guards for redirect/link safety: user-supplied redirect targets
// must flow through safeRelativePath, which rejects the protocol-relative and
// backslash forms browsers resolve as absolute cross-origin URLs.
// Source-level, consistent with the other smoke tests.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

test("safeRelativePath rejects protocol-relative / backslash forms", () => {
  const url = read("src/lib/url.ts");
  assert.match(url, /startsWith\("\/\/"\)/, "must reject //evil.com");
  assert.match(url, /startsWith\("\/\\\\"\)/, "must reject /\\\\evil.com");
});

test("the auth callback's redirect target flows through safeRelativePath", () => {
  const cb = read("src/app/(auth)/auth/callback/route.ts");
  assert.match(cb, /safeRelativePath\(/);
  // The old hand-rolled check (startsWith("/") only) let //evil.com through.
  assert.doesNotMatch(cb, /nextParam\.startsWith\("\/"\)/);
});

test("safeLinkHref allowlists schemes rather than blocklisting", () => {
  const url = read("src/lib/url.ts");
  assert.match(url, /export function safeLinkHref/);
  // An allowlist test (https?://, mailto:, tel:) — anything else (javascript:,
  // data:, protocol-relative) falls through to null.
  assert.match(url, /\^\(https\?:\\\/\\\/\|mailto:\|tel:\)/, "allowlists http(s)/mailto/tel");
});
