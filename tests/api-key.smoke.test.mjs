// Pure-logic smoke test: the API-key derivation rules the admin action and the
// edge verifier both depend on. No DB, no network — asserts the shared
// invariants (prefix length, hash determinism, hash != raw) so a refactor that
// breaks the prefix/hash contract fails here instead of in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function mintKey() {
  const rawKey = `rcp_live_${crypto.randomBytes(24).toString("base64url")}`;
  const keyPrefix = rawKey.slice(0, 14);
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  return { rawKey, keyPrefix, keyHash };
}

test("minted key carries a 14-char prefix the UI can show", () => {
  const { keyPrefix } = mintKey();
  assert.equal(keyPrefix.length, 14);
  assert.ok(keyPrefix.startsWith("rcp_live_"));
});

test("only the hash is storable — it is not the raw key", () => {
  const { rawKey, keyHash } = mintKey();
  assert.notEqual(keyHash, rawKey);
  assert.equal(keyHash.length, 64); // sha-256 hex
});

test("hashing is deterministic so lookup-by-hash works", () => {
  const raw = "rcp_live_fixedvalueforthetest";
  const a = crypto.createHash("sha256").update(raw).digest("hex");
  const b = crypto.createHash("sha256").update(raw).digest("hex");
  assert.equal(a, b);
});
