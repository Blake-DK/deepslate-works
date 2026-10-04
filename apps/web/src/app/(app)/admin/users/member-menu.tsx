import { RowMenu } from "@/components/admin/row-menu";
import { menuItem } from "@/components/admin/menu-item";
import { ConfirmItem, LinkByName } from "@/components/admin/menu-actions";
import Link from "next/link";
import { clearMinecraftNameAction, removeUserAction, revokeLauncherAction, setMinecraftNameAction, setRoleAction, turnOffPasswordSignInAction } from "./actions";

type Member = { id: string; displayName: string; role: "ADMIN" | "PLAYER"; mcUsername: string | null; passwordSignIn?: boolean; discordId?: string | null };

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
      {admin && u.id === meId && (
        <Link href="/me/sign-in" role="menuitem" className={menuItem}>{u.passwordSignIn ? "Password sign-in…" : "Set up password sign-in"}</Link>
      )}
      {admin && u.id !== meId && u.passwordSignIn && (
        <ConfirmItem action={turnOffPasswordSignInAction} fields={{ id: u.id }} question={`Turn password sign-in off for ${u.displayName}? Their Discord sign-in stays; sessions that came in by password end. Only they can set it up again.`}>Turn password sign-in off</ConfirmItem>
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
      {u.id !== meId && <ConfirmItem action={removeUserAction} fields={{ id: u.id }} question={`Remove ${u.displayName} from the group? Their votes and their link to Minecraft go with them. While they are in the Discord server they can sign in again and start afresh.`}>Remove</ConfirmItem>}
      {u.id !== meId && u.discordId && <ConfirmItem action={removeUserAction} fields={{ id: u.id, block: "1" }} question={`Remove ${u.displayName} and block their Discord account? They cannot sign in again until you unblock them on People.`}>Remove and block</ConfirmItem>}
    </RowMenu>
  );
}
