import { bearer, revokeLauncherToken } from "@/server/launcher";
import { audit } from "@/server/events";

export const dynamic = "force-dynamic";

// The uninstaller (DeepslateWorks.ps1 -Uninstall, 1.5.2) signs this PC out before it deletes its sign-in: the token
// it sends stops working at once. Only that token; the member's other PCs and their account are left alone.
export async function POST(req: Request) {
  const token = bearer(req);
  const done = token ? await revokeLauncherToken(token) : null;
  if (!done) return Response.json({ error: { code: "unauthorized", message: "No such sign-in" } }, { status: 401, headers: { "cache-control": "no-store" } });
  await audit({ userId: done.userId, action: "launcher.revoke.self", params: {}, result: "OK" });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
