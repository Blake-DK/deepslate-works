import { afterEach, describe, expect, it, vi } from "vitest";

// Sign-in outcomes for api's alert (server/auth/signin-report.ts): the site's own failures count, refusals do not,
// and what goes to api is the method and ok, nothing else.
const sent: unknown[] = [];
vi.mock("@/server/api-client", () => ({ apiFetch: async (path: string, opts: { body?: unknown }) => void sent.push([path, opts.body]) }));
const { failedMethod, logAuthError, reportSignIn } = await import("@/server/auth/signin-report");

const authError = (type: string, cause?: Record<string, unknown>) => Object.assign(new Error(`${type}. Read more`), { type, cause });

describe("sign-in outcomes", () => {
  afterEach(() => {
    sent.length = 0;
    vi.restoreAllMocks();
  });

  it("counts the site's failures, with the method they belong to", () => {
    // 2026-10-06/07: unexpected "iss", wrapped by Auth.js with the provider's id
    expect(failedMethod(authError("CallbackRouteError", { err: new Error('unexpected "iss" (issuer) response parameter value'), provider: "discord" }))).toBe("discord");
    expect(failedMethod(authError("CallbackRouteError", { err: new Error("database down"), provider: "admin-password" }))).toBe("admin-password");
    expect(failedMethod(authError("InvalidCheck"))).toBe("discord");
    expect(failedMethod(authError("OAuthProfileParseError"))).toBe("discord");
  });

  it("does not count refusals or anything outside a sign-in", () => {
    for (const type of ["AccessDenied", "OAuthCallbackError", "CredentialsSignin", "MissingCSRF", "Verification", "JWTSessionError"]) {
      expect(failedMethod(authError(type, { provider: "discord" }))).toBeNull();
    }
    expect(failedMethod(authError("CallbackRouteError", { provider: "somewhere-else" }))).toBeNull();
    expect(failedMethod(new Error("plain"))).toBeNull();
  });

  it("logs as Auth.js does, and reports the method and ok only", async () => {
    const lines: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    logAuthError(authError("CallbackRouteError", { err: new Error('unexpected "iss" (issuer) response parameter value'), provider: "discord", expected: "https://authjs.dev" }));
    await Promise.resolve();
    expect(lines[0]).toContain("[auth][error]");
    expect(lines[0]).toContain("CallbackRouteError: CallbackRouteError. Read more");
    expect(lines[1]).toContain("[auth][cause]");
    expect(lines[1]).toContain('unexpected "iss"');
    expect(lines[2]).toContain("[auth][details]");
    expect(sent).toEqual([["/signin/outcome", { method: "discord", ok: false }]]);
  });

  it("a refusal is logged and not reported; a sign-in that works is reported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logAuthError(authError("AccessDenied", { provider: "discord" }));
    reportSignIn("discord", true);
    reportSignIn("something-else", true);
    await Promise.resolve();
    expect(sent).toEqual([["/signin/outcome", { method: "discord", ok: true }]]);
  });
});
