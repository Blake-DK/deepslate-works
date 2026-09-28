// Two roles, one table. Keep this the only place permissions are defined.
export type Role = "ADMIN" | "PLAYER";

export const PERMISSIONS = {
  "catalogue.view": ["PLAYER", "ADMIN"],
  "ballot.submit": ["PLAYER", "ADMIN"],
  "profile.editSelf": ["PLAYER", "ADMIN"],
  "player.actionSelf": ["PLAYER", "ADMIN"],
  "vote.manage": ["ADMIN"],
  "invites.manage": ["ADMIN"],
  "users.manage": ["ADMIN"],
  "server.control": ["ADMIN"],
  "modpack.manage": ["ADMIN"],
  "audit.read": ["ADMIN"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
