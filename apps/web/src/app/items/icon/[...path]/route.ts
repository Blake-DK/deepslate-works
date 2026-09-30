import { readFile } from "node:fs/promises";
import { iconFile } from "@/server/items";

// An item's picture from the catalogue build (docs/13 §13). Signed-in members only (the middleware); files the
// build wrote, nothing else.
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const file = iconFile((await params).path.join("/"));
  const png = file ? await readFile(file).catch(() => null) : null;
  if (!png) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
}
