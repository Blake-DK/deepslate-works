import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/47 §5 item 5: the test site's stripe sticks to the top of the window, covers nothing and is not on the live
// site. These read the source; the proof is the stripe on the test site in a browser.

const SRC = path.resolve(__dirname, "..", "src");
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css)$/.test(n) ? [p] : [];
  });
}

describe("the test stripe", () => {
  it("sticks to the top above the page, and keeps its words and colours", () => {
    const s = read("components/test-stripe.tsx");
    expect(s).toContain('id="test-stripe"');
    expect(s).toMatch(/className="sticky top-0 z-\[45\] border-b-2 border-\[var\(--block-edge\)\] bg-\[repeating-linear-gradient\(135deg,var\(--warn\)_0_14px,var\(--well\)_14px_28px\)\]/);
    expect(s).toContain("TEST · the test server, hidden from players");
    expect(s).toContain('<StripeHeight of="test-stripe" />');
    expect(s).toContain("if (!env.TEST_MODE) return null;");
  });

  it("marks <html> only on the test site, and only that mark turns on the scroll padding", () => {
    expect(read("app/layout.tsx")).toContain('<html lang="en-GB" data-test-site={env.TEST_MODE ? "" : undefined}>');
    const css = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = css.match(/[^{}]*\{[^{}]*scroll-padding[^{}]*\}/g) ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0]?.trim().startsWith("html[data-test-site]")).toBe(true);
    expect(css).not.toMatch(/:root\s*\{[^}]*--stripe-h/);
  });

  it("nothing else pins itself to the very top, where the stripe would cover it", () => {
    const bad = files(SRC)
      .filter((f) => !f.endsWith("test-stripe.tsx"))
      .flatMap((f) => {
        const t = readFileSync(f, "utf8");
        return [/\bsticky top-0\b/, /\bfixed inset-0\b/, /\bfixed top-0\b/, /\bsticky top-\d/].filter((r) => r.test(t)).map((r) => `${path.relative(SRC, f)}: ${r}`);
      });
    expect(bad).toEqual([]);
    expect(read("components/mods-guide/search.tsx")).toContain("sticky top-[var(--stripe-h,0px)]");
    expect(read("app/(app)/admin/branding/form.tsx")).toContain("lg:top-[calc(1rem+var(--stripe-h,0px))]");
    expect(read("app/(app)/map/page.tsx")).toContain("fixed inset-x-0 bottom-0 top-[var(--stripe-h,0px)] z-40");
  });
});
