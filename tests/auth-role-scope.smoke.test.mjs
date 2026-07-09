// Regression guard: the employee_roles role lookup must be scoped to the caller.
// The SELECT policy is `user_id = app_user_id() OR is_admin()`, so an unfiltered
// query returns every row for an admin (multiple rows -> maybeSingle null ->
// admin locked out). The role query must filter by user_id.
//
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const auth = readFileSync(root + "src/lib/auth.ts", "utf8");

test("the employee_roles role lookup is scoped by user_id", () => {
  assert.match(auth, /from\("employee_roles"\)/, "queries employee_roles");
  assert.match(
    auth,
    /from\("employee_roles"\)[\s\S]{0,160}\.eq\("user_id",/,
    "the employee_roles role query must filter by user_id (admins see every row)",
  );
});

test("role resolution flows through requireRole and getRole", () => {
  assert.match(auth, /export async function requireRole/);
  assert.match(auth, /export async function getRole/);
  // Both should resolve via the scoped helper rather than an ad-hoc query.
  assert.match(auth, /roleForAuthUser\(/);
});
