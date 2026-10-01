import { getBranding } from "@/server/branding";

// /favicon.ico, which browsers and link unfurlers ask for on their own: the chosen logo's .ico, else the site's icon.
export async function GET(req: Request) {
  const b = await getBranding();
  return Response.redirect(new URL(b.generated ? b.generated.url("ico") : "/icon.svg", req.url), 302);
}
