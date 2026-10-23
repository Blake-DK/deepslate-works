import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FONT_PATH, fontOrigin } from "@/lib/font-cors";

// docs/04: Authentik's sign-in page for this site may load the pixel font from /brand/fonts/. The middleware gives the
// fonts Access-Control-Allow-Origin with Authentik's origin (from AUTHENTIK_ISSUER) and nothing else gets it. Auth.js's
// wrapper is replaced, as in middleware-image.test.ts, so the handler itself runs.
vi.mock("next-auth", () => ({ default: () => ({ auth: (handler: (req: unknown) => unknown) => handler }) }));
vi.mock("@/auth.config", () => ({ authConfig: {} }));

const ISSUER = "https://auth.dsw.test/application/o/deepslate/";

async function middlewareWith(issuer: string | undefined) {
  vi.resetModules();
  if (issuer === undefined) delete process.env.AUTHENTIK_ISSUER;
  else process.env.AUTHENTIK_ISSUER = issuer;
  const { default: middleware } = await import("@/middleware");
  const run = middleware as unknown as (req: NextRequest & { auth: unknown }) => Response;
  return (path: string, signedIn = false) => {
    const req = new NextRequest(new URL(path, "https://deepslate.dsw.test")) as NextRequest & { auth: unknown };
    req.auth = signedIn ? { user: { id: "u1" } } : null;
    return run(req);
  };
}

afterEach(() => void delete process.env.AUTHENTIK_ISSUER);

describe("the fonts' CORS header", () => {
  it("lets Authentik's origin load the fonts, signed in or not", async () => {
    const get = await middlewareWith(ISSUER);
    for (const path of ["/brand/fonts/PixelifySans-Bold.ttf", "/brand/fonts/OFL-PixelifySans.txt"]) {
      const res = get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("access-control-allow-origin"), path).toBe("https://auth.dsw.test");
    }
  });

  it("gives it to nothing else", async () => {
    const get = await middlewareWith(ISSUER);
    expect(get("/login").headers.get("access-control-allow-origin")).toBeNull();
    expect(get("/", true).headers.get("access-control-allow-origin")).toBeNull();
    expect(get("/api/health").headers.get("access-control-allow-origin")).toBeNull();
    // not a font: the sign-in rule applies as before
    expect(get("/brand/fonts/../admin").status).not.toBe(200);
  });

  it("without AUTHENTIK_ISSUER the fonts are public as before, with no header", async () => {
    const res = (await middlewareWith(undefined))("/brand/fonts/PixelifySans-Bold.ttf");
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("takes only an https issuer's origin, never a path or a wildcard", () => {
    expect(fontOrigin(ISSUER)).toBe("https://auth.dsw.test");
    expect(fontOrigin("http://auth.dsw.test/application/o/deepslate/")).toBeNull();
    expect(fontOrigin("")).toBeNull();
    expect(fontOrigin("*")).toBeNull();
    expect(fontOrigin("not a url")).toBeNull();
  });

  it("matches the font files and nothing beside them", () => {
    expect(FONT_PATH.test("/brand/fonts/PixelifySans-Bold.ttf")).toBe(true);
    expect(FONT_PATH.test("/brand/fonts/OFL-PixelifySans.txt")).toBe(true);
    expect(FONT_PATH.test("/brand/fonts/x.ttf/../../admin")).toBe(false);
    expect(FONT_PATH.test("/brand/hero.png")).toBe(false);
  });
});
