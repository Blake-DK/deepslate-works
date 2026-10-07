import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Amp } from "../amp/client.js";
import { requireAdmin } from "../auth.js";
import { audit } from "../audit.js";
import type { Env } from "../env.js";
import { runBuild, type BuildTarget } from "../modpack/build.js";

// Branding (planner, 2026-10-01). Web sends the picked logo's bytes (one of branding/logo-options, or an upload it has
// already checked); api keeps it as dist/branding/source.* and makes every size with `modpack build branding`, then
// rebuilds config.zip (window icon) and the server folder (server-icon.png), so the next Sync and the next Play
// carry it. The MOTD goes to AMP's own setting, which AMP writes into server.properties at the next start.

export const MOTD_NODE = "MinecraftModule.Minecraft.ServerMOTD"; // read with Core.GetConfig on the live instance, 2026-10-01
export const MOTD_PERMISSION = `Settings.${MOTD_NODE}`;
const MAX_LOGO = 2 * 1024 * 1024;

const logoBody = z.object({
  choice: z.string().regex(/^(option:[a-z0-9-]{1,60}|upload:logo-[0-9a-f]{12}\.(png|svg))$/),
  kind: z.enum(["svg", "png"]),
  data: z.string().max(Math.ceil((MAX_LOGO * 4) / 3) + 8),
  pixel: z.boolean().optional(),
});

/** Pure: the two lines as one MOTD (a line break between them, as server.properties' `motd` takes it). */
export function motdValue(line1: string, line2: string): string {
  const clean = (s: string) => s.replace(/[\r\n]/g, " ").trim();
  return [clean(line1), clean(line2)].filter(Boolean).join("\n");
}

export function brandingRoutes(app: FastifyInstance, env: Env, amp: Amp, build: typeof runBuild = runBuild) {
  let busy = false;

  app.post("/branding/logo", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const b = logoBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: "choice, kind (svg|png), data (base64)" } });
    const data = Buffer.from(b.data.data, "base64");
    if (data.length === 0 || data.length > MAX_LOGO) return reply.code(400).send({ error: { code: "validation", message: "The picture is empty or larger than 2 MB." } });
    if (b.data.kind === "png" && data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return reply.code(400).send({ error: { code: "validation", message: "That is not a PNG." } });
    if (b.data.kind === "svg" && !/<svg[\s>]/.test(data.subarray(0, 4096).toString("utf8"))) return reply.code(400).send({ error: { code: "validation", message: "That is not an SVG." } });
    if (busy) return reply.code(409).send({ error: { code: "busy", message: "A logo is being made already." } });
    busy = true;
    const lines: string[] = [];
    try {
      const dir = path.join(env.REPO_DIR, "dist", "branding");
      await mkdir(dir, { recursive: true });
      const other = b.data.kind === "svg" ? "png" : "svg";
      await rm(path.join(dir, `source.${other}`), { force: true });
      await writeFile(path.join(dir, `source.${b.data.kind}.part`), data, { mode: 0o644 });
      await rename(path.join(dir, `source.${b.data.kind}.part`), path.join(dir, `source.${b.data.kind}`));
      await writeFile(path.join(dir, "source.json"), JSON.stringify({ kind: b.data.kind, choice: b.data.choice, ...(b.data.pixel === undefined ? {} : { pixel: b.data.pixel }) }) + "\n", { mode: 0o644 });
      let ok = true;
      for (const target of ["branding", "config", "server"] as BuildTarget[]) {
        for await (const e of build(env, target)) {
          if ("line" in e) lines.push(e.line);
          else ok = ok && e.ok;
        }
        if (!ok) break;
      }
      await audit({ userId: req.caller.userId, action: "branding.logo", params: { choice: b.data.choice }, result: ok ? "OK" : "FAILED", detail: ok ? null : lines.slice(-3).join(" | ") });
      return ok ? { ok, lines } : reply.code(500).send({ error: { code: "build_failed", message: lines.slice(-3).join(" | ") || "the build failed" }, lines });
    } finally {
      busy = false;
    }
  });

  const may = () => (amp.hasPermission ? amp.hasPermission(MOTD_PERMISSION) : amp.call<unknown>("Core", "CurrentSessionHasPermission", { PermissionNode: MOTD_PERMISSION }).then((v) => v === true)).catch(() => null);

  app.get("/branding/motd", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const [v, allowed] = await Promise.all([amp.call<{ CurrentValue?: unknown }>("Core", "GetConfig", { node: MOTD_NODE }).catch(() => null), may()]);
    return { current: typeof v?.CurrentValue === "string" ? v.CurrentValue : null, allowed, permission: MOTD_PERMISSION };
  });

  app.post("/branding/motd", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const b = z.object({ line1: z.string().max(120), line2: z.string().max(120) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: { code: "validation", message: "line1, line2" } });
    const value = motdValue(b.data.line1, b.data.line2);
    if ((await may()) !== true) {
      await audit({ userId: req.caller.userId, action: "branding.motd", params: { refused: "amp_permission" }, result: "DENIED", detail: `AMP permission ${MOTD_PERMISSION} missing` });
      return reply.code(403).send({ error: { code: "amp_permission", message: `Saved on the site, but AMP does not let the portal set the server list text. In the instance's own panel, give the role of the user "webapp" the permission ${MOTD_PERMISSION}.` } });
    }
    const r = await amp.call<{ Status?: boolean; Reason?: string } | null>("Core", "SetConfig", { node: MOTD_NODE, value }).catch((e) => ({ Status: false, Reason: String(e) }));
    const after = await amp.call<{ CurrentValue?: unknown }>("Core", "GetConfig", { node: MOTD_NODE }).catch(() => null);
    const ok = after?.CurrentValue === value;
    await audit({ userId: req.caller.userId, action: "branding.motd", params: {}, result: ok ? "OK" : "FAILED", detail: ok ? null : (r && typeof r === "object" && r.Reason) || "AMP did not change the setting" });
    return ok ? { ok: true, value } : reply.code(502).send({ error: { code: "amp_error", message: (r && typeof r === "object" && r.Reason) || "AMP did not take the new text." } });
  });
}
