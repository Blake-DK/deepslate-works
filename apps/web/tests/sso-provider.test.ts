import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// docs/04: sign-in through Authentik, run through the real Auth.js handler against a fake Authentik (discovery, token
// endpoint and keys answered here). The redirect to Authentik must carry PKCE (S256), state, nonce, the three scopes and
// the callback URI Authentik holds; the callback must take only an id token from Authentik's token endpoint for this
// client, with Authentik as its issuer and the nonce this browser was given. (An id token from the token endpoint is
// not checked against Authentik's keys: it comes straight from Authentik over TLS, with the client secret and the PKCE
// verifier, as OpenID Connect allows. The test below pins that, so a change in Auth.js shows here.)
const ORIGIN = "http://localhost:3000";
const ISSUER = "https://auth.dsw.test/application/o/deepslate/";
const CLIENT = "deepslate-test-client";

process.env.AUTH_URL = ORIGIN;
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-0123";
process.env.DISCORD_CLIENT_ID = "test-client";
process.env.DISCORD_CLIENT_SECRET = "test-client-secret";
process.env.AUTHENTIK_ISSUER = ISSUER;
process.env.AUTHENTIK_CLIENT_ID = CLIENT;
process.env.AUTHENTIK_CLIENT_SECRET = "test-authentik-secret";

const { NextRequest } = await import("next/server");
const { default: NextAuth } = await import("next-auth");
const { authConfig, SSO_PROVIDER } = await import("@/auth.config");
const { env } = await import("@/env");

const logged: unknown[] = [];
const { handlers } = NextAuth({ ...authConfig, logger: { error: (e) => void logged.push(e), warn: () => {}, debug: () => {} } });

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");
function idToken(claims: Record<string, unknown>, key = privateKey) {
  const head = b64({ alg: "RS256", typ: "JWT", kid: "k1" });
  const body = b64(claims);
  return `${head}.${body}.${b64(sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key))}`;
}

const AUTHORIZE = "https://auth.dsw.test/application/o/authorize/";
const TOKEN = "https://auth.dsw.test/application/o/token/";
const JWKS = "https://auth.dsw.test/application/o/deepslate/jwks/";
let tokenClaims: (nonce: string) => Record<string, unknown> = () => ({});
let signingKey = privateKey;
let lastTokenBody: URLSearchParams | null = null;
let challenge = "";
let lastNonceQuery = "";

type Jar = Map<string, string>;
const cookieHeader = (jar: Jar) => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const keep = (jar: Jar, res: Response) => {
  for (const c of res.headers.getSetCookie()) {
    const pair = c.split(";")[0] ?? "";
    const at = pair.indexOf("=");
    jar.set(pair.slice(0, at), pair.slice(at + 1));
  }
};

