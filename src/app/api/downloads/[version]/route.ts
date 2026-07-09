import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logError } from "@/lib/observability";

const RELEASES_BUCKET = "releases";
const PRODUCT_SLUG = "example-app";

/**
 * Public download for a self-hosted release. Looks up the published release by
 * version, bumps the atomic download counter, then 307-redirects to a
 * short-lived signed URL. The artifact bucket stays private so every download
 * is counted and the checksum on the download page is authoritative.
 *
 * Why not serve a static file from a public bucket? Because then downloads
 * aren't counted, the file can be hotlinked, and you lose the single
 * choke-point where the counter increments. The signed-URL indirection costs
 * one extra round-trip and buys all three.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string }> },
) {
  const { version } = await params;
  const admin = createAdminClient();

  const { data: product, error: productErr } = await admin
    .from("products")
    .select("id")
    .eq("slug", PRODUCT_SLUG)
    .maybeSingle();
  // A DB error here otherwise redirects as if the product simply doesn't exist.
  if (productErr) logError("download.route.product", productErr, { version });
  if (!product) {
    return NextResponse.redirect(new URL("/download", _request.url));
  }

  // Prefer a stable-channel build when both exist for a version.
  const { data: releases, error: releasesErr } = await admin
    .from("releases")
    .select("id, storage_path, file_name")
    .eq("product_id", product.id)
    .eq("version", version)
    .eq("is_published", true)
    .order("channel", { ascending: false })
    .limit(1);
  // Likewise, a DB error otherwise looks identical to "no such version".
  if (releasesErr) logError("download.route.releases", releasesErr, { version });

  const release = releases?.[0];
  if (!release) {
    return NextResponse.redirect(new URL("/download?error=notfound", _request.url));
  }

  // Atomic, RLS-free counter bump. Counting is the whole reason downloads route
  // through here, so a silent failure defeats the endpoint — log, don't block.
  const { error: counterErr } = await admin.rpc("increment_download", {
    release_id: release.id,
  });
  if (counterErr) {
    logError("download.route.counter", counterErr, { release_id: release.id });
  }

  const { data: signed, error } = await admin.storage
    .from(RELEASES_BUCKET)
    .createSignedUrl(release.storage_path, 60, { download: release.file_name });
  if (error || !signed) {
    logError("download.route.signedUrl", error ?? "no signed url returned", {
      release_id: release.id,
    });
    return NextResponse.redirect(new URL("/download?error=unavailable", _request.url));
  }

  return NextResponse.redirect(signed.signedUrl, 307);
}
