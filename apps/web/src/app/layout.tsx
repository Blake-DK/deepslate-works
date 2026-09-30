import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppFrame } from "@/components/nav";
import { getBranding } from "@/server/branding";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { default: b.name, template: `%s · ${b.name}` },
    description: b.tagline || "Private modded Minecraft server for friends.",
    robots: { index: false, follow: false },
    icons: b.faviconUrl ? { icon: b.faviconUrl } : undefined,
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Runs before the first paint. The visitor's own choice wins; otherwise the site's default, otherwise their system's.
const themeScript = (fallback: "light" | "dark" | "system") =>
  `(function(){try{var t=localStorage.getItem('theme');if(t!=='light'&&t!=='dark'){t=${fallback === "system" ? "matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'" : `'${fallback}'`}}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='${fallback === "light" ? "light" : "dark"}'}})()`;

const HEX = /^#[0-9a-fA-F]{6}$/;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await getBranding();
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
