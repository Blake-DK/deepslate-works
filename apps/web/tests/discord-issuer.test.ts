import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Discord's callback carries iss=https://discord.com, and Auth.js refuses a callback whose iss
// is not the provider's issuer. This runs the real handler: csrf, sign-in, then the callback.
const ORIGIN = "http://localhost:3000";

process.env.AUTH_URL = ORIGIN;
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.DISCORD_CLIENT_ID = "test-client";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";

const { NextRequest } = await import("next/server");
const { default: NextAuth } = await import("next-auth");
const { authConfig } = await import("@/auth.config");

const logged: unknown[] = [];
const { handlers } = NextAuth({ ...authConfig, logger: { error: (e) => void logged.push(e), warn: () => {}, debug: () => {} } });

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (jar: Jar, res: Response) => {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
};

/** Signs in with Discord and comes back on a callback carrying `iss`; returns where it lands and the cookies it set. */
async function callbackWithIss(iss: string) {
  const jar: Jar = new Map();
  const csrfRes = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  keep(jar, csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const signIn = await handlers.POST(
    new NextRequest(`${ORIGIN}/api/auth/signin/discord`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
      body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/` }),
    }),
  );
  keep(jar, signIn);
  expect(new URL(signIn.headers.get("location") ?? "").origin).toBe("https://discord.com");

  const callback = new URL(`${ORIGIN}/api/auth/callback/discord`);
  callback.searchParams.set("code", "test-code");
  callback.searchParams.set("iss", iss);
  const res = await handlers.GET(new NextRequest(callback, { headers: { cookie: cookieHeader(jar) } }));
  keep(jar, res);
  return { location: res.headers.get("location") ?? "", session: [...jar.keys()].some((k) => k.endsWith("authjs.session-token")) };
}

describe("Discord sign-in callback issuer", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://discord.com/api/oauth2/token")
        return Response.json({ access_token: "test-access", token_type: "Bearer", expires_in: 600, scope: "identify" });
      if (url === "https://discord.com/api/users/@me")
        return Response.json({ id: "100000000000000001", username: "bramble09", global_name: "Bramble09", discriminator: "0", avatar: null });
      throw new Error(`unexpected request in test: ${url}`);
    });
  });
  afterEach(() => void (logged.length = 0));

  it("sets the issuer Discord sends, and keeps Discord's own endpoints", () => {
    const provider = authConfig.providers[0] as unknown as () => unknown;
    const p = (typeof provider === "function" ? provider() : provider) as { issuer?: string; options?: { issuer?: string } };
    expect(p.options?.issuer ?? p.issuer).toBe("https://discord.com");
  });

  it("accepts a callback carrying iss=https://discord.com and signs the player in", async () => {
    const { location, session } = await callbackWithIss("https://discord.com");
    expect(logged).toEqual([]);
    expect(location).toBe(`${ORIGIN}/`);
    expect(session).toBe(true);
  });

  it("refuses a callback carrying any other iss", async () => {
    for (const iss of ["https://discord.example", "https://authjs.dev", "https://discord.com/"]) {
      const { location, session } = await callbackWithIss(iss);
      expect(new URL(location).pathname).toBe("/login");
      expect(new URL(location).searchParams.get("error")).toBe("Configuration");
      expect(session).toBe(false);
      const causes = logged.map((e) => String((e as { cause?: { err?: unknown } }).cause?.err ?? e));
      expect(causes.some((c) => c.includes('unexpected "iss"'))).toBe(true);
      logged.length = 0;
    }
  });
});
