import { loadCurrentUser } from "@/server/auth/session";
import { getCatalogue } from "@/server/items";

export const dynamic = "force-dynamic";

// Admin only: every item the server knows, for the inventory editor's picker (docs/13 §13).
export async function GET() {
  const user = await loadCurrentUser(); // checks the session is still good (docs/04 "Ending sessions")
  if (user?.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  return Response.json({ items: await getCatalogue() }, { headers: { "cache-control": "private, max-age=300" } });
}
