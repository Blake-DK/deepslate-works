import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/nav";
import { getBranding } from "@/server/branding";
import { env } from "@/env";
import { loadCurrentUser } from "@/server/auth/session";
import { VersionFooter } from "@/components/version-footer";
import { TestStripe } from "@/components/test-stripe";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  // docs/42 T1: the test server's site says TEST in every tab's title
  const name = env.TEST_MODE ? `TEST · ${b.name}` : b.name;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: b.tagline || "Private modded Minecraft server for friends.",
    robots: { index: false, follow: false },
    // a picked logo: the .ico and 32/192/512 PNGs and the 180 px apple-touch-icon (planner, 2026-10-01)
    icons: b.generated
      ? {
          icon: [{ url: b.generated.url("ico"), sizes: "any" }, ...[32, 192, 512].map((s) => ({ url: b.generated!.url(s), sizes: `${s}x${s}`, type: "image/png" }))],
          apple: [{ url: b.generated.url(180), sizes: "180x180" }],
        }
      : b.faviconUrl ? { icon: b.faviconUrl } : { icon: "/icon.svg" },
    // the link preview in Discord and chat apps; the sign-in page is what an unsigned visitor (or bot) gets
    openGraph: { title: b.name, description: b.tagline, siteName: b.name, type: "website", images: [{ url: `/og.png${b.generated ? `?v=${b.generated.hash}` : ""}`, width: 1200, height: 630, alt: b.name }] },
    twitter: { card: "summary_large_image", title: b.name, description: b.tagline, images: [`/og.png${b.generated ? `?v=${b.generated.hash}` : ""}`] },
    metadataBase: new URL(env.AUTH_URL),
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [b, user] = await Promise.all([getBranding(), loadCurrentUser().catch(() => null)]);
  // docs/23 §3: one theme with fixed colours; the branding accent no longer reaches the page (it still colours Discord's embeds).
  return (
    <html lang="en-GB">
      <body className="min-h-dvh flex flex-col">
        <TestStripe />
        <AppFrame
          footer={
            <footer className="space-y-1 border-t bg-panel px-5 py-3 text-center text-[12.5px] text-dim">
              <VersionFooter admin={user?.role === "ADMIN"} member={!!user?.pcTier} />
              {(b.footer || b.discordInvite) && <p>{b.footer}{b.footer && b.discordInvite ? " · " : ""}{b.discordInvite && <a href={b.discordInvite} className="underline" target="_blank" rel="noreferrer noopener">Discord</a>}</p>}
            </footer>
          }
        >
          {children}
        </AppFrame>
      </body>
    </html>
  );
}
