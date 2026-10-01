import type { DefaultSession } from "next-auth";
import type { Role } from "@prisma/client";
import "next-auth/jwt";

/** How a session came in: Discord, the members' email login, admin password + code, or a break-glass link. */
export type SignInVia = "discord" | "email" | "password" | "link";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: Role; sv?: number; via?: SignInVia; pa?: number } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    role?: Role;
    sv?: number; // User.sessionVersion when it was made; a higher one ends it
    via?: SignInVia;
    until?: number; // ms; admin password and link sessions end after 12 hours
    pa?: number; // AdminLogin.passwordAt (ms) of the password it was made with
  }
}
