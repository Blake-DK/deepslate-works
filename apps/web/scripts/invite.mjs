// Bootstrap invite from the command line (no admin exists yet, or Discord isn't wired up).
// Usage: node scripts/invite.mjs ["for Alex"] [days]
import { PrismaClient } from "@prisma/client";
import { randomInt } from "node:crypto";

const note = process.argv[2] ?? "bootstrap";
const days = Number(process.argv[3] ?? 7);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
let code = "";
for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];

const db = new PrismaClient();
await db.invite.create({ data: { code, createdBy: "cli", note, expiresAt: new Date(Date.now() + days * 86_400_000) } });
console.log(`${process.env.AUTH_URL ?? "http://localhost:3000"}/join/${code}`);
await db.$disconnect();
