"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getAppUserId } from "@/lib/auth";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function createPost(formData: FormData) {
  await requireRole("admin");
  const title = z.string().trim().min(1).parse(formData.get("title"));
  const slugRaw = (formData.get("slug") as string)?.trim();
  const slug = slugRaw ? slugify(slugRaw) : slugify(title);
  const me = await getAppUserId();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .insert({ title, slug, author_user_id: me })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  revalidatePath("/admin/posts");
  redirect(`/admin/posts/${data.id}`);
}

export async function updatePost(formData: FormData) {
  await requireRole("admin");
  const parsed = z
    .object({
      id: z.string().uuid(),
      title: z.string().trim().min(1),
      slug: z.string().trim().min(1),
      excerpt: z
        .string()
        .trim()
        .optional()
        .transform((v) => (v ? v : null)),
      body_md: z
        .string()
        .optional()
        .transform((v) => (v ? v : null)),
      product_id: z
        .string()
        .uuid()
        .or(z.literal(""))
        .transform((v) => (v ? v : null)),
      tags: z.string().optional(),
      is_published: z.boolean(),
    })
    .parse({
      id: formData.get("id"),
      title: formData.get("title"),
      slug: formData.get("slug"),
      excerpt: formData.get("excerpt") ?? "",
      body_md: formData.get("body_md") ?? "",
      product_id: formData.get("product_id") ?? "",
      tags: formData.get("tags") ?? "",
      is_published: formData.get("is_published") === "on",
    });

  const tags = (parsed.tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const supabase = await createClient();
  const { error } = await supabase
    .from("posts")
    .update({
      title: parsed.title,
      slug: parsed.slug,
      excerpt: parsed.excerpt,
      body_md: parsed.body_md,
      product_id: parsed.product_id,
      tags,
      is_published: parsed.is_published,
      published_at: parsed.is_published ? new Date().toISOString() : null,
    })
    .eq("id", parsed.id);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/posts");
  revalidatePath("/posts");
  revalidatePath(`/posts/${parsed.slug}`);
  redirect("/admin/posts?saved=1");
}

export async function deletePost(formData: FormData) {
  await requireRole("admin");
  const id = z.string().uuid().parse(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("posts")
    .update({ deleted_at: new Date().toISOString(), is_published: false })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/posts");
  revalidatePath("/posts");
  redirect("/admin/posts");
}
