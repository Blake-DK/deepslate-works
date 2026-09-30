import { STATE_LABEL, stateHint, stateLine, TONE, type ServerState, type Tone } from "@/shared/server-state";

// docs/13 §12 A: how a status reads on the page. One place, so Home, the sidebar, the Control Room, the Play button
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
