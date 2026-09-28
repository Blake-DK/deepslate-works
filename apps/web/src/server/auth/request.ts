import "server-only";
import { headers } from "next/headers";

/** Client IP as seen through Caddy (trusted, same docker network). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown"
  );
}
