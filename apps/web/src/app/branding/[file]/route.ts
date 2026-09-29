import { readImage } from "@/server/branding";

// The logo, favicon and login banner (docs/16 §5). Public: the login page shows them before anyone has
// signed in. The name carries a hash of the content, so it can be cached for good. SVGs were rebuilt from an
// allow-list when they were uploaded; the policy below forbids scripts all the same.
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const img = await readImage((await params).file);
  if (!img) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  return new Response(new Uint8Array(img.data), {
    headers: {
      "content-type": img.type,
      "content-length": String(img.data.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "content-disposition": "inline",
      "cross-origin-resource-policy": "same-site",
    },
  });
}
