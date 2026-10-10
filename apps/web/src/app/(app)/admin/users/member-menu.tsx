import { RowMenu } from "@/components/admin/row-menu";
import { menuItem } from "@/components/admin/menu-item";
import { ConfirmItem, LinkByName } from "@/components/admin/menu-actions";
import Link from "next/link";
import { runActionAction } from "../server/actions";
import { KICK_REASON } from "../server/cards";
import { clearMinecraftNameAction, removeUserAction, revokeLauncherAction, setBuilderToolsAction, setMaintenanceJoinAction, setMinecraftNameAction, setOutsideAuthAction, setRoleAction, turnOffPasswordSignInAction } from "./actions";

type Member = { id: string; displayName: string; role: "ADMIN" | "PLAYER"; mcUsername: string | null; mcUuid?: string | null; passwordSignIn?: boolean; discordId?: string | null; outsideAuth?: boolean; builderTools?: boolean; maintenanceJoin?: boolean };

/**
 * A member's admin menu: on People → Members and on their player page (docs/13 §11 layout). `row` is People's: there
 * the menu also opens their Inventory and, while the server runs, kicks them back to the door (docs/48 A4), the same
 * call as the typed-name card under the table.
 */
export function MemberMenu({ u, meId, row }: { u: Member; meId: string; row?: { running: boolean } }) {
  const admin = u.role === "ADMIN";
  return (
    <RowMenu label={`Actions for ${u.displayName}`}>
      {row && u.mcUuid && <Link href={`/players/${u.mcUuid}?tab=inventory`} role="menuitem" className={menuItem}>Inventory</Link>}
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
      {admin && (u.builderTools
        ? <ConfirmItem action={setBuilderToolsAction} fields={{ id: u.id, on: "0" }} question={`Take Builder tools away from ${u.displayName}? If they are in Builder mode on the server, they go back to survival now.`}>Take Builder tools away</ConfirmItem>
        : <ConfirmItem action={setBuilderToolsAction} fields={{ id: u.id, on: "1" }} question={`Give ${u.displayName} Builder tools? They can then switch Builder mode on for themselves (creative, where WorldEdit works) to place uploaded builds.`}>Give Builder tools</ConfirmItem>)}
      {/* docs/48 B1: admins only, like Builder tools */}
      {admin && (u.maintenanceJoin
        ? <ConfirmItem action={setMaintenanceJoinAction} fields={{ id: u.id, on: "0" }} question={`Take "Can join during maintenance" away from ${u.displayName}? While maintenance is on they then wait at the door like everyone else.`}>Take away joining during maintenance</ConfirmItem>
        : <ConfirmItem action={setMaintenanceJoinAction} fields={{ id: u.id, on: "1" }} question={`Let ${u.displayName} join during maintenance? While it is on, the door lets in admins with this tick and nobody else.`}>Can join during maintenance</ConfirmItem>)}
      {u.mcUsername && (
        <form action={clearMinecraftNameAction}>
          <input type="hidden" name="id" value={u.id} />
          <button type="submit" role="menuitem" className={menuItem}>Unlink</button>
        </form>
      )}
      <LinkByName action={setMinecraftNameAction} id={u.id} who={u.displayName} />
      {row?.running && u.mcUsername && (
        <ConfirmItem action={runActionAction} fields={{ back: "/admin/people", action: "player.revoke", name: u.mcUsername, reason: KICK_REASON }} question={`Kick ${u.mcUsername} back to the door? They are kicked and the door looks at them again the next time they join.`}>Kick back to the door</ConfirmItem>
      )}
      <form action={revokeLauncherAction} title="Signs the installer out on all their PCs">
        <input type="hidden" name="id" value={u.id} />
        <button type="submit" role="menuitem" className={menuItem}>Sign out installer</button>
      </form>
      {u.discordId && (u.outsideAuth
        ? <ConfirmItem action={setOutsideAuthAction} fields={{ id: u.id, on: "0" }} question={`Apply the Discord server rule to ${u.displayName} again? If they are not in the Discord server they are signed out and wait in the entrance room until they join it.`}>Apply the Discord server rule</ConfirmItem>
        : <ConfirmItem action={setOutsideAuthAction} fields={{ id: u.id, on: "1" }} question={`Let ${u.displayName} in without the Discord server? They can sign in and play whether or not they are in it, the same as someone who came in by an invite link.`}>Let in without the Discord server</ConfirmItem>)}
      {u.id !== meId && <ConfirmItem action={removeUserAction} fields={{ id: u.id }} question={`Remove ${u.displayName} from the group? Their votes and their link to Minecraft go with them. While they are in the Discord server they can sign in again and start afresh.`}>Remove</ConfirmItem>}
      {u.id !== meId && u.discordId && <ConfirmItem action={removeUserAction} fields={{ id: u.id, block: "1" }} question={`Remove ${u.displayName} and block their Discord account? They cannot sign in again until you unblock them on People.`}>Remove and block</ConfirmItem>}
    </RowMenu>
  );
}
