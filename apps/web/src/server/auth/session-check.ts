import type { SignInVia } from "@/next-auth";

// docs/04 "Ending sessions" (planner, 2026-10-01). Sessions are signed cookies (JWT), so they are ended by checking
// them against the database on every request that reads the member: a raised User.sessionVersion ends all of
// them; a session that came in by password lives only as long as that password, on an admin who still has it on.

export type SessionClaims = { sv?: number; via?: SignInVia; pa?: number };
export type SessionOwner = { role: "ADMIN" | "PLAYER"; sessionVersion: number; adminLogin: { enabled: boolean; passwordAt: Date } | null };

/** Why this session no longer counts, or null when it does. */
export function sessionProblem(s: SessionClaims, u: SessionOwner): string | null {
  if ((s.sv ?? 0) !== u.sessionVersion) return "ended";
  if (s.via === "password") {
    if (u.role !== "ADMIN") return "not an admin any more";
    if (!u.adminLogin?.enabled) return "password sign-in is off";
    if (u.adminLogin.passwordAt.getTime() !== s.pa) return "the password was changed";
  }
  if (s.via === "link" && u.role !== "ADMIN") return "not an admin any more";
  return null;
}
