import { env } from "@/env";

/** Relative paths, or absolute URLs on the portal's own domain and its subdomains (the map host). */
export function safeNext(raw: FormDataEntryValue | string | null, authUrl: string = env.AUTH_URL): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  try {
    const u = new URL(s);
    const home = new URL(authUrl).hostname;
    if (u.protocol === "https:" && (u.hostname === home || u.hostname.endsWith(`.${home}`))) return u.toString();
  } catch {}
  return "/";
}

