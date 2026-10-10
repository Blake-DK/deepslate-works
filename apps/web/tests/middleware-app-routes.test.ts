import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// The launcher calls /api/app/* with its token and no session cookie, so the middleware must let every one of those routes
// through. The Test section's routes were once missing from it and every app, an admin's included, got the middleware's
// 401 (PR #22): the route tests call the handlers directly and could not see it. This runs the real middleware, as
// middleware-image.test.ts does, and reads the route folders, so a new app route the middleware refuses fails here.
vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: (req: unknown) => unknown) => handler }),
}));
vi.mock("@/auth.config", () => ({ authConfig: {} }));

const { default: middleware } = await import("@/middleware");
const run = middleware as unknown as (req: NextRequest & { auth: unknown }) => Response;

const TOKEN = "Bearer " + "t".repeat(48);

function appRequest(p: string, authorization: string | null, method = "GET") {
  const req = new NextRequest(new URL(p, "https://deepslate.dsw.test"), { method, headers: authorization ? { authorization } : {} }) as NextRequest & { auth: unknown };
  req.auth = null; // an app has no session
  return req;
}
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

/** Every route under src/app/api/app, as a path an app would ask for ([file] filled in with a head's file name). */
function appRoutes(): string[] {
  const root = fileURLToPath(new URL("../src/app/api/app", import.meta.url));
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
      else if (e.name === "route.ts") out.push("/api/app/" + path.relative(root, dir).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.map((p) => p.replace(/\/$/, "").replace("[file]", "0123456789abcdef0123456789abcdef.png")).sort();
}

describe("middleware: the launcher's routes", () => {
  it("finds the routes it checks, the Test section's four among them", () => {
    expect(appRoutes()).toEqual(expect.arrayContaining(["/api/app/home", "/api/app/test", "/api/app/test/manifest", "/api/app/test/config.zip", "/api/app/test/wake"]));
  });

  it("lets an app's request with its token through to every route under /api/app", () => {
    for (const p of appRoutes()) {
      const res = run(appRequest(p, TOKEN, p.endsWith("/wake") || p.endsWith("/start") ? "POST" : "GET"));
      expect({ path: p, passes: passes(res), status: res.status }).toEqual({ path: p, passes: true, status: 200 });
    }
  });

  it("refuses the Test section without a token, with a token too short to be one, and on paths beside it", () => {
    for (const p of ["/api/app/test", "/api/app/test/manifest", "/api/app/test/config.zip", "/api/app/test/wake"]) {
      for (const auth of [null, "Bearer short"]) expect(run(appRequest(p, auth)).status).toBe(401);
    }
    for (const p of ["/api/app/test/other", "/api/app/testx", "/api/admin/console/send", "/api/players"]) expect(run(appRequest(p, TOKEN)).status).toBe(401);
  });
});
