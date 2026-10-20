import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// docs/04: Authentik's sign-in page for this site loads three of the site's pictures from the live site, by these exact
// paths (its brand CSS lives in Authentik, not here). Renaming or moving any of them breaks that page; tell Alex first.
// They are served to anyone: the middleware never runs for a .png, so no session is asked for.
vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
const { config } = await import("@/middleware");

const LOADED_BY_AUTHENTIK = ["/brand/hero.png", "/brand/deepslate-tile@3x.png"];
const SITE_LOGO = "/brand/logo-512.png";

describe("the pictures Authentik's sign-in page loads", () => {
  it.each(LOADED_BY_AUTHENTIK)("%s is still in public/", (path) => {
    expect(existsSync(new URL(`../public${path}`, import.meta.url))).toBe(true);
  });

  it.each([...LOADED_BY_AUTHENTIK, SITE_LOGO])("%s is outside the middleware, so nobody needs to be signed in for it", (path) => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test(path)).toBe(false);
  });

  // The site's own logo (the one picked on Admin → Branding, made at Build) shows on Authentik's Deepslate sign-in page
  // instead of Authentik's own, from this address. The route must keep serving it, to other sites too.
  it(`${SITE_LOGO} is still served by app/brand/[file]`, () => {
    const route = readFileSync(new URL("../src/app/brand/[file]/route.ts", import.meta.url), "utf8");
    const name = new RegExp(/const NAME = \/(.+)\/;/.exec(route)![1]!);
    expect(name.test(SITE_LOGO.replace("/brand/", ""))).toBe(true);
    expect(route).toContain('"cross-origin-resource-policy": "cross-origin"');
  });
});
