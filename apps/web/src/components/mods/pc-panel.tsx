import type { PcTier } from "@prisma/client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LoadChip } from "./load-chip";

const ROWS: Array<{ tier: PcTier; title: string; text: string }> = [
  { tier: "LOW", title: "8 GB RAM, no graphics card", text: "Works with the base pack, Create and one gun mod. Keep render distance at 8. Skip Heavy mods." },
  { tier: "MID", title: "8 to 16 GB RAM, some graphics card", text: "Base pack plus most Medium picks is fine at render distance 10." },
  { tier: "HIGH", title: "16 GB RAM, a proper GPU", text: "Comfortable with everything on this page at render distance 12." },
];

export function PcPanel({ tier }: { tier: PcTier | null }) {
  return (
    <section className="rounded-[4px] border bg-card p-4">
      <h2 className="font-semibold">Will my PC run it?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Rough guide for the base pack plus a normal set of picks. The installer sets RAM automatically. Your row is highlighted; <Link href="/onboarding" className="underline">change it</Link> if it&apos;s wrong.</p>
      <ul className="mt-3 space-y-2">
        {ROWS.map((r) => (
          <li key={r.tier} className={cn("rounded-[4px] border p-3 text-sm", tier === r.tier && "border-2 border-primary p-[11px]")}>
            <span className="font-medium">{r.title}</span>{tier === r.tier && <span className="ml-2 text-xs text-primary">you</span>}
            <span className="block text-muted-foreground">{r.text}</span>
          </li>
        ))}
        <li className="rounded-[4px] border p-3 text-sm"><span className="font-medium">Older than 2016, or 4 GB RAM</span><span className="block text-muted-foreground">Tell Alex before the vote closes. A cut-down pack or an upgrade may be needed.</span></li>
      </ul>
      <div className="mt-3 flex flex-wrap gap-2 text-xs"><LoadChip load="L" withHint /><LoadChip load="M" withHint /><LoadChip load="H" withHint /></div>
    </section>
  );
}
