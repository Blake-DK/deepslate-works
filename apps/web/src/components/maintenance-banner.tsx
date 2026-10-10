import { MAINTENANCE_LINE, MAINTENANCE_HINT } from "@/lib/server-status";

/**
 * docs/48 B4: while the site's Maintenance is on (not AMP's state of that name), on Home and on Getting started in
 * place of the address. Downloads and Play stay as they are: whoever joins is held at the door with the same words.
 */
export function MaintenanceBanner({ admin }: { admin: boolean }) {
  return (
    <div className="rounded-[4px] border-2 border-primary bg-card px-4 py-3 text-sm" data-testid="maintenance-banner">
      <span className="font-medium">{MAINTENANCE_LINE}.</span> {MAINTENANCE_HINT}
      {admin && <span className="text-muted-foreground"> Members see this instead of the address. It is switched on Admin → Server.</span>}
    </div>
  );
}
