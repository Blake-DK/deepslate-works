import { loadCurrentUser } from "@/server/auth/session";
import { readPhoto } from "@/server/news-images";

// Pictures of news items (docs/05). For members who are signed in, like the news itself. The name carries a hash
// of the content, so a browser may keep it for good.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!(await loadCurrentUser())) return new Response("Sign in first", { status: 401, headers: { "content-type": "text/plain; charset=utf-8" } });
  const img = await readPhoto((await params).file);
  if (!img) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "content-type": img.type,
      "content-length": String(img.data.length),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
