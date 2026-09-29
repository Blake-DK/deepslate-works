// Create or reset the email/password ADMIN account from the CLI (no GUI password reset exists yet).
// Usage: docker exec deepslate-web node apps/web/scripts/admin.mjs <email> [displayName]
// Prints a fresh random password. Safe to re-run: resets the password and forces role ADMIN.
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const [email, displayName = "Alex"] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("usage: admin.mjs <email> [displayName]");
  process.exit(1);
}
const password = randomBytes(12).toString("base64url"); // 16 chars, above the 12-char minimum
const passwordHash = await bcrypt.hash(password, 12);
const db = new PrismaClient();
const user = await db.user.upsert({
  where: { email: email.toLowerCase() },
  create: { email: email.toLowerCase(), displayName, passwordHash, role: "ADMIN" },
  update: { passwordHash, role: "ADMIN" },
});
await db.event.create({ data: { kind: "ADMIN_ACTION", actor: user.id, message: `${user.displayName} had their password reset from the command line`, meta: { action: "auth.adminReset", params: { email, via: "cli" }, result: "OK", detail: null } } });
console.log(`login: ${email}\npassword: ${password}\nurl: ${process.env.AUTH_URL ?? "http://localhost:3000"}/login (open "Sign in with email")`);
await db.$disconnect();
