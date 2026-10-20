import "server-only";
import { apiFetch } from "@/server/api-client";
import { env } from "@/env";

// Sign-in failures raise an alert (api's status/signin-watch.ts). Each sign-in's outcome goes to api: the method and
// whether it worked, nothing else (no code, state, cookie, name or address). It never holds up the sign-in.

export const SIGNIN_METHODS = ["authentik", "discord", "credentials", "admin-password", "one-time-link"] as const;
export type SignInMethod = (typeof SIGNIN_METHODS)[number];

/**
 * Auth.js errors that are the site's failure (the page says error=Configuration). Not here: refusals such as
 * AccessDenied (not in the Discord server, or our sign-in rules said no), OAuthCallbackError (Cancel at Discord)
 * and CredentialsSignin (a wrong password).
 */
const FAILURES = new Set(["CallbackRouteError", "InvalidCheck", "OAuthProfileParseError"]);

const isMethod = (v: unknown): v is SignInMethod => typeof v === "string" && (SIGNIN_METHODS as readonly string[]).includes(v);

/**
 * The method a logged Auth.js error failed, or null when it is not a sign-in failure on the site's side. `oauth`: the
 * sign-in a check or profile error without a provider belongs to (Authentik once it is set up, docs/04).
 */
export function failedMethod(error: unknown, oauth: "authentik" | "discord" = "discord"): SignInMethod | null {
  const type = (error as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !FAILURES.has(type)) return null;
  const provider = (error as { cause?: { provider?: unknown } }).cause?.provider;
  if (isMethod(provider)) return provider;
  // the checks and the profile belong to an OAuth sign-in: Authentik's when it is set up, else Discord's
  return type === "CallbackRouteError" ? null : oauth;
}

export function reportSignIn(method: unknown, ok: boolean): void {
  if (!isMethod(method)) return;
  void apiFetch("/signin/outcome", { method: "POST", body: { method, ok }, timeoutMs: 3000 }).catch(() => {});
}

/** Auth.js's own error log, word for word (@auth/core lib/utils/logger.js), plus the outcome for api. */
export function logAuthError(error: Error): void {
  const red = "\x1b[31m";
  const reset = "\x1b[0m";
  const name = (error as { type?: unknown }).type ?? error.name;
  console.error(`${red}[auth][error]${reset} ${String(name)}: ${error.message}`);
  const cause = error.cause;
  if (cause && typeof cause === "object" && "err" in cause && cause.err instanceof Error) {
    const { err, ...data } = cause as { err: Error } & Record<string, unknown>;
    console.error(`${red}[auth][cause]${reset}:`, err.stack);
    console.error(`${red}[auth][details]${reset}:`, JSON.stringify(data, null, 2));
  } else if (error.stack) {
    console.error(error.stack.replace(/.*/, "").substring(1));
  }
  const method = failedMethod(error, env.ssoEnabled ? "authentik" : "discord");
  if (method) reportSignIn(method, false);
}
