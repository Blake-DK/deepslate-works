import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { lintExtras } from "modpack/extras";
import { requireOnboardedUser } from "@/server/auth/session";
import { getManifest } from "@/server/modpack/manifest";
import { P } from "@/server/modpack/lock";
import { getModIcons } from "@/server/modpack/icons";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { ModsSearch } from "@/components/mods-guide/search";
import { guideParts, searchText, WHERE_TEXT, type ExtraEntry, type GuideCard, type GuidePart } from "@/lib/mods-guide";

export const metadata: Metadata = { title: "Mods guide" };

// The Mods guide (planner, 2026-10-01): every mod in the pack, what it does and how to start, made from
// modpack/mods.json and modpack/extras.json at every request. Nothing here is written by hand: change those files.

async function extrasAndPictures(): Promise<{ extras: ExtraEntry[]; pictures: Record<string, string> }> {
  try {
    const { extras } = lintExtras(JSON.parse(await readFile(P.extras, "utf8")));
    const pictures: Record<string, string> = {};
    try {
      const lock = JSON.parse(await readFile(P.extrasLock, "utf8")) as { extras: Array<{ id: string; picture: string | null }> };
      for (const x of lock.extras) if (x.picture && /^[A-Za-z0-9+/=]+$/.test(x.picture)) pictures[x.id] = `data:image/png;base64,${x.picture}`;
    } catch {}
    return { extras: extras?.extras ?? [], pictures };
  } catch {
    return { extras: [], pictures: {} };
  }
}

function Icon({ card }: { card: GuideCard }) {
  if (card.icon) {
    // eslint-disable-next-line @next/next/no-img-element -- a Modrinth CDN icon or our own data: PNG, 40 px
    return <img src={card.icon} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-[3px] bg-muted object-cover" />;
  }
  return <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[3px] bg-muted text-lg font-semibold text-muted-foreground">{card.name.charAt(0)}</span>;
}

function Card({ card }: { card: GuideCard }) {
  return (
    <article id={card.id} data-mod-card data-search={searchText(card)} className="scroll-mt-20 rounded-[4px] border bg-card p-4 target:ring-2 target:ring-primary" data-testid={`mod-${card.id}`}>
      <header className="flex items-start gap-3">
        <Icon card={card} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold leading-tight"><a href={`#${card.id}`} className="hover:underline">{card.name}</a></h3>
          <p className="text-sm text-muted-foreground">{card.description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={card.where === "optional" ? "info" : card.where === "server" ? "neutral" : "good"}>{WHERE_TEXT[card.where]}</Badge>
          {card.adminOnly && <Badge tone="info">admins only</Badge>}
        </div>
      </header>
      {card.howTo && (
        <div className="mt-3 text-sm">
          <Markdown text={card.howTo} />
        </div>
      )}
      {card.keys.length > 0 && (
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2" aria-label="Keys">
          {card.keys.map((k) => (
            <div key={`${k.key}-${k.does}`} className="flex items-baseline gap-2">
              <dt><kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{k.key}</kbd></dt>
              <dd className="text-muted-foreground">{k.does}</dd>
            </div>
          ))}
        </dl>
      )}
      {(card.video || card.wiki) && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {card.video && <a href={card.video.url} target="_blank" rel="noreferrer noopener" className="text-primary underline">Video: {card.video.title}</a>}
          {card.wiki && <a href={card.wiki} target="_blank" rel="noreferrer noopener" className="text-primary underline">Wiki</a>}
        </p>
      )}
    </article>
  );
}

/** "Behind the scenes": one line each, folded away. */
function Line({ card }: { card: GuideCard }) {
  return (
    <li id={card.id} data-mod-card data-search={searchText(card)} className="scroll-mt-20 py-1.5 text-sm target:bg-card-2" data-testid={`mod-${card.id}`}>
      <strong>{card.name}</strong>
      {card.where === "server" && <span className="text-muted-foreground"> (server)</span>}
      {card.adminOnly && <span className="text-muted-foreground"> (admins only)</span>}: <span className="text-muted-foreground">{card.description}</span>
    </li>
  );
}

function Part({ part }: { part: GuidePart }) {
  const heading = (
    <>
      <h2 className="text-xl font-semibold">{part.title} <span className="text-sm font-normal text-muted-foreground">({part.cards.length})</span></h2>
      <p className="text-sm text-muted-foreground">{part.blurb}</p>
    </>
  );
  if (part.collapsed) {
    return (
      <section data-mod-part aria-label={part.title} className="space-y-2" data-testid={`part-${part.key}`}>
        <details className="rounded-[4px] border bg-card p-4">
          <summary className="cursor-pointer select-none">{heading}</summary>
          <ul className="mt-2 divide-y">{part.cards.map((c) => <Line key={c.id} card={c} />)}</ul>
        </details>
      </section>
    );
  }
  return (
    <section data-mod-part aria-label={part.title} className="space-y-3" data-testid={`part-${part.key}`}>
      {heading}
      <div className="grid gap-3 lg:grid-cols-2">{part.cards.map((c) => <Card key={c.id} card={c} />)}</div>
    </section>
  );
}

export default async function ModsGuidePage() {
  const user = await requireOnboardedUser("/mods");
  const [m, icons, { extras, pictures }] = await Promise.all([getManifest(), getModIcons(), extrasAndPictures()]);
  const parts = guideParts(m, extras, icons, pictures, user.role === "ADMIN");
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Mods guide</h1>
        <p className="text-sm text-muted-foreground">
          Every mod in the pack: what it does, how to start and its keys. It follows the pack by itself; voting and the full list are on <a href="/pack" className="underline">Mods &amp; vote</a>. Keys are the defaults; you can change any of them in Options → Controls.
        </p>
      </div>
      <ModsSearch />
      <p id="mods-none" hidden className="text-sm text-muted-foreground">Nothing matches that.</p>
      {parts.map((p) => <Part key={p.key} part={p} />)}
    </div>
  );
}
