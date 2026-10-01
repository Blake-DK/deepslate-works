import { readOption } from "@/server/logo-options";

// The planner's eight logo options (branding/logo-options in the repo, copied into the image), for Admin → Branding's
// previews. Our own files; served as pictures that may run nothing all the same.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const svg = await readOption((await params).file.replace(/\.svg$/, ""));
  if (!svg) return new Response("Not found", { status: 404 });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
