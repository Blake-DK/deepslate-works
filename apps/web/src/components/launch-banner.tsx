import { launchText } from "@/lib/launch";

export { launchText };

export function LaunchBanner({ launchAt, admin }: { launchAt: Date | null; admin: boolean }) {
  return (
    <div className="rounded-[4px] border-2 border-primary bg-card px-4 py-3 text-sm">
      <span className="font-medium">Not live yet.</span> {launchText(launchAt)}
      {admin && <span className="text-muted-foreground"> Players see this instead of the address and downloads. Flip it in Admin → Joining → Rules.</span>}
    </div>
  );
}
