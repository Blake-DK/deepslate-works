import type { Metadata } from "next";
import Link from "next/link";
import { requireOnboardedUser } from "@/server/auth/session";
import { getManifest, sections } from "@/server/modpack/manifest";
import { getOpenVote } from "@/server/vote/votes";
import { ModCard } from "@/components/mods/mod-card";
import { PcPanel } from "@/components/mods/pc-panel";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";

export const metadata: Metadata = { title: "Mods" };

export default async function ModsPage() {
  const user = await requireOnboardedUser();
  const [manifest, openVote] = await Promise.all([getManifest(), getOpenVote()]);
  const all = sections(manifest);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">The mod list</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Everyone gets the base pack. The rest is up for vote, each with a PC load rating so people on older laptops can see what they&apos;re signing up for. Minecraft {manifest.minecraft}, pack {manifest.version}.</p>
        {openVote && <Link href="/vote" className={buttonClasses("primary", "md", "mt-3")}>Vote is open: cast yours</Link>}
      </div>
      <PcPanel tier={user.pcTier} />
      {all.map(({ category, mods }) => (
        <section key={category.id} id={category.id} className="space-y-3">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold">{category.title}{!category.votable && <Badge>{category.id === "server" ? "server only" : "everyone gets these"}</Badge>}</h2>
            {category.blurb && <p className="text-sm text-muted-foreground">{category.blurb}</p>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {mods.map((mod) => <ModCard key={mod.slug} mod={mod} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
