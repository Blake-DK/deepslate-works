import { modpackStatus } from "@/server/modpack/run";
import { distFile } from "@/server/modpack/lock";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LoadChip } from "@/components/mods/load-chip";
import { formatDate } from "@/lib/utils";
import { Runner } from "./runner";
import { Alert } from "@/components/ui/alert";
import { getPackDrift } from "@/server/modpack/drift";
import { driftLine } from "@/lib/pack-drift";
import { PackPending } from "@/components/admin/pack-pending";
import { packDrift, testRefusal } from "@/server/test-mode";

export default async function ModpackAdminPage() {
  const { manifest, lock, issues, rows } = await modpackStatus();
  const [installer, drift, livePack] = await Promise.all([distFile("installer.zip"), getPackDrift(), packDrift()]);
  const driftSays = driftLine(drift);
  const tone = (s: string) => (s === "ok" ? "good" : s === "off" ? "neutral" : s === "beta" || s === "alpha" ? "warn" : "bad");
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Mods and build</h2>
      <PackPending />
      {driftSays && <Alert tone="warn" data-testid="pack-drift">{driftSays}</Alert>}
      {/* docs/42 T4, the test site only */}
      {livePack && <Alert tone="warn" data-testid="test-pack-differs">Your PC has the live pack. It will not match this server: the test checkout has pack {livePack.test}, the live site hands out {livePack.live}.</Alert>}
      {testRefusal() && <p className="text-sm text-muted-foreground" data-testid="test-no-lock">This is the test site: Lock is refused here ({testRefusal()}). The lock is the test checkout&apos;s, brought to origin/dev by <span className="font-mono">deploy/test-pull.sh</span>.</p>}
      <Card>
        <CardHeader>
          <CardTitle>Pack {manifest.version}{lock ? `+${lock.hash.slice(0, 8)}` : ""}</CardTitle>
          <CardDescription>
            {lock ? <>Locked {formatDate(new Date(lock.generatedAt))}: {lock.files.length} files, NeoForge {lock.neoforge}.</> : "Not locked yet."}{" "}
            {installer ? <>Installer built {formatDate(installer.mtime)}.</> : "Installer not built."}{" "}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground"><strong>Lock</strong> resolves mods.json against Modrinth and commits mods.lock.json. <strong>Build</strong> makes installer.zip, config.zip and dist/server (inside the site&apos;s backend, under its memory limit). <strong>Sync server</strong> copies dist/server to the AMP host over the tunnel and restarts the server if the mods changed.</p>
          <Runner canBuild={!!lock} canSync={!!lock && !!installer} />
          {issues.length > 0 && <ul className="text-sm">{issues.map((i, k) => <li key={k} className={i.level === "error" ? "text-danger" : "text-muted-foreground"}>{i.level}: {i.message}</li>)}</ul>}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <ul className="divide-y text-sm">
            {rows.map(({ mod, version, size, status }) => (
              <li key={mod.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-56 font-medium">{mod.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{mod.slug}</span>
                <LoadChip load={mod.load} />
                <Badge>{mod.side}</Badge>
                <Badge tone={tone(status)}>{status}</Badge>
                <span className="ml-auto font-mono text-xs text-muted-foreground">{version ?? "—"}{size ? ` · ${(size / 1048576).toFixed(1)} MB` : ""}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Enabled/disabled is decided by the vote (Apply results) or by editing modpack/mods.json in git.</p>
        </CardContent>
      </Card>
    </div>
  );
}
