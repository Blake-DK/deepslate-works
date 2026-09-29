import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { apiFetch, ApiError } from "@/server/api-client";
import { getManifest } from "@/server/modpack/manifest";
import { getSection } from "@/server/site-settings";
import { bytes, colour, readList, readProperties, sortEntries } from "@/lib/file-views";
import { timeAgo } from "@/lib/series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Files" };

type Entry = { name: string; path: string; dir: boolean; size: number; modified: string | null; denied: boolean; text: boolean };
type Listing = { path: string; entries: Entry[] };
type Preview = { entry: Entry; text: string; truncated: boolean; shown: number };
type Query = { path?: string; file?: string; sort?: string; dir?: string; q?: string };

const KIND: Record<string, string> = { comment: "text-muted-foreground italic", key: "text-primary", string: "text-accent", number: "text-accent", word: "font-semibold", plain: "" };
const ext = (name: string) => (name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

async function ask<T>(path: string, caller: { id: string; role: "ADMIN" }): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  try {
    return { ok: true, data: await apiFetch<T>(path, { caller, timeoutMs: 30_000 }) };
  } catch (e) {
    return { ok: false, status: e instanceof ApiError ? e.status : 502, message: e instanceof Error ? e.message : "The game server could not be reached." };
  }
}

export default async function FilesPage({ searchParams }: { searchParams: Promise<Query> }) {
  const admin = await requireAdmin();
  const caller = { id: admin.id, role: "ADMIN" as const };
  const q = await searchParams;
  const file = q.file?.trim() || null;
  const path = (file ? file.split("/").slice(0, -1).join("/") : (q.path ?? "")).replace(/^\/+|\/+$/g, "");
  const parts = path ? path.split("/") : [];
  const ancestors = ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];

  const [levels, shown, manifest, limits] = await Promise.all([
    Promise.all(ancestors.map((a) => ask<Listing>(`/files/list?dir=${encodeURIComponent(a)}`, caller))),
    file ? ask<Preview>(`/files/read?path=${encodeURIComponent(file)}`, caller) : Promise.resolve(null),
    getManifest(),
    getSection("files"),
  ]);
  const here = levels.at(-1)!;
  const find = (q.q ?? "").trim().toLowerCase();
  const entries = here.ok ? sortEntries(here.data.entries, q.sort, q.dir).filter((e) => !find || e.name.toLowerCase().includes(find)) : [];
  const href = (over: Query) => {
    const next: Query = { path: path || undefined, sort: q.sort, dir: q.dir, ...over };
    const sp = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as Array<[string, string]>);
    const s = sp.toString();
    return s ? `/admin/files?${s}` : "/admin/files";
  };
  const sortLink = (key: string, label: string, right = false) => {
    const active = (q.sort ?? "name") === key;
    const dir = active && q.dir !== "desc" ? "desc" : "asc";
    return <Link href={href({ sort: key, dir, q: q.q })} className={`hover:underline ${right ? "block text-right" : ""}`}>{label}{active ? (q.dir === "desc" ? " ▼" : " ▲") : ""}</Link>;
  };
  const now = new Date();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Files</h1>
        <p className="text-muted-foreground">The game server&apos;s folder, to look at and download from.</p>
      </div>
      <Alert>
        <strong>Read only.</strong> Nothing can be uploaded, renamed, edited or deleted here. Settings files are changed in the repo (<span className="font-mono">modpack/config/</span>) and sent to the server with Sync, so the mod list and its settings always come from one place. <Link href="/admin/modpack" className="underline">Go to Modpack</Link>
      </Alert>

      <nav aria-label="Where you are" className="flex flex-wrap items-center gap-1 text-sm">
        <Link href="/admin/files" className="rounded px-1.5 py-0.5 font-mono hover:bg-muted">Minecraft</Link>
        {parts.map((p, i) => <span key={i} className="flex items-center gap-1"><span className="text-muted-foreground">/</span><Link href={`/admin/files?path=${encodeURIComponent(parts.slice(0, i + 1).join("/"))}`} className="rounded px-1.5 py-0.5 font-mono hover:bg-muted">{p}</Link></span>)}
        {file && <span className="flex items-center gap-1"><span className="text-muted-foreground">/</span><span className="px-1.5 py-0.5 font-mono font-semibold">{file.split("/").at(-1)}</span></span>}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
        <Card className="hidden lg:block">
          <CardContent className="p-2">
            <Tree levels={levels.map((l) => (l.ok ? l.data : null))} ancestors={ancestors} open={path} />
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          {file && shown && (shown.ok ? <FileView preview={shown.data} expected={manifest.server_properties ?? {}} capMb={limits.maxDownloadMb} /> : (
            <Alert tone="error"><strong>{shown.status === 403 ? "Not available." : shown.status === 415 ? "Can't be shown as text." : "That didn't work."}</strong> {shown.message}{shown.status === 415 && <> <a className="underline" href={`/api/admin/files/download?path=${encodeURIComponent(file)}`}>Download it</a></>}</Alert>
          ))}

          <Card>
            <CardHeader className="pb-0">
              <form method="get" action="/admin/files" className="flex flex-wrap items-center gap-2">
                {path && <input type="hidden" name="path" value={path} />}
                {q.sort && <input type="hidden" name="sort" value={q.sort} />}
                {q.dir && <input type="hidden" name="dir" value={q.dir} />}
                <Input name="q" defaultValue={q.q ?? ""} placeholder="Find in this folder" className="h-8 max-w-xs text-sm" aria-label="Find in this folder" />
                <Button type="submit" size="sm" variant="secondary">Find</Button>
                {find && <Link href={href({})} className={buttonClasses("ghost", "sm")}>Clear</Link>}
              </form>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              {!here.ok ? <div className="p-4"><Alert tone="error"><strong>{here.status === 403 ? "Not available." : "Can't open that folder."}</strong> {here.message}</Alert></div> : entries.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{find ? "Nothing in this folder matches." : "This folder is empty."}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground"><tr><th className="px-4 py-2 font-normal">{sortLink("name", "Name")}</th><th className="px-4 py-2 font-normal">{sortLink("size", "Size", true)}</th><th className="px-4 py-2 font-normal">{sortLink("modified", "Changed", true)}</th><th className="px-4 py-2" /></tr></thead>
                    <tbody className="divide-y">
                      {entries.map((e) => (
                        <tr key={e.path} className={e.denied ? "text-muted-foreground" : undefined}>
                          <td className="px-4 py-2">
                            <span aria-hidden className="mr-2">{e.dir ? "📁" : "📄"}</span>
                            {e.denied ? <span className="font-mono" title="On the never-shown list">{e.name}{e.dir ? "/" : ""}</span> : e.dir ? <Link href={`/admin/files?path=${encodeURIComponent(e.path)}`} className="font-mono hover:underline">{e.name}/</Link> : e.text ? <Link href={`/admin/files?file=${encodeURIComponent(e.path)}`} className="font-mono hover:underline">{e.name}</Link> : <span className="font-mono">{e.name}</span>}
                            {e.denied && <Badge className="ml-2">not available</Badge>}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{e.dir ? "" : bytes(e.size)}</td>
                          <td className="px-4 py-2 text-right text-muted-foreground" title={e.modified ?? undefined}>{e.modified ? timeAgo(new Date(e.modified), now) : ""}</td>
                          <td className="px-4 py-2 text-right">
                            {!e.dir && !e.denied && (e.size <= limits.maxDownloadMb * 1048576 ? <a href={`/api/admin/files/download?path=${encodeURIComponent(e.path)}`} className="underline">Download</a> : <span className="text-xs text-muted-foreground" title={`Over the ${limits.maxDownloadMb} MB limit`}>too large</span>)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tree({ levels, ancestors, open }: { levels: Array<Listing | null>; ancestors: string[]; open: string }) {
  const render = (depth: number): React.ReactNode => {
    const level = levels[depth];
    if (!level) return null;
    const next = ancestors[depth + 1];
    return (
      <ul className={depth ? "ml-3 border-l pl-1" : undefined}>
        {level.entries.filter((e) => e.dir).map((e) => (
          <li key={e.path}>
            {e.denied ? <span className="block truncate rounded px-2 py-1 font-mono text-xs text-muted-foreground" title="On the never-shown list">{e.name}/</span> : <Link href={`/admin/files?path=${encodeURIComponent(e.path)}`} className={`block truncate rounded px-2 py-1 font-mono text-xs hover:bg-muted ${e.path === open ? "bg-muted font-semibold" : ""}`}>{e.name}/</Link>}
            {e.path === next && render(depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  return <nav aria-label="Folders"><Link href="/admin/files" className={`block rounded px-2 py-1 font-mono text-xs hover:bg-muted ${open === "" ? "bg-muted font-semibold" : ""}`}>Minecraft/</Link>{render(0)}</nav>;
}

function FileView({ preview, expected, capMb }: { preview: Preview; expected: Record<string, string>; capMb: number }) {
  const { entry, text, truncated, shown } = preview;
  const list = readList(entry.name, text);
  const props = entry.name === "server.properties" ? readProperties(text, expected) : null;
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const e = ext(entry.name);
  const downloadable = entry.size <= capMb * 1048576;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-base">{entry.name}<span className="font-sans text-xs font-normal text-muted-foreground">{bytes(entry.size)}{entry.modified && <> · changed {timeAgo(new Date(entry.modified))}</>}</span></CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-3">
          {truncated && <span>Showing the first {bytes(shown)} of {bytes(entry.size)}.</span>}
          {downloadable ? <a href={`/api/admin/files/download?path=${encodeURIComponent(entry.path)}`} className={buttonClasses("secondary", "sm")}>Download</a> : <span>Too large to download here (over {capMb} MB).</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {props && (
          <div className="space-y-2">
            {props.rows.some((r) => r.differs) || props.missing.length > 0 ? <Alert tone="error">{props.rows.filter((r) => r.differs).length + props.missing.length} {props.rows.filter((r) => r.differs).length + props.missing.length === 1 ? "setting is" : "settings are"} not what the mod list (<span className="font-mono">modpack/mods.json</span>) expects. AMP writes this file from its own settings each time the server starts, so change them in AMP.</Alert> : Object.keys(expected).length > 0 && <Alert tone="success">Every setting the mod list cares about is as expected.</Alert>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-4 font-normal">Setting</th><th className="py-1 pr-4 font-normal">On the server</th><th className="py-1 font-normal">Expected</th></tr></thead>
                <tbody className="divide-y">
                  {props.rows.map((r) => <tr key={r.key} className={r.differs ? "bg-danger/10" : undefined}><td className="py-1 pr-4 font-mono">{r.key}</td><td className="py-1 pr-4 font-mono">{r.value === "" ? <span className="text-muted-foreground">(empty)</span> : r.key.includes("password") || r.key.includes("secret") ? "••••••" : r.value}</td><td className="py-1 font-mono text-muted-foreground">{r.expected ?? ""}{r.differs && <Badge tone="bad" className="ml-2 font-sans">differs</Badge>}</td></tr>)}
                  {props.missing.map((m) => <tr key={m.key} className="bg-danger/10"><td className="py-1 pr-4 font-mono">{m.key}</td><td className="py-1 pr-4 text-muted-foreground">(not in the file)</td><td className="py-1 font-mono text-muted-foreground">{m.expected}<Badge tone="bad" className="ml-2 font-sans">missing</Badge></td></tr>)}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {list && (
          list.rows.length === 0 ? <p className="text-sm text-muted-foreground">The list is empty.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground"><tr>{list.columns.map((c) => <th key={c} className="py-1 pr-4 font-normal">{c}</th>)}</tr></thead>
                <tbody className="divide-y">{list.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className="py-1 pr-4 font-mono">{v}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )
        )}
        {!props && (
          <div className="max-h-[36rem] overflow-auto rounded-lg border bg-muted" tabIndex={0} aria-label={`Contents of ${entry.name}`}>
            <table className="w-full border-separate border-spacing-0 font-mono text-xs leading-relaxed">
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="sticky left-0 w-px select-none whitespace-nowrap border-r bg-muted px-2 text-right text-muted-foreground">{i + 1}</td>
                    <td className="whitespace-pre-wrap break-all px-3">{colour(l, e).map((t, j) => <span key={j} className={KIND[t.kind]}>{t.text}</span>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
