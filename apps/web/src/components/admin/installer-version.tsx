import { Badge } from "@/components/ui/badge";
import { installerKind } from "@/lib/installer-version";

/** An installer version as the admin lists show it ("app 3.1.0", "old launcher 2.1.3"), with "outdated" when it is not
 * the one the site hands out now. */
export function InstallerVersion({ version, current, outdated }: { version: string | null; current: string | null; outdated: boolean }) {
  if (!version) return <span className="text-muted-foreground" title="Has not run the installer yet">–</span>;
  const why = outdated ? (current ? `Installer ${version}; the site hands out ${current}` : `Installer ${version}`) : `Installer ${version}${current ? ", the current one" : ""}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={why}>
      <span data-truncate className="min-w-0 truncate text-xs">{installerKind(version)?.label ?? <span className="font-mono">{version}</span>}</span>
      {outdated && <Badge tone="warn" className="shrink-0 whitespace-nowrap px-2">outdated</Badge>}
    </span>
  );
}
