import { STATE_LABEL, stateHint, stateLine, TONE, type ServerState, type Tone } from "@/shared/server-state";

// docs/13 §12 A: how a status reads on the page. One place, so Home, the sidebar, Admin → Overview, the Play button
// and the map all say the same thing.

export type StatusLike = { server: ServerState; online: unknown[]; sleepInMin: number | null; reason: string | null; wake: { leftS: number | null } };
export type StatusText = { state: ServerState; line: string; label: string; tone: Tone; hint: string; reason: string | null };

export function statusText(s: StatusLike, admin: boolean): StatusText {
  return {
    state: s.server,
    line: stateLine(s.server, { players: s.online.length, sleepInMin: s.sleepInMin, wakeLeftS: s.wake.leftS }),
    label: STATE_LABEL[s.server],
    tone: TONE[s.server],
    hint: stateHint(s.server, admin),
    reason: admin && s.server === "unreachable" && s.reason ? `Reason: ${s.reason}.` : null,
  };
}

/**
 * 3.6.1: the test server for the launcher's Test tab, in the same words and shape as the home's `server` (the card is
 * the Play tab's). A state this list does not know goes as the test api sent it, so an app shows it without an update;
 * no Start (test starts stay on the test site) and no wake figure.
 */
export function testServerText(state: string, players: number) {
  if (!Object.prototype.hasOwnProperty.call(STATE_LABEL, state)) return { state, line: state, label: state, tone: "neutral" as Tone, hint: "", wake: { phase: "idle", leftS: null, line: null }, canStart: false };
  const s = state as ServerState;
  return { state: s, line: stateLine(s, { players }), label: STATE_LABEL[s], tone: TONE[s], hint: stateHint(s, true), wake: { phase: "idle", leftS: null, line: null }, canStart: false };
}

/** docs/23 §4: the banner's pill, the short line the app's window uses (SiteHome.HeroLine), and its dot. */
export type Pill = { line: string; dot: "up" | "waking" | "asleep" | "down" };

export function pillFor(s: StatusLike): Pill {
  switch (s.server) {
    case "online": return { line: s.online.length > 0 ? `Server is up · ${s.online.length} playing` : "Server is up", dot: "up" };
    case "waking": {
      const left = s.wake.leftS;
      return { line: left != null && left > 0 && left < 30 ? `Waking, about ${left} s` : "Waking, about 30 s", dot: "waking" };
    }
    case "starting": case "restarting": return { line: `Server: ${STATE_LABEL[s.server]}`, dot: "waking" };
    case "asleep": return { line: "Server is asleep", dot: "asleep" };
    case "crashed": return { line: `Server: ${STATE_LABEL[s.server]}`, dot: "down" };
    // the site is up but cannot reach AMP: say so (the app's "Can't reach the site" is the site itself being down)
    case "unreachable": return { line: STATE_LABEL[s.server], dot: "down" };
    default: return { line: `Server: ${STATE_LABEL[s.server]}`, dot: "asleep" };
  }
}
