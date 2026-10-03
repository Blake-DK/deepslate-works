import { cn } from "@/lib/utils";

// Not in nav-link.tsx: that file is a client module, and the server-rendered frame (nav.tsx) calls this too.

/** A strip's tab (docs/23 §4): semibold 15, Muted, a 3 px bottom edge that is Copper on the page it names (and the
 *  pages under it, `also`). */
export const stripLink = (on: boolean, copper = false) =>
  cn(
    "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-[14px] pt-[13px] pb-[10px] text-[15px] font-semibold",
    on ? "border-primary" : "border-transparent hover:text-foreground",
    copper ? "text-primary-hi" : on ? "text-foreground" : "text-muted-foreground",
  );
