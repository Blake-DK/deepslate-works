import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";
import { apiFetch } from "@/server/api-client";
import { TabbedPage, type PageQuery } from "@/components/tabs";
import { Alert } from "@/components/ui/alert";
import { BuildsCard, type BuildsView } from "./builds-card";
import { listBuilds, readPackBlocks } from "@/server/builds";
import { DesignCard, type DesignCardState } from "./design-card";
import { designCalls, designerSetUp, isDesignerOwner, listDesigns, loadBlockList, readDesign } from "@/server/designer";
import { currentJob } from "@/server/design-jobs";
import { env } from "@/env";

export const metadata: Metadata = { title: "Builds" };

const MSG: Record<string, string> = {
  confirm: "Tick the confirmation box first.",
  uploaded: "Uploaded. Press Build and then Sync on the Modpack page to put it on the server:",
  uploadRemoved: "Removed. It leaves the server with the next Build and Sync:",
  locked: "Its ground is locked: nobody can break or place blocks there. From",
  builderOn: "Builder mode is on: you are in creative and WorldEdit works for you. Switch it off when you are done.",
  builderOff: "Builder mode is off: you are back in survival.",
  builderOffline: "You are not on the server, so nothing changed. If you left in Builder mode you are still in creative: switch it off when you are next on.",
  captured: "Captured:",
  placed: "Placed:",
  placedLocked: "Placed, and its ground is locked:",
  placedNotLocked: "Placed, but the lock was not taken by the server. Lock it by hand:",
  error: "That didn't work:",
};

// docs/48 A4: the build designer and the builds, out of Seasons onto a page of their own. No tabs: Design a build,
// then Builds (uploads, place, lock, capture, Builder mode). ?design=<name> opens that design (the uploads list links
// to it; /admin/seasons?design=<name> is sent here).
export default async function BuildsAdminPage({ searchParams }: { searchParams: PageQuery }) {
  const admin = await requireAdmin();
  const q = await searchParams;
  const msg = typeof q.msg === "string" ? q.msg : undefined;
  const detail = typeof q.detail === "string" ? q.detail : undefined;
  const caller = { id: admin.id, role: "ADMIN" as const };
  // the season's file names its Frontier, a world a build can be placed in
  const season = await apiFetch<{ file: { id: string } | null }>("/seasons", { caller }).catch(() => null);
  // docs/37 Step 2: the admin's own Builder tools, for the Builds card's switch
  const me = await db.user.findUnique({ where: { id: admin.id }, select: { builderTools: true, mcUsername: true } });
  // docs/39 Step 2: the designer card
  const designState: DesignCardState = !designerSetUp() ? "off" : isDesignerOwner(admin) ? "ready" : "notOwner";
  const designs = designState === "ready" ? await listDesigns() : [];
  const designOpen = designState === "ready" && typeof q.design === "string" ? await readDesign(q.design) : null;
  const designLeft = designState === "ready" ? await designCalls().then((c) => ({ hour: Math.max(0, 30 - c.hour), day: Math.max(0, env.DESIGNER_DAILY - c.day) })) : null;
  const designJob = designState === "ready" ? await currentJob() : null; // docs/40 Part 2: a design that carries on
  const uploads = await listBuilds();
  const builds = await apiFetch<BuildsView>("/builds", { caller }).catch(() => null);
  return (
    <TabbedPage title="Builds" intro="Design a build, upload one and place it in the world." base="/admin/builds" tabs={[]} current="">
      {msg && <Alert tone={msg === "error" || msg === "confirm" ? "error" : "success"}>{MSG[msg] ?? msg} {detail && <span className="font-mono">{detail}</span>}</Alert>}
      <DesignCard state={designState} designs={designs} blocks={designState === "ready" ? await loadBlockList() : { kinds: {}, blocks: [] }} initial={designOpen} left={designLeft} job={designJob} taken={[...designs.map((d) => d.name), ...uploads.map((b) => b.name)]} />
      <BuildsCard view={builds} files={uploads} designed={designs.map((d) => d.name)} mods={(await readPackBlocks())?.namespaces ?? {}} builder={me?.builderTools ? { mcUsername: me.mcUsername } : null} frontiers={season?.file ? [`deepslate:frontier_${season.file.id}`] : []} />
    </TabbedPage>
  );
}
