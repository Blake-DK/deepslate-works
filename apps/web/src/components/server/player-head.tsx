import { cn } from "@/lib/utils";

/** Player head from mc-heads.net. Without a UUID (not seen joining yet) the name works too; "MHF_Steve" is the fallback skin. */
export function PlayerHead({ uuid, name, size = 32, className }: { uuid?: string | null; name?: string | null; size?: number; className?: string }) {
  const id = uuid?.replace(/-/g, "") || name || "MHF_Steve";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny remote avatar; the image optimiser would only add a hop
    <img
      src={`https://mc-heads.net/avatar/${encodeURIComponent(id)}/${size * 2}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn("bg-card-2 [image-rendering:pixelated]", className)}
    />
  );
}
