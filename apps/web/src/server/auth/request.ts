import "server-only";
import { headers } from "next/headers";
import { originIsForeign } from "@/server/same-origin";

/** Client IP as seen through Caddy (trusted, same docker network). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}

/** For a server action: the request's Origin names another site (fromAnotherSite, src/server/same-origin.ts). */
export async function actionFromAnotherSite(): Promise<boolean> {
  const h = await headers();
  return originIsForeign(h.get("origin"), h.get("x-forwarded-host") ?? h.get("host"));
}
