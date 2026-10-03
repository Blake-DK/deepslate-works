import { formatDate } from "@/lib/utils";

export function launchText(launchAt: Date | null, now = new Date()): string {
  if (!launchAt) return "Launch date to be announced.";
  const days = Math.ceil((launchAt.getTime() - now.getTime()) / 86_400_000);
  const when = formatDate(launchAt);
  if (days > 1) return `Launching ${when}, in ${days} days.`;
  if (days === 1) return `Launching ${when}, tomorrow.`;
  if (days === 0) return `Launching today, ${when}.`;
  return `Launch was planned for ${when}; Alex will flip the switch any moment.`;
}

export function LaunchBanner({ launchAt, admin }: { launchAt: Date | null; admin: boolean }) {
  return (
    <div className="rounded-[4px] border-2 border-primary bg-card px-4 py-3 text-sm">
      <span className="font-medium">Not live yet.</span> {launchText(launchAt)}
      {admin && <span className="text-muted-foreground"> Players see this instead of the address and downloads. Flip it in Site settings → Launch.</span>}
    </div>
  );
}
