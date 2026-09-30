import { RowMenu, menuItem } from "@/components/admin/row-menu";
import { ConfirmItem, LinkByName } from "@/components/admin/menu-actions";
import { clearMinecraftNameAction, removeUserAction, revokeLauncherAction, setMinecraftNameAction, setRoleAction } from "./actions";

type Member = { id: string; displayName: string; role: "ADMIN" | "PLAYER"; mcUsername: string | null };

/** A member's admin menu: on People → Members and on their player page (docs/13 §11 layout). */
export function MemberMenu({ u, meId }: { u: Member; meId: string }) {
  const admin = u.role === "ADMIN";
  return (
    <RowMenu label={`Actions for ${u.displayName}`}>
      {u.id !== meId && (
        <form action={setRoleAction}>
          <input type="hidden" name="id" value={u.id} />
          <input type="hidden" name="role" value={admin ? "PLAYER" : "ADMIN"} />
          <button type="submit" role="menuitem" className={menuItem}>{admin ? "Make player" : "Make admin"}</button>
        </form>
      )}
      {u.mcUsername && (
        <form action={clearMinecraftNameAction}>
          <input type="hidden" name="id" value={u.id} />
          <button type="submit" role="menuitem" className={menuItem}>Unlink</button>
        </form>
      )}
      <LinkByName action={setMinecraftNameAction} id={u.id} who={u.displayName} />
      <form action={revokeLauncherAction} title="Signs the installer out on all their PCs">
        <input type="hidden" name="id" value={u.id} />
        <button type="submit" role="menuitem" className={menuItem}>Sign out installer</button>
      </form>
      {u.id !== meId && <ConfirmItem action={removeUserAction} fields={{ id: u.id }} question={`Remove ${u.displayName} from the group? Their votes and their link to Minecraft go with them.`}>Remove</ConfirmItem>}
    </RowMenu>
  );
}
