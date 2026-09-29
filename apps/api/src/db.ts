import { PrismaClient } from "@prisma/client";

// Same schema as the web app (apps/web/prisma/schema.prisma); the client is generated at build time.
export const db = new PrismaClient({ log: ["warn", "error"] });
