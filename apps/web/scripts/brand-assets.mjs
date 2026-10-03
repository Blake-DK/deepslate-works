// Copies the launcher's art into public/brand/ (docs/23 §2). branding/launcher/make-art.py stays the only source:
// never edit the copies, run this again after make-art.py. tests/site-look.test.ts checks the bytes match.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(web, "..", "..", "branding", "launcher");
const to = path.join(web, "public", "brand");
export const BRAND_FILES = ["hero.png", "deepslate-tile@3x.png", "head-placeholder.png", "fonts/PixelifySans-Bold.ttf", "fonts/OFL-PixelifySans.txt"];

await mkdir(path.join(to, "fonts"), { recursive: true });
for (const f of BRAND_FILES) await copyFile(path.join(from, f), path.join(to, f));
console.log(`copied ${BRAND_FILES.length} files into public/brand/`);
