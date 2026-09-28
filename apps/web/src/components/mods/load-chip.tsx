import { Badge } from "@/components/ui/badge";
import type { Load } from "modpack";
import { LOAD_LABEL } from "modpack/load";

const TONE: Record<Load, "good" | "warn" | "bad"> = { L: "good", M: "warn", H: "bad" };
export const LOAD_HINT: Record<Load, string> = {
  L: "barely noticeable",
  M: "fine on 8 GB, more if you build big",
  H: "wants 16 GB and a decent GPU",
};

export function LoadChip({ load, withHint = false }: { load: Load; withHint?: boolean }) {
  return (
    <Badge tone={TONE[load]} title={LOAD_HINT[load]}>
      {LOAD_LABEL[load]}
      {withHint && <span className="ml-1 font-normal opacity-80">· {LOAD_HINT[load]}</span>}
    </Badge>
  );
}
