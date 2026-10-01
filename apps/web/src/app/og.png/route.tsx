import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getBranding, GENERATED_DIR } from "@/server/branding";

// The picture a shared link shows (Discord, chat apps): 1200×630, the logo, the name and the tagline. Public (the
// address ends in .png, which the middleware lets through) and made on request, so a new logo or tagline shows at once.
export async function GET() {
  const b = await getBranding();
  const logo = b.generated ? await readFile(path.join(GENERATED_DIR, "logo-256.png")).catch(() => null) : null;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 64, padding: "0 96px", background: "linear-gradient(135deg, #1c1f24 0%, #2b2f36 60%, #3a3f48 100%)", color: "#f2f2f2" }}>
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`data:image/png;base64,${logo.toString("base64")}`} width={256} height={256} alt="" style={{ imageRendering: b.generated?.pixel ? "pixelated" : "auto", borderRadius: 24 }} />
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: logo ? 720 : 1000 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05 }}>{b.name}</div>
          {b.tagline && <div style={{ fontSize: 40, color: "#e8833a" }}>{b.tagline}</div>}
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "cache-control": "public, max-age=300" } },
  );
}
