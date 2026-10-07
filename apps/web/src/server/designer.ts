import "server-only";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BlockList, Recipe } from "modpack/design";
import { env } from "@/env";
import { db } from "@/server/db";
import { BUILDS_DIR } from "@/server/builds";
import { P } from "@/server/modpack/lock";
import { DESIGN_NAME, summary, type DesignFile, type DesignSummary, type DesignTokens } from "@/lib/designer";

// docs/39 Step 2: the build designer from the site. web calls the `designer` container (docs/39 Step 1) on the
// `internal` network with DESIGNER_TOKEN; it never sees the login. Designs are kept as data/builds/designs/<name>.json
// (not in git, like the uploads); api's Build reads only the top of data/builds, so it never sees them.

export const DESIGNS_DIR = path.join(BUILDS_DIR, "designs");
/** A call takes 2 to 4 minutes (docs/39 Step 0.4); the container gives up at 7. */
const CALL_TIMEOUT_MS = 450_000;

export const designerSetUp = () => Boolean(env.DESIGNER_URL && env.DESIGNER_TOKEN);

/** On the plan's login the designer is the owner's alone (docs/39 "Who may use it"): the account ADMIN_DISCORD_ID names. */
export const isDesignerOwner = (user: { role: string; discordId: string | null }) => user.role === "ADMIN" && Boolean(env.ADMIN_DISCORD_ID) && user.discordId === env.ADMIN_DISCORD_ID;

export async function loadBlockList(): Promise<BlockList> {
  return JSON.parse(await readFile(path.join(P.root, "designer", "blocks.json"), "utf8")) as BlockList;
}

export async function readDesign(name: string): Promise<DesignFile | null> {
  if (!DESIGN_NAME.test(name)) return null;
  try {
    const d = JSON.parse(await readFile(path.join(DESIGNS_DIR, `${name}.json`), "utf8")) as DesignFile;
    return d && Array.isArray(d.versions) && d.versions.length ? d : null;
  } catch {
    return null;
  }
}

export async function writeDesign(d: DesignFile): Promise<void> {
  if (!DESIGN_NAME.test(d.name)) throw new Error("bad design name");
  await mkdir(DESIGNS_DIR, { recursive: true });
  const file = path.join(DESIGNS_DIR, `${d.name}.json`);
  await writeFile(`${file}.part`, `${JSON.stringify(d)}\n`, { mode: 0o644 });
  await rename(`${file}.part`, file);
}

export async function listDesigns(): Promise<DesignSummary[]> {
  let names: string[] = [];
  try {
    names = (await readdir(DESIGNS_DIR)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((n) => DESIGN_NAME.test(n));
  } catch {
    return [];
  }
  const out: DesignSummary[] = [];
  for (const n of names) {
    const d = await readDesign(n);
    if (d) out.push(summary(d));
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Calls made in the last hour and the last day, from the event log (each call is a `build.design` event). */
export async function designCalls(now = new Date()): Promise<{ hour: number; day: number }> {
  const where = (ms: number) => ({ at: { gte: new Date(now.getTime() - ms) }, meta: { path: ["action"], equals: "build.design" } });
  const [hour, day] = await Promise.all([db.event.count({ where: where(3_600_000) }), db.event.count({ where: where(86_400_000) })]);
  return { hour, day };
}

export type DesignerReply = { ok: true; text: string; ms: number; tokens: DesignTokens } | { ok: false; busy?: boolean; error: string };

/** One call to the designer. Never throws: what went wrong comes back in words for the admin. */
export async function askDesigner(body: { name: string; ask: string; recipe: Recipe | unknown | null }): Promise<DesignerReply> {
  let res: Response;
  try {
    res = await fetch(`${env.DESIGNER_URL}/design`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-designer-token": env.DESIGNER_TOKEN },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "The designer did not answer within 7 minutes." : "The designer does not answer. Is deepslate-designer running?" };
  }
  const v = (await res.json().catch(() => ({}))) as { text?: string; ms?: number; usage?: DesignTokens; error?: string };
  if (res.status === 409) return { ok: false, busy: true, error: "The designer is busy with another build. Try again in a few minutes." };
  if (res.status === 401) return { ok: false, error: "The designer turned the site away: DESIGNER_TOKEN is not the same for web and designer." };
  if (!res.ok || typeof v.text !== "string") return { ok: false, error: `The designer failed: ${v.error ?? `HTTP ${res.status}`}` };
  const t = v.usage ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  return { ok: true, text: v.text, ms: Number(v.ms) || 0, tokens: { input: Number(t.input) || 0, cacheWrite: Number(t.cacheWrite) || 0, cacheRead: Number(t.cacheRead) || 0, output: Number(t.output) || 0 } };
}

export type DesignerHealth = { ok: boolean; signedIn: boolean | null; cli: string | null; busy?: boolean; error?: string };

/** The designer's health, for /api/health and Admin → Overview. Makes no call to the model. */
export async function designerHealth(): Promise<DesignerHealth | null> {
  if (!designerSetUp()) return null;
  try {
    const res = await fetch(`${env.DESIGNER_URL}/health`, { headers: { "x-designer-token": env.DESIGNER_TOKEN }, signal: AbortSignal.timeout(5_000), cache: "no-store" });
    if (!res.ok) return { ok: false, signedIn: null, cli: null, error: res.status === 401 ? "DESIGNER_TOKEN is not the same for web and designer" : `HTTP ${res.status}` };
    const v = (await res.json()) as { cli?: string | null; signedIn?: boolean | null; busy?: boolean };
    const signedIn = typeof v.signedIn === "boolean" ? v.signedIn : null;
    const cli = typeof v.cli === "string" ? v.cli : null;
    return { ok: signedIn !== false && cli !== null, signedIn, cli, busy: Boolean(v.busy) };
  } catch {
    return { ok: false, signedIn: null, cli: null, error: "it does not answer" };
  }
}
