import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/23 §7: the site's look. One theme with the launcher's colours, no colour typed outside globals.css, the pixel
// face in the four places §5 names, every text/background pair at 4.5:1, and the art the same bytes as make-art.py's.

const WEB = path.resolve(__dirname, "..");
const SRC = path.join(WEB, "src");
const REPO = path.resolve(WEB, "..", "..");
const css = readFileSync(path.join(SRC, "app", "globals.css"), "utf8");

/** docs/23 §3, token → hex (launcher key in the comment). */
const TOKENS: Record<string, string> = {
  "--background": "#16171A", // Ground
  "--panel": "#121316", // Panel
  "--card": "#202226", // Card
  "--card-2": "#262930", // Card2
  "--muted": "#262930", // Card2
  "--border": "#33363C", // Line
  "--foreground": "#F2F0EB", // Fg
  "--card-foreground": "#F2F0EB", // Fg
  "--muted-foreground": "#B5B2AA", // Muted
  "--dim": "#908D85", // Dim
  "--primary": "#E8833A", // Copper
  "--ring": "#E8833A", // Copper
  "--primary-hi": "#FFB26B", // CopperHi
  "--primary-lo": "#B8652C", // CopperLo
  "--primary-foreground": "#16171A", // OnCopper
  "--play": "#2E7D5B", // Green
  "--play-hi": "#3A9A70", // GreenHi
  "--play-lo": "#1F5C42", // GreenLo
  "--accent": "#8FD4B3", // GreenText
  "--info": "#6AA7E6", // Blue
  "--warn": "#F2B35C", // Amber
  "--danger": "#F06A6E", // Red
  "--disabled": "#3E444D", // Disabled
  "--disabled-foreground": "#BDBAB3", // DisabledText
};
const NEW_TOKENS = ["--panel", "--card-2", "--dim", "--primary-hi", "--primary-lo", "--play", "--play-hi", "--play-lo", "--warn", "--disabled", "--disabled-foreground"];

function rootTokens(): Record<string, string> {
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  return Object.fromEntries([...root.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}
const rel = (p: string) => path.relative(SRC, p).split(path.sep).join("/");

describe("the tokens (docs/23 §3)", () => {
  it("every token is on :root with its hex, and the page is dark", () => {
    const got = rootTokens();
    for (const [k, hex] of Object.entries(TOKENS)) expect([k, got[k]?.toUpperCase()]).toEqual([k, hex]);
    expect(/:root\s*\{[^}]*color-scheme: dark;/.test(css)).toBe(true);
  });
  it("every new token is in @theme inline", () => {
    const theme = /@theme inline\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const k of NEW_TOKENS) expect([k, theme.includes(`--color-${k.slice(2)}: var(${k});`)]).toEqual([k, true]);
  });
  it("there is no light theme, no dark variant and no toggle left", () => {
    expect(css).not.toMatch(/data-theme|custom-variant dark|color-scheme:\s*light/);
    for (const f of filesUnder(SRC)) expect([rel(f), /data-theme|dataset\.theme|ThemeToggle/.test(readFileSync(f, "utf8"))]).toEqual([rel(f), false]);
  });
  it("the fonts are the launcher's, the pixel face self-hosted at 700 only", () => {
    expect(css).toMatch(/--font-sans: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;/);
    expect(css).toMatch(/--font-display: "Pixelify Sans", "Segoe UI", sans-serif;/);
    expect(css).toMatch(/--font-mono: Consolas, ui-monospace, monospace;/);
    const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]!);
    expect(faces).toHaveLength(1);
    expect(faces[0]).toMatch(/url\("\/brand\/fonts\/PixelifySans-Bold\.ttf"\)/);
    expect(faces[0]).toMatch(/font-weight: 700;/);
    expect(faces[0]).toMatch(/font-display: swap;/);
    for (const f of filesUnder(SRC)) expect([rel(f), /fonts\.(googleapis|gstatic)\.com/.test(readFileSync(f, "utf8"))]).toEqual([rel(f), false]);
  });
});

/** Files that may hold a six-digit hex colour, and why. Everything else reads a token. */
const HEX_ALLOWED: Record<string, string> = {
  "app/globals.css": "the tokens themselves",
  "components/nav.tsx": "the brand components of §4: the drawn logo tile and the banner gradient",
  "lib/motd.ts": "Minecraft's own sixteen § colours, as the game draws them",
  "components/admin/motd-preview.tsx": "Minecraft's server list, drawn as the game draws it",
  "app/og.png/route.tsx": "the link-preview picture is drawn by an image renderer that has no style sheet",
  "shared/settings.ts": "the stored branding defaults (the accent colours Discord's embeds); a byte copy of the api's",
  "app/(app)/admin/branding/logo-picker.tsx": "the logo at small sizes on a dark and on a light browser tab",
};
const HEX = /#[0-9a-fA-F]{6}(?![0-9a-zA-Z])/g;

