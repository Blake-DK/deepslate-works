import { Switch } from "@/components/admin/parts";
import { setTesterAction } from "@/app/(app)/admin/users/actions";
import { isLinked, LINK_FIRST } from "@/server/testers";
import { ukDay } from "@/lib/uk-time";
import { db } from "@/server/db";

type Member = { id: string; displayName: string; role: string; tester: boolean; testerAt: Date | null; mcUuid: string | null; mcUsername: string | null; verifiedAt: Date | null };

const WHY = "Tester: the Test tab in their app and the test server, as a normal player. Never the test site, nothing of an admin's. One click turns it on or off.";

/**
 * docs/57: the Tester switch, on Admin → People and on the Test server card. One click saves it (no Save, no confirm).
 * Greyed for a member with no linked Minecraft account, and for an admin, who has the Test tab without it.
 */
export function TesterSwitch({ u }: { u: Member }) {
  const admin = u.role === "ADMIN";
  const linked = isLinked(u);
  // an admin who had it on before being made one can still have it turned off
  const disabled = !u.tester && (admin || !linked);
  const note = u.tester ? (u.testerAt ? `Tester since ${ukDay(u.testerAt)}` : "Tester") : admin ? "Admins have it" : !linked ? LINK_FIRST : null;
  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-testid="tester-switch">
      <Switch action={setTesterAction} fields={{ id: u.id, on: u.tester ? "0" : "1" }} on={u.tester} label={`Tester: ${u.displayName}`} disabled={disabled} why={disabled ? (admin ? "Admins have the Test tab without it" : LINK_FIRST) : WHY} />
      {note && <span className="min-w-0 whitespace-normal text-xs leading-tight text-muted-foreground">{note}</span>}
    </span>
  );
}

/** docs/57 §2: the testers on the Test server card, each with the same switch, so one click turns one off from there. */
export async function TesterList() {
  const testers = await db.user.findMany({ where: { tester: true }, orderBy: { testerAt: "asc" }, select: { id: true, displayName: true, role: true, tester: true, testerAt: true, mcUuid: true, mcUsername: true, verifiedAt: true } });
  return (
    <div className="space-y-1 border-t pt-2" data-testid="test-server-testers">
      <p className="font-medium">Testers · {testers.length}</p>
      {testers.length === 0 ? (
        <p className="text-muted-foreground">None. Turn the Tester switch on for a member on People: they get the Test tab in their app and the test server, never the test site.</p>
      ) : (
        <ul className="divide-y">
          {testers.map((u) => (
            <li key={u.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 py-1.5">
              <span className="min-w-0 truncate">{u.displayName}{u.mcUsername && u.mcUsername !== u.displayName && <span className="font-mono text-xs text-muted-foreground"> {u.mcUsername}</span>}</span>
              <TesterSwitch u={u} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
