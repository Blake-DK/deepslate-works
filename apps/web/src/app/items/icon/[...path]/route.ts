import { readFile } from "node:fs/promises";
import { iconFile } from "@/server/items";
import { loadCurrentUser } from "@/server/auth/session";

// An item's picture from the catalogue build (docs/13 §13). Signed-in members only; files the build wrote, nothing
// else. The check is here, not in the middleware: its matcher skips every address that ends in .png (docs/31 B-33).
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await loadCurrentUser())) return new Response("sign in first", { status: 401 });
  const file = iconFile((await params).path.join("/"));
  const png = file ? await readFile(file).catch(() => null) : null;
  if (!png) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