describe("no colour outside globals.css (docs/23 §7)", () => {
  it("finds what it is meant to find", () => {
    expect('style={{ color: "#b8652c" }}'.match(HEX)).toEqual(["#b8652c"]);
    expect('href="#players" className="text-primary"'.match(HEX)).toBeNull();
  });
  it("only the allowed files hold a hex colour", () => {
    const found = filesUnder(SRC).filter((f) => !(rel(f) in HEX_ALLOWED)).flatMap((f) => (readFileSync(f, "utf8").match(HEX) ?? []).map((h) => `${rel(f)} ${h}`));
    expect(found).toEqual([]);
  });
  it("every allowed file still exists", () => {
    for (const f of Object.keys(HEX_ALLOWED)) expect([f, statSync(path.join(SRC, f), { throwIfNoEntry: false })?.isFile()]).toEqual([f, true]);
  });
});

/** docs/23 §5: the banner name and the logo tile (nav.tsx), the Play block, the Vote block. */
const DISPLAY_ALLOWED = ["components/nav.tsx", "components/server/play-button.tsx", "components/polls/poll-card.tsx"];

describe("the pixel face only where §5 names it", () => {
  it("font-display appears in no other file, and Pixelify Sans is named only in globals.css and the licence line", () => {
    const files = filesUnder(SRC).filter((f) => rel(f) !== "app/globals.css");
    expect(files.filter((f) => /\bfont-display\b/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !DISPLAY_ALLOWED.includes(f))).toEqual([]);
    // the version footer's title names the font's licence once (§2)
    expect(files.filter((f) => /Pixelify/i.test(readFileSync(f, "utf8"))).map(rel)).toEqual(["components/version-footer.tsx"]);
    expect(readFileSync(path.join(SRC, "components/version-footer.tsx"), "utf8")).toMatch(/title="Pixel lettering: Pixelify Sans, SIL Open Font License/);
  });
});

// WCAG 2 contrast, as ThemeTests.cs in the app works it out.
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
/** color-mix(in srgb, face, white <lift>): the hover face; 6 %, 4 % on the green (globals.css --lift) */
const lighter = (hex: string, lift = 0.06) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - lift) + 255 * lift).toString(16).padStart(2, "0")).join("");

describe("contrast (docs/23 §3): every pair the site draws at 4.5:1 or better", () => {
  const t = rootTokens();
  const c = (k: string) => (k.startsWith("#") ? k : t[k]!);
  const grounds = ["--background", "--panel", "--card", "--card-2"];
  const pairs: Array<[string, string, string]> = [
    ...grounds.flatMap((g) => ["--foreground", "--muted-foreground", "--primary", "--primary-hi", "--accent", "--info", "--warn", "--danger"].map((f) => [f, g, "text"] as [string, string, string])),
    // Dim: the footer on Panel, hints on the ground and on cards. Never on Card2 (4.4:1).
    ...["--background", "--panel", "--card"].map((g) => ["--dim", g, "dim text"] as [string, string, string]),
    ["--on-play", "--play", "Play block"],
    ["--on-play", lighter(t["--play"]!, 0.04), "Play block, hover"],
    ["--primary-foreground", "--primary", "copper block, chip"],
    ["--primary-foreground", lighter(t["--primary"]!), "copper block, hover"],
    ["--foreground", lighter(t["--card-2"]!), "secondary block, hover"],
    ["--primary-foreground", "--danger", "danger block"],
    ["--primary-foreground", lighter(t["--danger"]!), "danger block, hover"],
    ["--disabled-foreground", "--disabled", "disabled block"],
  ];
  it.each(pairs.map(([f, b, what]) => [`${what}: ${f} on ${b}`, f, b]))("%s", (_name, f, b) => {
    expect(ratio(c(f), c(b))).toBeGreaterThanOrEqual(4.5);
  });
  it("white on Copper would fail, which is why copper carries #16171A", () => {
    expect(ratio("#FFFFFF", t["--primary"]!)).toBeLessThan(4.5);
  });
});

describe("the art (docs/23 §2)", () => {
  it("public/brand/ holds make-art.py's files, byte for byte", () => {
    for (const f of ["hero.png", "deepslate-tile@3x.png", "head-placeholder.png", "fonts/PixelifySans-Bold.ttf", "fonts/OFL-PixelifySans.txt"]) {
      const copy = readFileSync(path.join(WEB, "public", "brand", f));
      const source = readFileSync(path.join(REPO, "branding", "launcher", f));
      expect([f, copy.equals(source)]).toEqual([f, true]);
    }
  });
});
