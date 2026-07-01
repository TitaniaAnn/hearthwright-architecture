import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * On-demand revalidation for external triggers (e.g. a future content webhook).
 * Admin server actions revalidate in-process; this endpoint covers out-of-band
 * updates. Protected by a shared secret.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidate-secret");
  if (!process.env.REVALIDATE_SECRET || secret !== process.env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let path = "/";
  try {
    const body = (await request.json()) as { path?: string };
    if (body.path && body.path.startsWith("/")) path = body.path;
  } catch {
    // no body → revalidate home
  }

  revalidatePath(path);
  return NextResponse.json({ revalidated: true, path });
}
