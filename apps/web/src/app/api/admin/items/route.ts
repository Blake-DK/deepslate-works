import { auth } from "@/auth";
import { db } from "@/server/db";
import { getCatalogue } from "@/server/items";

export const dynamic = "force-dynamic";

// Admin only: every item the server knows, for the inventory editor's picker (docs/13 §13).
export async function GET() {
  const session = await auth();
  const user = session?.user?.id ? await db.user.findUnique({ where: { id: session.user.id }, select: { role: true } }) : null;
  if (user?.role !== "ADMIN") return Response.json({ error: { code: "forbidden", message: "admin only" } }, { status: 403 });
  return Response.json({ items: await getCatalogue() }, { headers: { "cache-control": "private, max-age=300" } });
}
