import { getBranding } from "@/server/branding";

// iOS asks for /apple-touch-icon.png on its own; 180 px is its size.
export async function GET(req: Request) {
  const b = await getBranding();
  return b.generated ? Response.redirect(new URL(b.generated.url(180), req.url), 302) : new Response("Not found", { status: 404 });
}
