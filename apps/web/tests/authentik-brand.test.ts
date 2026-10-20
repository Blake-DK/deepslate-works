import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// docs/04: Authentik's sign-in page for this site loads two of the site's pictures from the live site, by these exact
// paths (its brand CSS lives in Authentik, not here). Renaming or moving either breaks that page; tell Alex first.
// They are served to anyone: the middleware never runs for a .png, so no session is asked for.
vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));
const { config } = await import("@/middleware");

const LOADED_BY_AUTHENTIK = ["/brand/hero.png", "/brand/deepslate-tile@3x.png"];

describe("the pictures Authentik's sign-in page loads", () => {
  it.each(LOADED_BY_AUTHENTIK)("%s is still in public/", (path) => {
    expect(existsSync(new URL(`../public${path}`, import.meta.url))).toBe(true);
  });

  it.each(LOADED_BY_AUTHENTIK)("%s is outside the middleware, so nobody needs to be signed in for it", (path) => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test(path)).toBe(false);
  });
});
