import { Badge } from "@/components/ui/badge";
import { Input, Label } from "@/components/ui/input";
import { PendingButton } from "@/components/admin/pending-button";
import type { LogoOption } from "@/server/logo-options";
import { pickLogoAction, uploadLogoAction } from "./actions";

// Admin → Branding → Logo (planner, 2026-10-01): the eight options as the preview page shows them: large, then
// 64 / 32 / 16 px on dark and on light. Pixel art is scaled with nearest-neighbour, never smoothed.
const SMALL = [64, 32, 16] as const;

function Sizes({ src, pixel }: { src: string; pixel: boolean }) {
  const style = pixel ? { imageRendering: "pixelated" as const } : undefined;
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(["#16171a", "#f6f5f2"] as const).map((bg) => (
        <div key={bg} className="flex items-end justify-center gap-2 rounded-[3px] p-2" style={{ background: bg }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a logo at exact pixel sizes */}
          {SMALL.map((s) => <img key={s} src={src} alt="" width={s} height={s} style={{ ...style, width: s, height: s }} />)}
        </div>
      ))}
    </div>
  );
}

export function LogoPicker({ options, choice, ownUrl, ownPixel }: { options: LogoOption[]; choice: string; ownUrl: string | null; ownPixel: boolean }) {
  return (
    <div className="space-y-4">
      {choice === "" && <p className="text-sm text-muted-foreground" data-testid="no-logo">No logo picked yet: the site, the server and the app keep their current look until you press &quot;Use this&quot;.</p>}
      {options.length === 0 && <p className="text-sm text-danger">The logo options are missing from this build (branding/logo-options).</p>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Logo options">
        {options.map((o) => {
          const src = `/logo-options/${o.id}.svg`;
          const inUse = choice === `option:${o.id}`;
          return (
            <li key={o.id} data-testid={`logo-${o.id}`} className={`space-y-2 rounded-[4px] border p-3 ${inUse ? "border-2 border-primary p-[11px]" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{o.title}</span>
                {inUse && <Badge tone="good">In use</Badge>}
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element -- the option, large */}
              <img src={src} alt={o.title} width={128} height={128} className="mx-auto h-32 w-32" style={o.pixel ? { imageRendering: "pixelated" } : undefined} />
              <Sizes src={src} pixel={o.pixel} />
              {o.idea && <p className="text-xs text-muted-foreground">{o.idea}{o.pixel ? " Pixel art: scaled without smoothing." : ""}</p>}
              <form>
                <PendingButton formAction={pickLogoAction.bind(null, o.id)} busy="Making every size…" variant={inUse ? "secondary" : "primary"} disabled={inUse}>{inUse ? "In use" : "Use this"}</PendingButton>
              </form>
            </li>
          );
        })}
      </ul>
      <form action={uploadLogoAction} className="space-y-2 rounded-[4px] border p-3" data-testid="logo-upload">
        <div className="flex flex-wrap items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded logo in use */}
          {ownUrl && <img src={ownUrl} alt="Your logo" width={64} height={64} className="h-16 w-16" style={ownPixel ? { imageRendering: "pixelated" } : undefined} />}
          <div className="min-w-0 flex-1">
            <Label htmlFor="own">Upload your own {choice.startsWith("upload:") && <Badge tone="good">In use</Badge>}</Label>
            <Input id="own" name="own" type="file" accept="image/png,image/svg+xml,.png,.svg" required className="h-auto py-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">A square PNG of at least 512 px, or a square SVG. 2 MB at most.</p>
          </div>
          <PendingButton busy="Making every size…">Upload and use</PendingButton>
        </div>
      </form>
      <p className="text-xs text-muted-foreground">From the logo the site makes 16, 32, 48, 64, 128, 192, 256 and 512 px pictures and a .ico: the browser tab, the top bar, link previews, the server list icon (next Sync and server start), the game window and the Minecraft Launcher profile, and the Deepslate Works app with its shortcuts (each PC at its next Play).</p>
    </div>
  );
}
