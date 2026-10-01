// Break-glass (docs/09, planner 2026-10-01): when no admin can sign in any more.
//   docker exec -it deepslate-api pnpm admin:reset-auth <username>
// <username> is an admin's password sign-in username, or (if they never set one up) their display name.
// Switches that admin's authenticator off (password sign-in stays off until they set it up again) and prints a
// one-time sign-in link, valid 15 minutes, used once. Both go into the event log. Nothing else is changed.
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const name = (process.argv[2] ?? "").trim();
if (!name) {
  console.error("usage: pnpm admin:reset-auth <username>");
  process.exit(2);
}
const db = new PrismaClient();
try {
  const login = await db.adminLogin.findUnique({ where: { username: name.toLowerCase() }, include: { user: true } });
  let user = login?.user ?? null;
  if (!user) {
    const byName = await db.user.findMany({ where: { role: "ADMIN", displayName: { equals: name, mode: "insensitive" } } });
    if (byName.length > 1) throw new Error(`more than one admin is called "${name}"; use their password sign-in username`);
    user = byName[0] ?? null;
  }
  if (!user) throw new Error(`no admin with the username or name "${name}"`);
  if (user.role !== "ADMIN") throw new Error(`${user.displayName} is not an admin`);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const totpReset = Boolean(login);
  await db.$transaction(async (tx) => {
    if (login) await tx.adminLogin.update({ where: { userId: user.id }, data: { enabled: false, totpSecret: null, pendingSecret: null, lastStep: null } });
    await tx.oneTimeLogin.create({ data: { tokenHash: createHash("sha256").update(token).digest("hex"), userId: user.id, expiresAt } });
    // The same wording as shared/events.ts "auth.adminBreakGlass".
    await tx.event.create({ data: { kind: "ADMIN_ACTION", actor: null, message: `One-time sign-in link made from the command line for ${user.displayName}${totpReset ? " (authenticator switched off)" : ""}, valid 15 minutes`, meta: { action: "auth.adminBreakGlass", params: { userId: user.id, displayName: user.displayName, totpReset, via: "cli" }, result: "OK", detail: null } } });
  });
  const portal = (process.env.PORTAL_URL ?? "https://deepslate.dsw.test").replace(/\/$/, "");
  console.log(`admin:    ${user.displayName}${login ? ` (username ${login.username})` : ""}`);
  console.log(`done:     ${totpReset ? "authenticator switched off; password sign-in is off until it is set up again" : "no password sign-in was set up; nothing switched off"}`);
  console.log(`link:     ${portal}/login/once/${token}`);
  console.log(`valid:    15 minutes (until ${expiresAt.toISOString()}), once. Open it, press Sign in, set up password sign-in again.`);
} catch (e) {
  console.error(`reset-auth: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
