import { readFile } from "node:fs/promises";
import path from "node:path";
import { GENERATED_DIR } from "@/server/branding";

// The chosen logo at every size and as .ico (made at Build into dist/branding). Public: the favicon, the sign-in page
// and link previews need it before anyone signs in. Links carry ?v=<hash>, so a new logo is a new address.
const NAME = /^(logo-(16|32|48|64|128|180|192|256|512)\.png|logo\.ico)$/;

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const file = (await params).file;
  if (!NAME.test(file)) return new Response("Not found", { status: 404 });
  try {
    const data = await readFile(path.join(GENERATED_DIR, file));
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": file.endsWith(".ico") ? "image/x-icon" : "image/png",
        "content-length": String(data.length),
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
