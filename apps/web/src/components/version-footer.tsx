import Link from "next/link";
import { forViewer, getVersions } from "@/server/versions";
import { ukShort } from "@/lib/uk-time";

// The footer's versions (planner, 2026-10-01): every number comes from getVersions(), none is written here (a test
// fails the build if a version number appears in this file). Each item links to what it describes.
const REPO = "https://github.com/Blake-DK/deepslate-works";

export async function VersionFooter({ admin }: { admin: boolean }) {
  const v = forViewer(await getVersions(), admin);
  const short = (c: string | null) => (c ? c.slice(0, 7) : null);
  const web = v.web;
  const apiDiffers = v.api && (v.api.version !== web.version || v.api.commit !== web.commit);
  const items: React.ReactNode[] = [
    <span key="portal" data-testid="v-portal">
      Portal {web.version}
      {admin && web.commit ? <> (<a href={`${REPO}/commit/${web.commit}`} className="underline" target="_blank" rel="noreferrer noopener">{short(web.commit)}</a>)</> : null}
    </span>,
  ];
  if (admin && apiDiffers && v.api) {
    items.push(
      <span key="api" data-testid="v-api">
        api {v.api.version}
        {v.api.commit ? <> (<a href={`${REPO}/commit/${v.api.commit}`} className="underline" target="_blank" rel="noreferrer noopener">{short(v.api.commit)}</a>)</> : null}
      </span>,
    );
  }
  if (v.pack) items.push(<Link key="pack" href="/pack" className="hover:underline" data-testid="v-pack">Pack {v.pack}</Link>);
  if (v.app) items.push(<Link key="app" href="/help" className="hover:underline" data-testid="v-app">App {v.app}</Link>);
  if (v.server) items.push(<a key="nf" href="https://neoforged.net/" className="hover:underline" target="_blank" rel="noreferrer noopener" data-testid="v-neoforge" title={`Minecraft ${v.server.minecraft}`}>NeoForge {v.server.neoforge}{v.server.from === "pack" ? " (from the pack)" : ""}</a>);
  if (admin && web.startedAt) items.push(<span key="deploy" data-testid="v-deployed">deployed {ukShort(new Date(web.startedAt))}</span>);
  return (
    <p className="flex flex-wrap justify-center gap-x-1.5 gap-y-0.5" data-testid="versions" title="Pixel lettering: Pixelify Sans, SIL Open Font License (/brand/fonts/OFL-PixelifySans.txt)">
      {items.map((it, i) => (
        <span key={i}>{i > 0 && <span aria-hidden> · </span>}{it}</span>
      ))}
    </p>
  );
}
