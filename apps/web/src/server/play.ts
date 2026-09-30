import "server-only";
import { db } from "@/server/db";
import { getManifest } from "@/server/modpack/manifest";
import { distFile, getLock } from "@/server/modpack/lock";
import { canDownload } from "@/server/modpack/gate";
import { updateAvailable, type LastLaunch } from "@/lib/play";
import { getSection } from "@/server/site-settings";
import { PLAY_MODES, playGate, type Gate } from "@/shared/join-gate";

type GateUser = Parameters<typeof canDownload>[0];

export type PlayInfo = {
  name: string;
  /** The pack as the installer names it, "0.1.0+47b0b579"; null until the pack has been built. */
  current: string | null;
  /** Built, and downloads are open for this member right now (the installer asks the same question). */
  ready: boolean;
  /** Their latest run that went through, from Setup.bat or from the Play button. */
  last: LastLaunch | null;
  update: boolean;
  /** docs/14 "Play first": may they join right now, and until when. Null when Play is not asked of them. */
  join: Gate | null;
};

/** The pack last synced to the server, written down by api at every sync. */
export async function serverPack(): Promise<string | null> {
  const row = await db.setting.findUnique({ where: { key: "_packSynced" } }).catch(() => null);
  const v = (row?.value as { version?: unknown } | null)?.version;
  return typeof v === "string" && v ? v : null;
}

/** docs/05 "Play from the site": what stands next to the Play button. */
export async function getPlayInfo(user: NonNullable<GateUser> & { id: string; role?: string | null }): Promise<PlayInfo> {
  const [m, lock, installer, gate, report, joining, run, pack] = await Promise.all([
    getManifest(),
    getLock(),
    distFile("installer.zip"),
    canDownload(user),
    db.installReport.findFirst({ where: { userId: user.id, outcome: "ok" }, orderBy: { at: "desc" }, select: { packVersion: true, at: true } }),
    getSection("joining"),
    db.installReport.findFirst({ where: { userId: user.id, mode: { in: [...PLAY_MODES] }, outcome: "ok" }, orderBy: { at: "desc" }, select: { packVersion: true, at: true, installerVersion: true } }),
    serverPack(),
  ]);
  const join = joining.requirePlay && user.role !== "ADMIN" ? playGate(run, pack, joining.windowMin, new Date(), joining.minInstaller) : null;
  const current = lock ? `${m.version}+${lock.hash.slice(0, 8)}` : null;
  const last = report ? { version: report.packVersion, at: report.at } : null;
  return { name: m.name, current, ready: Boolean(lock && installer) && gate.ok, last, update: updateAvailable(current, last?.version), join };
}
