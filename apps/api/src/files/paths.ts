// docs/16 §3: the file explorer is read-only and every path is cleaned here before AMP sees it.
// AMP confines the file manager to the instance's Minecraft/ directory by itself; this is the second fence.

export type Clean = { ok: true; path: string } | { ok: false; reason: string };

/** "" is the root. No leading slash, no "..", no backslashes, no control characters, no empty segments. */
export function cleanPath(input: unknown): Clean {
  if (typeof input !== "string") return { ok: true, path: "" };
  if (input.length > 400) return { ok: false, reason: "That path is too long." };
  if (/[\x00-\x1f\x7f]/.test(input) || input.includes("\\")) return { ok: false, reason: "That path has characters that are not allowed." };
  const parts = input.split("/").filter((p) => p !== "");
  if (parts.some((p) => p === ".." || p === "." || p.startsWith("~"))) return { ok: false, reason: "That path leaves the server's folder." };
  return { ok: true, path: parts.join("/") };
}

export const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");
export const nameOf = (path: string) => path.split("/").at(-1) ?? "";

const TEXT = new Set(["properties", "toml", "json", "json5", "txt", "log", "cfg", "conf", "yml", "yaml", "ini", "md", "sh", "bat", "mcmeta", "snbt", "csv", "xml", "lang"]);
export function extensionOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}
/** Files worth showing as text. README and the like have no extension. */
export function isTextLike(name: string): boolean {
  return TEXT.has(extensionOf(name)) || /^(readme|license|eula)$/i.test(name);
}

const TYPES: Record<string, string> = { json: "application/json", txt: "text/plain", log: "text/plain", properties: "text/plain", toml: "text/plain", cfg: "text/plain", conf: "text/plain", yml: "text/plain", yaml: "text/plain", png: "image/png", jar: "application/java-archive", zip: "application/zip", gz: "application/gzip" };
export const contentType = (name: string) => TYPES[extensionOf(name)] ?? "application/octet-stream";

/** Safe to put in a Content-Disposition header. */
export const downloadName = (name: string) => name.replace(/[^A-Za-z0-9._ +()-]/g, "_").slice(0, 120) || "file";
