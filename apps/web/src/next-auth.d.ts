import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
  }
}
