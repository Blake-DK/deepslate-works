import type { Mod } from "modpack";
import { Badge } from "@/components/ui/badge";
import { LoadChip } from "./load-chip";
import { youtubeId } from "@/lib/youtube";

const SIDE_NOTE: Record<Mod["side"], string> = { both: "on your PC and the server", client: "on your PC only", server: "server only, nothing to install" };

export function ModLinks({ mod, compact = false }: { mod: Mod; compact?: boolean }) {
  const cls = "rounded-[3px] border px-2.5 py-1 text-xs hover:bg-muted";
  const search = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${mod.name} minecraft mod`)}`;
  return (
    <div className="flex flex-wrap gap-2">
      <a className={cls} href={`https://modrinth.com/mod/${mod.slug}`} target="_blank" rel="noreferrer">Mod page</a>
      <a className={cls} href={mod.wiki} target="_blank" rel="noreferrer">Wiki</a>
      {(compact || mod.videos.length === 0) && (
        <a className={cls} href={mod.videos[0]?.url ?? search} target="_blank" rel="noreferrer">{mod.videos.length ? "Video" : "Search videos"}</a>
      )}
    </div>
  );
}

export function ModVideos({ mod }: { mod: Mod }) {
  if (mod.videos.length === 0) return null;
  return (
    <ul className="mt-3 grid grid-cols-3 gap-2">
      {mod.videos.map((v) => {
        const id = youtubeId(v.url);
        return (
          <li key={v.url}>
            <a href={v.url} target="_blank" rel="noreferrer" className="group block" title={v.title}>
              {id && (
                // Thumbnails only, never an embedded player (weak PCs, privacy): docs/05.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" loading="lazy" width={320} height={180} className="aspect-video w-full rounded-[3px] object-cover" />
              )}
              <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground group-hover:text-foreground">{v.title}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export function ModCard({ mod, children }: { mod: Mod; children?: React.ReactNode }) {
  return (
    <article className="rounded-[4px] border bg-card p-4">
      <div className="flex flex-wrap items-start gap-2">
        <h3 className="text-base font-semibold leading-tight">{mod.name}</h3>
        <LoadChip load={mod.load} />
        {mod.recommended && <Badge tone="warn">Suggested</Badge>}
        {mod.exclusiveGroup && <Badge>pick one</Badge>}
        {children && <div className="ml-auto">{children}</div>}
      </div>
      <p className="mt-1 text-sm">{mod.description}</p>
      <p className="mt-1 text-xs text-muted-foreground">{SIDE_NOTE[mod.side]}{mod.note ? ` · ${mod.note}` : ""}</p>
      <div className="mt-3"><ModLinks mod={mod} /></div>
      <ModVideos mod={mod} />
    </article>
  );
}
