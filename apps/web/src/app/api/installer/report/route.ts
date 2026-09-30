import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { audit } from "@/server/events";
import { bearer, userFromLauncherToken } from "@/server/launcher";
import { RateLimiter } from "@/server/auth/rate-limit";
import { reportSchema, sanitizeReport, suggestTier } from "@/lib/install-report";
import { getSettings } from "@/server/settings";
import { mayReport } from "@/shared/access";
import { getInstaller } from "@/server/modpack/lock";
import { env } from "@/env";
import { isOutdated, mustDownloadAgain, outdatedNotice } from "@/lib/installer-version";

export const dynamic = "force-dynamic";

// docs/07 "Install reports": the installer posts here at the end of every run, signed in with the same
// launcher token it uses for the mod list. Nothing anonymous is accepted. What arrives is redacted again
// before it is stored (the installer already did it once on the PC).
const MAX_BODY = 1_300_000;
const g = globalThis as unknown as { __dwInstallLimiter?: RateLimiter };
const limiter = (g.__dwInstallLimiter ??= new RateLimiter(20, 3_600_000));

const no = (status: number, code: string, message: string) => Response.json({ error: { code, message } }, { status });

export async function POST(req: Request) {
  const user = await userFromLauncherToken(bearer(req));
  if (!user) return no(401, "unauthorized", "Sign in with the installer first");
  if (!limiter.allow(user.id)) return no(429, "rate_limited", "Too many reports; try again in an hour");
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return no(413, "too_large", "The report is too large");
  const text = await req.text();
  if (text.length > MAX_BODY) return no(413, "too_large", "The report is too large");
  let body: unknown;
  try {
    body = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return no(400, "validation", "Not JSON");
  }
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return no(400, "validation", parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const r = sanitizeReport(parsed.data);
  // docs/13 §9: "it went through" from somebody who cannot have fetched the mod list is not a report, and must not
  // open the door (docs/14 "Play first").
  // an uninstall is taken from anybody: taking the game off a PC opens nothing
  if (r.mode !== "uninstall" && !mayReport(user, (await getSettings()).live, r.outcome)) {
    await audit({ userId: user.id, action: "installer.report", params: { mode: r.mode, outcome: r.outcome, refused: "not_live" }, result: "DENIED" });
    return no(403, "not_live", "Not launched yet");
  }
  // The PC tier is measured, not asked (Alex, 2026-09-29): every report that says enough about the hardware sets it.
  const measured = r.mode === "uninstall" ? null : suggestTier(r.system);
  const row = await db.installReport.create({
    data: { userId: user.id, packVersion: r.packVersion, installerVersion: r.installerVersion, mode: r.mode, updatedFrom: r.updatedFrom, updateProblem: r.updateProblem, outcome: r.outcome, failedStep: r.failedStep, durationSec: r.durationSec, system: r.system as Prisma.InputJsonValue, log: r.log, tierBefore: user.pcTier, tierMeasured: measured?.tier ?? null },
    select: { id: true },
  });
  if (measured) {
    await db.user.update({ where: { id: user.id }, data: { pcTier: measured.tier, pcTierSource: "measured", pcTierWhy: measured.why.slice(0, 200), pcTierAt: new Date() } });
    if (user.pcTier !== measured.tier || user.pcTierSource !== "measured") await audit({ userId: user.id, action: "profile.tier.measured", params: { from: user.pcTier, to: measured.tier, why: measured.why, reportId: row.id }, result: "OK" });
  }
  // Which installer ran against the one the site hands out now. From 1.5.0 on a copy that is behind updates itself on
  // the next Play; one below 1.5.0 cannot, and its window is told to download Deepslate Works again (its runs do not
  // count for Play first below Settings → Joining "Minimum installer version").
  const current = (await getInstaller())?.version ?? null;
  const outdated = isOutdated(r.installerVersion, current);
  await audit({ userId: user.id, action: "installer.report", params: { reportId: row.id, mode: r.mode, updatedFrom: r.updatedFrom, updateProblem: r.updateProblem, outcome: r.outcome, failedStep: r.failedStep, packVersion: r.packVersion, installerVersion: r.installerVersion, currentInstaller: outdated ? current : undefined, durationSec: r.durationSec }, result: r.outcome === "ok" || r.outcome === "skipped" ? "OK" : "FAILED" });
  const notice = r.mode !== "uninstall" && current && mustDownloadAgain(r.installerVersion, current) ? outdatedNotice(r.installerVersion, current, env.AUTH_URL.replace(/^https?:\/\//, "").replace(/\/$/, "")) : null;
  return Response.json({ ok: true, id: row.id, tier: measured?.tier ?? null, installer: { ran: r.installerVersion, current, outdated }, notice });
}
