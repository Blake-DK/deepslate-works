// What else changes with a member's role (People → Members → Make admin / Make player). Pure, so it is tested.
//
// Made a player: Builder tools go (docs/37), and so does "Can join during maintenance" (docs/48 B1).
// Made an admin (Alex, 2026-10-14): "Can join during maintenance" comes with it, so an admin is never shut out of their
// own server by default; it can still be taken away in the member's menu. An admin saved as admin again keeps theirs.
export function roleChangeData(before: "ADMIN" | "PLAYER" | null | undefined, role: "ADMIN" | "PLAYER"): { builderTools?: false; maintenanceJoin?: boolean } {
  if (role === "PLAYER") return { builderTools: false, maintenanceJoin: false };
  return before === "ADMIN" ? {} : { maintenanceJoin: true };
}
