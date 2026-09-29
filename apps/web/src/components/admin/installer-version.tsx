import { Badge } from "@/components/ui/badge";

/** An installer version as the admin lists show it, with "outdated" when it is not the one the site hands out now. */
export function InstallerVersion({ version, current, outdated }: { version: string | null; current: string | null; outdated: boolean }) {
  if (!version) return <span className="text-muted-foreground" title="Has not run the installer yet">–</span>;
  const why = outdated ? (current ? `Installer ${version}; the site hands out ${current}` : `Installer ${version}`) : `Installer ${version}${current ? ", the current one" : ""}`;
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={why}>
      <span data-truncate className="min-w-0 truncate font-mono text-xs">{version}</span>
      {outdated && <Badge tone="warn" className="shrink-0 whitespace-nowrap px-2">outdated</Badge>}
    </span>
  );
}
