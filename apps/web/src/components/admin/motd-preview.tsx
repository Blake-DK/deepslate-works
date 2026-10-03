import { motdRuns } from "@/lib/motd";

/** How the server looks in Minecraft's Multiplayer list: icon, name, two lines of MOTD, ping bars. */
export function MotdPreview({ name, line1, line2, icon, pixel }: { name: string; line1: string; line2: string; icon: string | null; pixel?: boolean }) {
  const line = (l: string, key: string) => (
    <p key={key} className="truncate" style={{ minHeight: "1.15em" }}>
      {motdRuns(l).map((r, i) => (
        <span key={i} style={{ color: r.colour, fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? "italic" : "normal", textDecoration: [r.underline && "underline", r.strike && "line-through"].filter(Boolean).join(" ") || "none" }}>{r.text}</span>
      ))}
    </p>
  );
  return (
    <div data-testid="motd-preview" className="flex items-start gap-2 rounded-[3px] border border-[#808080] p-1 font-mono text-[13px] leading-tight" style={{ background: "#2a2a2a" }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the chosen logo, 64 px as the game shows it */}
      {icon ? <img src={icon} alt="" width={64} height={64} className="h-16 w-16 shrink-0" style={pixel ? { imageRendering: "pixelated" } : undefined} /> : <div className="h-16 w-16 shrink-0" style={{ background: "#555" }} aria-hidden />}
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-white">{name || "Deepslate Works"}</span>
          <span className="flex items-end gap-px pr-1" aria-label="ping">{[2, 4, 6, 8, 10].map((h) => <span key={h} className="w-[3px]" style={{ height: h, background: "#55FF55" }} />)}</span>
        </div>
        {line(line1, "1")}
        {line(line2, "2")}
      </div>
    </div>
  );
}
