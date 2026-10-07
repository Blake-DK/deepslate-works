import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

// The image optimiser is off and its route answers 404. Auth.js's wrapper is replaced by one that hands the handler a request
// with or without a session, so the handler itself is what is tested.
vi.mock("next-auth", () => ({
  default: () => ({ auth: (handler: (req: unknown) => unknown) => handler }),
}));
vi.mock("@/auth.config", () => ({ authConfig: {} }));

const { default: middleware, config } = await import("@/middleware");
const run = middleware as unknown as (req: NextRequest & { auth: unknown }) => Response;

function request(path: string, signedIn: boolean) {
  const req = new NextRequest(new URL(path, "https://deepslate.dsw.test")) as NextRequest & { auth: unknown };
  req.auth = signedIn ? { user: { id: "u1" } } : null;
  return req;
}

describe("middleware: /_next/image", () => {
  const paths = ["/_next/image?url=%2Fx.png&w=64&q=75", "/_next/image?url=https%3A%2F%2Fmc-heads.net%2Favatar%2Fsteve&w=64&q=75"];

  it.each(paths)("answers 404 without a session: %s", (path) => {
    expect(run(request(path, false)).status).toBe(404);
  });

  it.each(paths)("answers 404 with a session: %s", (path) => {
    expect(run(request(path, true)).status).toBe(404);
  });

  it("the matcher no longer skips /_next/image", () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test("/_next/image")).toBe(true);
    expect(re.test("/_next/static/chunks/app.js")).toBe(false);
  });

  it("other pages still go through the sign-in check", () => {
    expect(run(request("/players", false)).status).toBe(307);
    expect(run(request("/api/health", false)).status).toBe(200);
    expect(run(request("/api/health/live", false)).status).toBe(200); // Docker's healthcheck, no session
    expect(run(request("/api/health/other", false)).status).toBe(401);
  });
});
