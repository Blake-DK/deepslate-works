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

// docs/23 §4 (step 2): the frame.
import { pillFor } from "@/lib/server-status";

describe("the frame (docs/23 §4)", () => {
  const nav = readFileSync(path.join(SRC, "components", "nav.tsx"), "utf8");
  const links = readFileSync(path.join(SRC, "components", "nav-link.tsx"), "utf8");
  const hrefs = (src: string) => [...src.matchAll(/<NavLink href="([^"]+)"/g)].map((m) => m[1]);

  it("the pill says the app's short line, with its dot", () => {
    const s = (server: string, online = 0, leftS: number | null = null) => ({ server, online: Array(online).fill({}), sleepInMin: null, reason: null, wake: { leftS } }) as Parameters<typeof pillFor>[0];
    expect(pillFor(s("online", 2))).toEqual({ line: "Server is up · 2 playing", dot: "up" });
    expect(pillFor(s("online"))).toEqual({ line: "Server is up", dot: "up" });
    expect(pillFor(s("asleep"))).toEqual({ line: "Server is asleep", dot: "asleep" });
    expect(pillFor(s("waking"))).toEqual({ line: "Waking, about 30 s", dot: "waking" });
    expect(pillFor(s("waking", 0, 12))).toEqual({ line: "Waking, about 12 s", dot: "waking" });
    expect(pillFor(s("unreachable"))).toEqual({ line: "Can't reach the server", dot: "down" });
    expect(pillFor(s("crashed")).dot).toBe("down");
    expect(pillFor(s("off")).dot).toBe("asleep");
  });
  it("the tab strip holds every link the sidebar held, in its order, and nothing of the sidebar is left", () => {
    expect(hrefs(nav)).toEqual(["/", "/map", "/help", "/mods", "/season", "/players", "/pack", "/votes", "/activity", "/admin", "/me"]); // /season only once a season is announced (docs/34 §5)
    expect(nav).toContain('<Strip label="Main">');
    expect(nav + links).not.toMatch(/MobileMenu|aria-label="Sidebar"|>Menu</);
    expect(links).toMatch(/overflow-x-auto whitespace-nowrap/);
  });
  it("admin pages get the admin strip with the seven admin pages", () => {
    expect(hrefs(links.slice(links.indexOf("export function AdminStrip")))).toEqual(["/admin", "/admin/server", "/admin/pack", "/admin/seasons", "/admin/people", "/admin/news", "/admin/site"]);
    expect(nav).toContain("{admin && <AdminStrip />}");
  });
  it("the display face is on the banner's name and the drawn logo tile only", () => {
    expect((nav.match(/\bfont-display\b/g) ?? []).length).toBe(2);
    expect(nav).toMatch(/font-display[^"]*"[^>]*data-testid="brand-name"/);
  });
  it("the ground is the tile at 48 px, 35 %, fixed and out of the way", () => {
    const ground = /body::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(ground).toMatch(/deepslate-tile@3x\.png"\) 0 0 \/ 48px 48px repeat/);
    expect(ground).toMatch(/opacity: 0\.35/);
    expect(ground).toMatch(/position: fixed/);
    expect(ground).toMatch(/pointer-events: none/);
    expect(ground).toMatch(/image-rendering: pixelated/);
  });
});

// docs/23 §5 (step 3): Home, Votes, the poll card, the ballot's boxes, the Play block.
import { shortLabel } from "@/lib/blocks";

describe("the pages (docs/23 §5)", () => {
  const read = (f: string) => readFileSync(path.join(SRC, f), "utf8");
  it("a block keeps the pixel face for a short label and Segoe UI 15 for a long one, as the app does", () => {
    expect(shortLabel("Play")).toBe(true);
    expect(shortLabel("Starting…")).toBe(true);
    expect(shortLabel("Save my vote")).toBe(true);
    expect(shortLabel("Vote first, it takes ten seconds")).toBe(false);
    expect(shortLabel("Download the new installer")).toBe(false);
  });
  it("the Play block: green, the face at 26 with the GreenLo shadow, at least 190 wide; vote-first is the same block", () => {
    const play = read("components/server/play-button.tsx");
    expect(play).toMatch(/buttonClasses\("primary", "lg", cn\("min-w-\[190px\]", shortLabel\(label\) \? "font-display text-\[26px\] font-bold \[text-shadow:2px_2px_0_var\(--play-lo\)\]" : "text-\[15px\]"/);
    expect(play).toMatch(/data-testid="play-vote-first" className=\{playBlock\(VOTE_FIRST_BUTTON\)\}/);
    expect(play).not.toMatch(/opacity-50/); // a shut block is grey, not faded
  });
  it("the Vote block: copper, the face at 24, at least 150 wide, with the line beside it", () => {
    const poll = read("components/polls/poll-card.tsx");
    expect(poll).toMatch(/variant="copper"[^>]*data-testid="poll-vote"[^>]*min-w-\[150px\]", shortLabel\(voteLabel\) \? "font-display text-\[24px\] font-bold" : "text-\[15px\]"/);
    expect(poll).toContain("Play opens as soon as you&apos;ve voted.");
    expect(poll).toMatch(/min-\[760px\]:grid-cols-2/);
  });
  it("polls and the ballot draw their own boxes; step 3's pages have no browser-drawn box, blur or round corners left", () => {
    for (const f of ["components/polls/poll-card.tsx", "app/(app)/vote/ballot-form.tsx"]) expect([f, read(f).includes("<PickBox")]).toEqual([f, true]);
    const box = read("components/ui/pick-box.tsx");
    expect(box).toMatch(/h-4 w-4[^"]*border-2 border-edge bg-well[^"]*text-primary-hi/);
    // step 3's pages; every page is checked by the step 4 block below
    for (const f of ["components/polls/poll-card.tsx", "app/(app)/vote/ballot-form.tsx", "components/polls/vote-banner.tsx", "app/(app)/page.tsx", "components/server/status-card.tsx", "components/server/play-button.tsx"])
      expect([f, /accent-\[|backdrop-blur|rounded-full|rounded-xl/.test(read(f))]).toEqual([f, false]);
  });
  it("a card that wants attention has the 2 px Copper edge; Vote now is copper", () => {
    expect(read("components/polls/vote-banner.tsx")).toContain('className="scroll-mt-20 border-2 border-primary"');
    expect(read("app/(app)/page.tsx")).toContain('openVote ? "border-2 border-primary"');
    expect(read("app/(app)/page.tsx")).toContain('buttonClasses("copper", "sm")}>Vote now');
  });
});

describe("the leftovers (docs/23 §8 step 4): every page takes the parts", () => {
  const files = filesUnder(SRC).filter((f) => /\.tsx?$/.test(f));
  const hits = (re: RegExp, allowed: string[] = []) => files.map(rel).filter((f) => !allowed.includes(f) && re.test(readFileSync(path.join(SRC, f), "utf8")));
  it("no rounded-md, -lg, -xl or -2xl corners: cards are 4 px, chips 3 px, fields and blocks square", () => {
    expect(hits(/\brounded-(md|lg|xl|2xl|3xl)\b/)).toEqual([]);
  });
  it("rounded-full only for the status pill and the live dots", () => {
    expect(hits(/\brounded-full\b/, ["components/nav.tsx", "components/server/live-console.tsx", "components/events/live-tail.tsx"])).toEqual([]);
  });
  it("no tinted boxes, no blur, no drop shadows", () => {
    expect(hits(/\b(bg|border|ring)-(primary|danger|accent|info|warn|play)\/\d+/)).toEqual([]);
    expect(hits(/backdrop-blur|className=["`{][^"`]*(?<=["'`\s])shadow(-(sm|md|lg|xl|2xl))?(?=["'`\s])/)).toEqual([]);
  });
  it("no browser-drawn checkbox or radio, no accent-[…]: boxes are Check or PickBox", () => {
    expect(hits(/<input\b[^>]*type="(checkbox|radio)"/, ["components/ui/check.tsx", "components/ui/pick-box.tsx"])).toEqual([]);
    expect(hits(/accent-\[/)).toEqual([]);
    expect(readFileSync(path.join(SRC, "components/ui/check.tsx"), "utf8")).toMatch(/h-4 w-4[^"]*border-2 border-edge bg-well[^"]*text-transparent/);
  });
  it("every select and textarea has §5's field style", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<(select|textarea)\b[^>]*/g)) if (rel(f) !== "components/ui/input.tsx") expect([rel(f), m[0].includes("fieldClasses")]).toEqual([rel(f), true]);
    }
  });
  it("tabs and filters inside a page are the strip's tab", () => {
    for (const f of ["app/(app)/analytics/section.tsx", "app/(app)/admin/installs/section.tsx", "app/(app)/admin/users/section.tsx", "app/(app)/players/[uuid]/page.tsx"]) {
      const src = readFileSync(path.join(SRC, f), "utf8");
      expect([f, src.includes("stripLink("), /bg-card font-medium shadow-sm/.test(src)]).toEqual([f, true, false]);
    }
  });
  it("charts: Copper for the main series, Blue for a second, Line for grid lines", () => {
    for (const f of ["components/analytics/area-chart.tsx", "components/server/sparkline.tsx"]) {
      const src = readFileSync(path.join(SRC, f), "utf8");
      expect([f, src.includes("text-primary"), src.includes("stroke-border"), /strokeOpacity/.test(src)]).toEqual([f, true, true, false]);
    }
    const results = readFileSync(path.join(SRC, "app/(app)/vote/results/section.tsx"), "utf8");
    expect(results).toContain('<div className="h-full bg-primary"');
    expect(results).toContain('<div className="h-full bg-info"');
  });
});
