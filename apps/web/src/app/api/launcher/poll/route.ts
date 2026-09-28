import { pollLauncherAuth } from "@/server/launcher";

// Public: the installer polls with its pollToken until the user has approved the code in the browser.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return Response.json({ status: "expired" }, { status: 400 });
  const r = await pollLauncherAuth(token);
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
