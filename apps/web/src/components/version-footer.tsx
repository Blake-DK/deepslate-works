import Link from "next/link";
import { forViewer, getVersions } from "@/server/versions";
import { ukShort } from "@/lib/uk-time";
import { getStatus } from "@/server/status";
import { STATE_LABEL } from "@/shared/server-state";

// The footer's versions (planner, 2026-10-01): every number comes from getVersions(), none is written here (a test
// fails the build if a version number appears in this file). Each item links to what it describes.
const REPO = "https://github.com/Blake-DK/deepslate-works";

/** A footer item (docs/23 §4): the label in Dim, the value in Muted (Copper when the server is not up). */
const Val = ({ children, copper }: { children: React.ReactNode; copper?: boolean }) => <span className={copper ? "text-primary" : "text-muted-foreground"}>{children}</span>;

export async function VersionFooter({ admin, member }: { admin: boolean; member: boolean }) {
  const [versions, status] = await Promise.all([getVersions(), member ? getStatus().catch(() => null) : Promise.resolve(null)]);
  const v = forViewer(versions, admin);
  const short = (c: string | null) => (c ? c.slice(0, 7) : null);
  const web = v.web;
  const apiDiffers = v.api && (v.api.version !== web.version || v.api.commit !== web.commit);
  const site = short(web.commit) ?? web.version;
  const items: React.ReactNode[] = [
    <span key="portal" data-testid="v-portal">
      Site{" "}
      {admin && web.commit
        ? <a href={`${REPO}/commit/${web.commit}`} className="text-muted-foreground underline" target="_blank" rel="noreferrer noopener">{site}</a>
        : <Val>{site}</Val>}
    </span>,
  ];
  if (admin && apiDiffers && v.api) {
    items.push(
      <span key="api" data-testid="v-api">
        api <Val>{v.api.version}</Val>
        {v.api.commit ? <> (<a href={`${REPO}/commit/${v.api.commit}`} className="text-muted-foreground underline" target="_blank" rel="noreferrer noopener">{short(v.api.commit)}</a>)</> : null}
      </span>,
    );
  }
  if (v.pack) items.push(<Link key="pack" href="/pack" className="hover:underline" data-testid="v-pack">Pack <Val>{v.pack}</Val></Link>);
  if (v.app) items.push(<Link key="app" href="/help" className="hover:underline" data-testid="v-app">App <Val>{v.app}</Val></Link>);
  if (status) items.push(<span key="server" data-testid="v-server">Server <Val copper={status.server !== "online"}>{STATE_LABEL[status.server].toLowerCase()}</Val></span>);
  if (v.server) items.push(<a key="nf" href="https://neoforged.net/" className="hover:underline" target="_blank" rel="noreferrer noopener" data-testid="v-neoforge" title={`Minecraft ${v.server.minecraft}`}>NeoForge <Val>{v.server.neoforge}</Val>{v.server.from === "pack" ? " (from the pack)" : ""}</a>);
  if (admin && web.startedAt) items.push(<span key="deploy" data-testid="v-deployed">deployed <Val>{ukShort(new Date(web.startedAt))}</Val></span>);
  return (
    <p className="flex flex-wrap justify-center gap-x-1.5 gap-y-0.5 tabular-nums" data-testid="versions" title="Pixel lettering: Pixelify Sans, SIL Open Font License (/brand/fonts/OFL-PixelifySans.txt)">
      {items.map((it, i) => (
        <span key={i}>{i > 0 && <span aria-hidden> · </span>}{it}</span>
      ))}
    </p>
  );
}