async function startSignIn() {
  const jar: Jar = new Map();
  const csrfRes = await handlers.GET(new NextRequest(`${ORIGIN}/api/auth/csrf`));
  keep(jar, csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const res = await handlers.POST(new NextRequest(`${ORIGIN}/api/auth/signin/${SSO_PROVIDER}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(jar) },
    body: new URLSearchParams({ csrfToken, callbackUrl: `${ORIGIN}/` }),
  }));
  keep(jar, res);
  return { jar, to: new URL(res.headers.get("location") ?? "about:blank") };
}

async function callback(jar: Jar, state: string) {
  const url = new URL(`${ORIGIN}/api/auth/callback/${SSO_PROVIDER}`);
  url.searchParams.set("code", "test-code");
  url.searchParams.set("state", state);
  const res = await handlers.GET(new NextRequest(url, { headers: { cookie: cookieHeader(jar) } }));
  keep(jar, res);
  return { location: res.headers.get("location") ?? "", session: [...jar.keys()].some((k) => k.endsWith("authjs.session-token")) };
}

const good = (nonce: string) => ({ iss: ISSUER, aud: CLIENT, sub: "hashed-sub-1", nonce, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, name: "Bramble09", discord_id: "100000000000000001", deepslate_roles: ["deepslate-players"] });

describe("sign-in through Authentik", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : null;
      const url = String(req ? req.url : input);
      if (url === `${ISSUER}.well-known/openid-configuration`) {
        return Response.json({ issuer: ISSUER, authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN, jwks_uri: JWKS, userinfo_endpoint: "https://auth.dsw.test/application/o/userinfo/", response_types_supported: ["code"], subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"], code_challenge_methods_supported: ["S256"], scopes_supported: ["openid", "profile", "deepslate"] });
      }
      if (url === JWKS) return Response.json({ keys: [jwk] });
      if (url === TOKEN) {
        const raw = req ? await req.text() : String(init?.body ?? "");
        lastTokenBody = new URLSearchParams(raw);
        const verifier = lastTokenBody.get("code_verifier") ?? "";
        if (createHash("sha256").update(verifier).digest("base64url") !== challenge) return Response.json({ error: "invalid_grant" }, { status: 400 });
        const nonce = new URL(`${ORIGIN}?${lastNonceQuery}`).searchParams.get("nonce") ?? "";
        return Response.json({ access_token: "test-access", token_type: "Bearer", expires_in: 300, id_token: idToken(tokenClaims(nonce), signingKey) });
      }
      throw new Error(`unexpected request in test: ${url}`);
    });
  });
  afterEach(() => {
    logged.length = 0;
    signingKey = privateKey;
  });

  it("is on, and the site's own Discord sign-in is off beside it (DISCORD_DIRECT_LOGIN unset)", () => {
    expect(env.ssoEnabled).toBe(true);
    expect(env.discordLogin).toBe(false);
    const ids = authConfig.providers.map((p) => (typeof p === "function" ? (p as () => { id: string })().id : (p as { id: string }).id));
    expect(ids).toEqual([SSO_PROVIDER]);
  });

  it("sends the member to Authentik with PKCE (S256), state, nonce, the three scopes and the callback Authentik holds", async () => {
    const { to } = await startSignIn();
    expect(`${to.origin}${to.pathname}`).toBe(AUTHORIZE);
    const q = to.searchParams;
    expect(q.get("client_id")).toBe(CLIENT);
    expect(q.get("response_type")).toBe("code");
    expect(q.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/authentik`);
    expect(q.get("scope")).toBe("openid profile deepslate");
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.get("state")).toBeTruthy();
    expect(q.get("nonce")).toBeTruthy();
    expect(q.get("scope")).not.toContain("email");
  });

  it("takes Authentik's signed id token and signs the member in", async () => {
    const { jar, to } = await startSignIn();
    challenge = to.searchParams.get("code_challenge")!;
    lastNonceQuery = to.search.slice(1);
    tokenClaims = good;
    const { location, session } = await callback(jar, to.searchParams.get("state")!);
    expect(logged).toEqual([]);
    expect(location).toBe(`${ORIGIN}/`);
    expect(session).toBe(true);
    expect(lastTokenBody?.get("grant_type")).toBe("authorization_code");
    expect(lastTokenBody?.get("redirect_uri")).toBe(`${ORIGIN}/api/auth/callback/authentik`);
  });

  it("refuses an id token with another nonce, another audience or another issuer", async () => {
    const bad: Array<[string, (n: string) => Record<string, unknown>]> = [
      ["nonce", (n) => ({ ...good(n), nonce: `${n}x` })],
      ["aud", (n) => ({ ...good(n), aud: "another-client" })],
      ["iss", (n) => ({ ...good(n), iss: "https://auth.dsw.test/application/o/other/" })],
    ];
    for (const [what, claims] of bad) {
      const { jar, to } = await startSignIn();
      challenge = to.searchParams.get("code_challenge")!;
      lastNonceQuery = to.search.slice(1);
      tokenClaims = claims;
      const { location, session } = await callback(jar, to.searchParams.get("state")!);
      expect(new URL(location).pathname, what).toBe("/login");
      expect(session, what).toBe(false);
    }
  });

  it("takes the token endpoint's id token on TLS alone, without checking its signature (OpenID Connect Core 3.1.3.7)", async () => {
    const { privateKey: stranger } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { jar, to } = await startSignIn();
    challenge = to.searchParams.get("code_challenge")!;
    lastNonceQuery = to.search.slice(1);
    tokenClaims = good;
    signingKey = stranger;
    const out = await callback(jar, to.searchParams.get("state")!);
    expect(out.location).toBe(`${ORIGIN}/`);
  });

  it("fails the sign-in when Authentik refuses the PKCE verifier", async () => {
    const { jar, to } = await startSignIn();
    challenge = "another-challenge";
    lastNonceQuery = to.search.slice(1);
    tokenClaims = good;
    const out = await callback(jar, to.searchParams.get("state")!);
    expect(new URL(out.location).pathname).toBe("/login");
    expect(out.session).toBe(false);
  });

  it("refuses a callback whose state is not this browser's", async () => {
    const { jar, to } = await startSignIn();
    challenge = to.searchParams.get("code_challenge")!;
    lastNonceQuery = to.search.slice(1);
    tokenClaims = good;
    const { location, session } = await callback(jar, "not-the-state");
    expect(new URL(location).pathname).toBe("/login");
    expect(session).toBe(false);
  });
});
