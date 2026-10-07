// Sign-in failures raise an alert (2026-10-07). Discord sign-in failed for about fourteen hours on 2026-10-06/07
// and nothing said so. web reports each sign-in's outcome here (the method and whether it worked, nothing else);
// a run of failures with no sign-in that worked in between is one ERROR event, which the Discord feed posts to the
// admin channel, and the next sign-in that works is one WARN event, which it posts there too.
//
// Only failures on the site's side are counted (web: Auth.js's Configuration errors). A player who is not in the
// Discord server, presses Cancel at Discord or types a wrong password is a refusal, not a failure.

/** Failures in a row, within the window and with no sign-in that worked in between, that raise the alert. */
export const SIGNIN_FAILS = 3;
export const SIGNIN_WINDOW_MIN = 30;

export const SIGNIN_METHODS = ["discord", "credentials", "admin-password", "one-time-link"] as const;
export type SignInMethod = (typeof SIGNIN_METHODS)[number];

const LABEL: Record<SignInMethod, string> = {
  discord: "Discord sign-in",
  credentials: "Password sign-in",
  "admin-password": "Admin password sign-in",
  "one-time-link": "Sign-in by one-time link",
};

/** Per method: when the failures since the last good sign-in happened (within the window), and the alert. */
export type SignInState = { fails: number[]; alerting: boolean; failedWhileAlerting: number };
export type SignInAlert = { level: "ERROR" | "WARN"; message: string };

export const freshSignIn = (): SignInState => ({ fails: [], alerting: false, failedWhileAlerting: 0 });

/** Pure: the state after one outcome, and what to say about it (at most one alert per run of failures). */
export function signInStep(s: SignInState, method: SignInMethod, ok: boolean, now: Date): { state: SignInState; alert: SignInAlert | null } {
  const t = now.getTime();
  if (ok) {
    const alert: SignInAlert | null = s.alerting
      ? { level: "WARN", message: `Health, well again: ${LABEL[method]} works again (${s.failedWhileAlerting} failed while it was broken)` }
      : null;
    return { state: freshSignIn(), alert };
  }
  if (s.alerting) return { state: { ...s, failedWhileAlerting: s.failedWhileAlerting + 1 }, alert: null };
  const fails = [...s.fails.filter((x) => t - x < SIGNIN_WINDOW_MIN * 60_000), t];
  if (fails.length < SIGNIN_FAILS) return { state: { ...s, fails }, alert: null };
  return {
    state: { fails: [], alerting: true, failedWhileAlerting: fails.length },
    alert: {
      level: "ERROR",
      message: `Health: ${LABEL[method]} is failing: ${fails.length} failed in the last ${SIGNIN_WINDOW_MIN} minutes and none worked. The site's log has the reason under [auth][error]`,
    },
  };
}

/** For /health: the methods that are failing right now. */
export type SignInView = { failing: SignInMethod[] };

export class SignInWatch {
  private readonly states = new Map<SignInMethod, SignInState>();

  /** Records one outcome; returns the alert to write, if any. */
  record(method: SignInMethod, ok: boolean, now: Date): SignInAlert | null {
    const { state, alert } = signInStep(this.states.get(method) ?? freshSignIn(), method, ok, now);
    this.states.set(method, state);
    return alert;
  }

  view(): SignInView {
    return { failing: SIGNIN_METHODS.filter((m) => this.states.get(m)?.alerting) };
  }
}
