"use server";

import crypto from "node:crypto";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { logError } from "@/lib/observability";
import { API_KEY_SCOPES } from "@/lib/types";

export type CreateKeyState = { rawKey?: string; error?: string };

export async function createApiKey(
  _prev: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  await requireRole("admin");

  const parsed = z
    .object({
      product_id: z.string().uuid(),
      name: z.string().trim().min(1),
    })
    .safeParse({
      product_id: formData.get("product_id"),
      name: formData.get("name"),
    });
  if (!parsed.success) return { error: "Name and product are required." };

  const allowed = API_KEY_SCOPES as readonly string[];
  const scopes = formData
    .getAll("scopes")
    .map(String)
    .filter((s) => allowed.includes(s));
  if (scopes.length === 0) return { error: "Select at least one scope." };

  // rcp_live_<random>. The raw key is shown once; only its hash is stored.
  const rawKey = `rcp_live_${crypto.randomBytes(24).toString("base64url")}`;
  const key_prefix = rawKey.slice(0, 14);
  const key_hash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const supabase = await createClient();
  const { error } = await supabase.from("api_keys").insert({
    product_id: parsed.data.product_id,
    name: parsed.data.name,
    key_prefix,
    key_hash,
    scopes,
  });
  if (error) {
    logError("admin.apiKeys.createApiKey", error);
    return { error: error.message };
  }

  revalidatePath("/admin/api-keys");
  return { rawKey };
}

export async function revokeApiKey(formData: FormData) {
  await requireRole("admin");
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    logError("admin.apiKeys.revokeApiKey", error);
    throw new Error(error.message);
  }
  revalidatePath("/admin/api-keys");
}
