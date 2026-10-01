import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/nav";
import { getBranding } from "@/server/branding";
import { env } from "@/env";
import { loadCurrentUser } from "@/server/auth/session";
import { VersionFooter } from "@/components/version-footer";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
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

// Runs before the first paint. The visitor's own choice wins; otherwise the site's default, otherwise their system's.
const themeScript = (fallback: "light" | "dark" | "system") =>
  `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=${fallback === "system" ? "matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'" : `'${fallback}'`}}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='${fallback === "light" ? "light" : "dark"}'}})()`;

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [b, user] = await Promise.all([getBranding(), loadCurrentUser().catch(() => null)]);
  // docs/16 §5: the accent comes from the branding row at request time, so a change needs no rebuild.
  // The values are checked again here: only a six-digit hex colour ever reaches the style sheet.
  const light = HEX.test(b.accent) ? b.accent : "#b8652c";
  const dark = HEX.test(b.accentDark) ? b.accentDark : "#d9823f";
  const accentCss = `:root{--primary:${light};--ring:${light}}:root[data-theme="dark"]{--primary:${dark};--ring:${dark}}`;
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript(b.defaultTheme) }} />
        <style dangerouslySetInnerHTML={{ __html: accentCss }} />
      </head>
      <body className="min-h-dvh flex flex-col">
        <AppFrame
          footer={
            <footer className="space-y-1 px-4 py-4 text-center text-xs text-muted-foreground">
              <p>{b.tagline}</p>
              <VersionFooter admin={user?.role === "ADMIN"} />
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
