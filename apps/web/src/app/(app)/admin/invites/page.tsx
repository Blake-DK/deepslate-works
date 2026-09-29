import type { Metadata } from "next";
import { db } from "@/server/db";
import { env } from "@/env";
import { inviteState } from "@/server/auth/invite-codes";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { createInviteAction, revokeInviteAction } from "./actions";
import { CopyButton } from "./copy-button";
import { RowMenu } from "@/components/admin/row-menu";
import { ConfirmItem } from "@/components/admin/menu-actions";
import { cell, Clip, Field, FixedTable, menuCell } from "@/components/admin/parts";

export const metadata: Metadata = { title: "Invites" };

export default async function InvitesPage() {
  const invites = await db.invite.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const userIds = invites.map((i) => i.usedBy).filter((x): x is string => Boolean(x));
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.displayName]));

  const parts = (i: (typeof invites)[number]) => {
    const state = inviteState(i);
    const used = state === "used";
    const when = used ? (nameOf.get(i.usedBy!) ?? "someone who has left") : formatDate(i.expiresAt);
    return {
      used,
      state: <Badge tone={state === "valid" ? "good" : used ? "neutral" : "bad"} className="shrink-0">{state}</Badge>,
      note: i.note ? <Clip text={i.note} className="text-muted-foreground" /> : <span className="text-muted-foreground">–</span>,
      when: <Clip text={when} className="text-muted-foreground" />,
      copy: state === "valid" ? <CopyButton text={`${env.AUTH_URL}/join/${i.code}`} /> : null,
      menu: used ? null : (
        <RowMenu label={`Actions for invite ${i.code}`}>
          <ConfirmItem action={revokeInviteAction} fields={{ code: i.code }} question={`Remove the invite ${i.code}${i.note ? ` (${i.note})` : ""}? Its link stops working.`}>Remove</ConfirmItem>
        </RowMenu>
      ),
    };
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invites</h1>
      <Card>
        <CardHeader>
          <CardTitle>New invite</CardTitle>
          <CardDescription>Send the link in Discord. One link, one person.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createInviteAction} className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <Label htmlFor="note">Who is it for?</Label>
              <Input id="note" name="note" placeholder="for Bertie" maxLength={60} />
            </div>
            <div className="w-28">
              <Label htmlFor="days">Valid for (days)</Label>
              <Input id="days" name="days" type="number" min={1} max={90} defaultValue={7} />
            </div>
            <Button type="submit">Create invite</Button>
          </form>
        </CardContent>
      </Card>
      {invites.length === 0 ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground">No invites yet.</CardContent></Card>
      ) : (
        <>
          <Card className="hidden min-[800px]:block" data-testid="invites-table">
            <CardContent className="p-2">
              <FixedTable label="Invites" widths={["14%", "11%", "31%", "22%", "14%", "56px"]} head={[{ text: "Code" }, { text: "State" }, { text: "For" }, { text: "Expires or used by" }, { text: "Link" }, { text: "Actions", hidden: true }]}>
                {invites.map((i) => {
                  const p = parts(i);
                  return (
                    <tr key={i.code} data-row>
                      <td className={cell}><Clip text={i.code} mono /></td>
                      <td className={cell}>{p.state}</td>
                      <td className={cell}>{p.note}</td>
                      <td className={cell}>{p.when}</td>
                      <td className={cell}>{p.copy}</td>
                      <td className={menuCell}>{p.menu}</td>
                    </tr>
                  );
                })}
              </FixedTable>
            </CardContent>
          </Card>
          <ul className="space-y-3 min-[800px]:hidden" data-testid="invites-cards">
            {invites.map((i) => {
              const p = parts(i);
              return (
                <li key={i.code}>
                  <Card data-row>
                    <CardContent className="p-4">
                      <div className="flex min-w-0 items-center gap-2"><Clip text={i.code} mono className="text-base" />{p.state}<span className="ml-auto shrink-0">{p.menu}</span></div>
                      <dl className="mt-2 divide-y text-sm">
                        <Field name="For">{p.note}</Field>
                        <Field name={p.used ? "Used by" : "Expires"}>{p.when}</Field>
                        {p.copy && <Field name="Link">{p.copy}</Field>}
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
