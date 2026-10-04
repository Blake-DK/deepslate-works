import { readOption } from "@/server/logo-options";
import { loadCurrentUser } from "@/server/auth/session";

// The planner's eight logo options (branding/logo-options in the repo, copied into the image), for Admin → Branding's
// previews. Our own files; served as pictures that may run nothing all the same.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  // admins only, checked here: the middleware's matcher skips every address that ends in .svg (docs/31 B-33)
  if ((await loadCurrentUser())?.role !== "ADMIN") return new Response("Not found", { status: 404 });
  const svg = await readOption((await params).file.replace(/\.svg$/, ""));
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
