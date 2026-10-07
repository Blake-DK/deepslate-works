import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// A browser sends a member's cookie with a POST from any other site's page, so every route that changes something
// either checks the request's Origin (fromAnotherSite, or the same check inline) or takes no cookie at all (the
// app's launcher token only). The origin check is per route, not in the middleware, so this test is what keeps a new
// route from forgetting it. A route that fits neither goes into ALLOWED, with the reason.

const APP = path.join(__dirname, "..", "src", "app");

const ALLOWED: Record<string, string> = {
  "api/auth/[...nextauth]/route.ts": "Auth.js's own routes, with Auth.js's own CSRF token",
  "api/launcher/start/route.ts": "anonymous: hands out a sign-in code and reads no cookie; nothing is done as a member",
};

const MUTATING = /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b|export\s+const\s+(?:\{[^}]*\b(?:POST|PUT|PATCH|DELETE)\b[^}]*\}|(?:POST|PUT|PATCH|DELETE)\b)/;
const ORIGIN_CHECK = /fromAnotherSite\(|new URL\(origin\)\.host !== host/;
const BEARER_ONLY = /userFromLauncherToken\(|revokeLauncherToken\(/;
const READS_COOKIE = /loadCurrentUser\(|\bauth\(\)|getServerSession\(/;

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return routes(at);
    return name === "route.ts" ? [at] : [];
  });
}

function verdict(rel: string, src: string): string | null {
  if (ALLOWED[rel]) return `allowed: ${ALLOWED[rel]}`;
  if (ORIGIN_CHECK.test(src)) return "checks the origin";
  if (BEARER_ONLY.test(src) && !READS_COOKIE.test(src)) return "launcher token only, no cookie";
  return null;
}

describe("every route that changes something checks where the request came from", () => {
  const all = routes(APP).map((f) => ({ rel: path.relative(APP, f).split(path.sep).join("/"), src: readFileSync(f, "utf8") }));
  const mutating = all.filter((r) => MUTATING.test(r.src));

  it("finds the routes (the walk itself works)", () => {
    expect(mutating.length).toBeGreaterThanOrEqual(9);
    expect(mutating.map((r) => r.rel)).toContain("api/admin/console/send/route.ts");
  });

  it.each(mutating.map((r) => [r.rel, r.src]))("%s", (rel, src) => {
    const why = verdict(rel, src);
    console.log(`origin check: ${rel}: ${why ?? "NONE"}`);
    expect(why, `${rel} changes something but neither checks the Origin nor is launcher-token-only; add fromAnotherSite(req) (src/server/same-origin.ts)`).not.toBeNull();
  });

  it("refuses a made-up route without a check", () => {
    expect(verdict("api/x/route.ts", "export async function POST(req: Request) { const user = await loadCurrentUser(); }")).toBeNull();
    expect(verdict("api/x/route.ts", "export async function POST(req: Request) { const t = await userFromLauncherToken(x) ?? await loadCurrentUser(); }")).toBeNull();
    expect(verdict("api/x/route.ts", "export async function DELETE(req: Request) { if (fromAnotherSite(req)) return; }")).not.toBeNull();
  });

  it("every allowed route still exists", () => {
    for (const rel of Object.keys(ALLOWED)) expect(all.map((r) => r.rel)).toContain(rel);
  });
});
