import { z } from "zod";
import { reportedVersion } from "./installer-version";

// docs/07 "Install reports". The installer redacts before it sends; everything is redacted again here
// before it is stored, because a copy of the script someone edited, or a bug in it, must not be able to put
// a name or an address into the database. Pure, so it is tested.

export const MAX_LOG_BYTES = 512 * 1024;
// "skipped": another copy was already running (installer 1.5.0's lock); nothing was done, and it is not a failure.
export const OUTCOMES = ["ok", "failed", "cancelled", "skipped"] as const;
export type Outcome = (typeof OUTCOMES)[number];
// 1.5.0 on (docs/07): first_install, update, play, already_running; "install" (Setup.bat) and "play" before that.
export const MODES = ["install", "play", "first_install", "update", "already_running", "uninstall"] as const;
/** What a run of each kind is called on the admin pages. */
export const MODE_LABEL: Record<string, string> = { install: "Setup.bat", play: "Play", first_install: "First install", update: "Update", already_running: "Already running", uninstall: "Uninstall" };
export type Mode = (typeof MODES)[number];

const short = (max: number) => z.string().max(max).transform((v) => v.trim());
const optional = (max: number) => z.string().max(max).nullish().transform((v) => (v ? v.trim() : null));
const number = (min: number, max: number) => z.number().finite().min(min).max(max).nullish().transform((v) => v ?? null);

export const systemSchema = z
  .object({
    os: z.object({ caption: optional(120), version: optional(40), build: optional(40), display: optional(40), arch: optional(20) }).partial().nullish(),
    cpu: z.object({ name: optional(160), cores: number(0, 1024), threads: number(0, 4096) }).partial().nullish(),
    ramGb: number(0, 8192),
    gpus: z.array(z.object({ name: optional(160), driver: optional(60), vramMb: number(0, 1_000_000) }).partial()).max(8).nullish(),
    disk: z.object({ drive: optional(8), freeGb: number(0, 1_000_000), totalGb: number(0, 1_000_000) }).partial().nullish(),
    launcher: z.object({ version: optional(60), kind: optional(40), profilesFormat: number(0, 1000) }).partial().nullish(),
    java: z.object({ source: optional(40), path: optional(300), version: optional(120), passedOver: optional(120) }).partial().nullish(),
    neoforge: z.object({ version: optional(40), before: z.boolean().nullish(), after: z.boolean().nullish() }).partial().nullish(),
    powershell: optional(40),
  })
  .strip();
export type SystemInfo = z.infer<typeof systemSchema>;

// Installer 1.5.6 (planner, 2026-09-30): what could not be set up on the PC, part by part, with a reason code.
export const SETUP_PARTS = ["copy", "link", "shortcuts", "apps", "setup"] as const;
export const SETUP_CODES = ["in_zip", "copy_denied", "link_failed", "shortcut_blocked", "other"] as const;
const setupProblemSchema = z.object({ part: z.enum(SETUP_PARTS), code: z.enum(SETUP_CODES), message: z.string().max(500) }).strip();
export type SetupProblem = z.infer<typeof setupProblemSchema>;

/**
 * The Play button has no working link on that PC: run from inside the zip, the copy refused, or the link itself not
 * set. A desktop shortcut the ransomware protection blocked is only a note. Null when the report does not say.
 */
export function playLinkMissing(problems: SetupProblem[] | null | undefined): boolean | null {
  if (!problems) return null;
  return problems.some((p) => p.code === "in_zip" || p.code === "copy_denied" || p.code === "link_failed");
}

export const reportSchema = z
  .object({
    packVersion: short(60),
    // installers that do not say which they are are stored as "unknown", and count as out of date (installer-version.ts)
    installerVersion: z.string().max(40).nullish().transform((v) => reportedVersion(v)),
    mode: z.enum(MODES).nullish().transform((v) => v ?? "install"), // installers before 1.3.0 don't say
    updatedFrom: z.string().regex(/^\d{1,4}(\.\d{1,4}){1,3}$/).nullish().transform((v) => v ?? null), // since 1.4.0
    updateProblem: optional(300),
    outcome: z.enum(OUTCOMES),
    failedStep: optional(120),
    durationSec: z.number().finite().min(0).max(86_400).transform((v) => Math.round(v)),
    log: z.string().max(MAX_LOG_BYTES * 2),
    system: systemSchema.nullish().transform((v) => v ?? systemSchema.parse({})), // an uninstall (1.5.2) sends none: all fields empty
    setupProblems: z.array(setupProblemSchema).max(10).nullish().transform((v) => v ?? null), // since 1.5.6
  })
  .strip();
export type Report = z.infer<typeof reportSchema>;

const IPV4 = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.]|\.\d)/g;
const IPV6 = /(?<![\w:])(?:(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}|(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,5})?)(?![\w:])/gi;

/** Names in paths, tokens, e-mail addresses. Safe for any string, versions included. */
export function redactText(input: string): string {
  return (
    input
      // C:\Users\<name>\...  also with doubled backslashes (JSON) and forward slashes
      .replace(/\b([A-Za-z]):(\\{1,4}|\/)(Users|Documents and Settings)(\\{1,4}|\/)([^\\/:*?"<>|\r\n]+)/gi, (_m, d: string, s1: string, u: string, s2: string) => `${d}:${s1}${u}${s2}~`)
      .replace(/(^|[\s"'=(])\/(home|Users)\/([^\/\s"']+)/g, (_m, pre: string, root: string) => `${pre}/${root}/~`)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, "$1 ~")
      .replace(/("?(?:launcherToken|pollToken|accessToken|refreshToken|clientToken|token|password|passwd|secret|authorization|api[-_]?key)"?\s*[:=]\s*"?)(?!(?:Bearer|Basic)\s)([^"\s,;}]{4,})/gi, "$1~")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "~@~")
      // long random strings that are not plain hex (file hashes are hex and say nothing about anyone)
      .replace(/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[G-Zg-z_-])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{40,}(?![A-Za-z0-9_-])/g, "~")
  );
}

/** Addresses too. For free text (the log); version numbers with four short parts are taken for addresses, which costs nothing. */
export function redactLog(input: string): string {
  return redactText(input).replace(IPV6, "~ip~").replace(IPV4, "~ip~");
}

/** Keeps the start and the end: that is where the versions and the failure are. */
export function truncateMiddle(text: string, maxBytes: number = MAX_LOG_BYTES): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  const note = "\n\n[… the middle of the log was cut to fit …]\n\n";
  const half = Math.floor((maxBytes - enc.encode(note).length) / 2);
  const bytes = enc.encode(text);
  const dec = new TextDecoder("utf-8", { fatal: false });
  const head = dec.decode(bytes.subarray(0, half)).replace(/\ufffd+$/, "");
  const tail = dec.decode(bytes.subarray(bytes.length - half)).replace(/^\ufffd+/, "");
  return `${head}${note}${tail}`;
}

function deep<T>(v: T, f: (s: string, key: string) => string, key = ""): T {
  if (typeof v === "string") return f(v, key) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => deep(x, f, key)) as unknown as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f, k)])) as T;
  return v;
}

/** What is stored. `names` are things known to be personal (the member's own names); they are blanked wherever they appear as a word. */
export function sanitizeReport(r: Report, names: string[] = []): Report {
  const words = names.map((n) => n.trim()).filter((n) => n.length >= 3).map((n) => new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "gi"));
  const blank = (s: string) => words.reduce((t, re) => t.replace(re, "~"), s);
  return {
    ...r,
    failedStep: r.failedStep ? blank(redactLog(r.failedStep)).slice(0, 120) : null,
    updateProblem: r.updateProblem ? blank(redactLog(r.updateProblem)).slice(0, 300) : null,
    log: truncateMiddle(blank(redactLog(r.log.replace(/\r\n?/g, "\n").replace(/\u0000/g, "")))),
    setupProblems: r.setupProblems ? r.setupProblems.map((p) => ({ ...p, message: blank(redactLog(p.message)).slice(0, 500) })) : null,
    // versions are left readable: addresses are only looked for in the fields that could hold one
    system: deep(r.system, (s, key) => blank(/version|driver|build|display|caption|name|kind|arch|powershell|source|drive/i.test(key) ? redactText(s) : redactLog(s))),
  };
}

// ---- reading a report ------------------------------------------------------------------------------------

export type Tier = "LOW" | "MID" | "HIGH";

const INTEGRATED = /\b(intel\b.*\b(u?hd|iris|graphics)\b|radeon(\(tm\))?\s+(r[2-7]\s)?graphics|vega\s*\d|microsoft basic|virtualbox|vmware|parsec|hyper-v)\b/i;
const STRONG = /\b(rtx\s*\d{4}|gtx\s*(10[678]0|1660|9[78]0)|rx\s*(5[5-9]00|[6-9]\d00)|arc\s*\(?(tm)?\)?\s*[ab]\d{3})\b/i;
const DEDICATED = /\b(geforce|rtx|gtx|quadro|radeon\s+(rx|pro|hd)|\brx\s*\d{3,4}|arc\s*\(?(tm)?\)?\s*[ab]\d{3})\b/i;

export type Hardware = { ramGb?: number | null; gpus?: Array<{ name?: string | null }> | null };

/**
 * The PC tier, worked out from what the installer saw: memory and graphics card. Null when there is nothing to go on.
 * LOW: under 8 GB, or built-in graphics only. HIGH: 16 GB or more and a strong card. MID: everything between.
 */
export function suggestTier(system: Hardware | null | undefined): { tier: Tier; why: string } | null {
  if (!system) return null;
  const ram = system.ramGb ?? null;
  const gpus = (system.gpus ?? []).map((g) => g.name ?? "").filter(Boolean);
  if (ram === null && gpus.length === 0) return null;
  const real = gpus.filter((g) => !/microsoft basic|parsec|virtual|remote|hyper-v|citrix|displaylink/i.test(g));
  const strong = real.some((g) => STRONG.test(g));
  const dedicated = real.some((g) => DEDICATED.test(g) && (!INTEGRATED.test(g) || STRONG.test(g))); // Intel Arc says "Intel … Graphics" and is a real card
  const card = real.find((g) => STRONG.test(g)) ?? real.find((g) => DEDICATED.test(g)) ?? real[0] ?? "no graphics card found";
  const mem = ram === null ? "memory not known" : `${Math.round(ram)} GB of memory`;
  if (ram !== null && ram < 7.5) return { tier: "LOW", why: `${mem}` };
  if (!dedicated) return { tier: "LOW", why: `${mem}, built-in graphics (${card})` };
  if (strong && (ram === null || ram >= 15.5)) return { tier: "HIGH", why: `${mem}, ${card}` };
  return { tier: "MID", why: `${mem}, ${card}` };
}

export function summary(system: SystemInfo | null | undefined): { os: string; ram: string; gpu: string; cpu: string } {
  const os = system?.os;
  const gpus = (system?.gpus ?? []).map((g) => g.name).filter((n): n is string => Boolean(n));
  return {
    os: os?.caption ? `${os.caption.replace(/^Microsoft\s+/i, "")}${os.display ? ` ${os.display}` : ""}${os.build ? ` (${os.build})` : ""}` : "not known",
    ram: system?.ramGb != null ? `${Math.round(system.ramGb)} GB` : "not known",
    gpu: gpus.length ? gpus.join(" + ") : "not known",
    cpu: system?.cpu?.name ? `${system.cpu.name.replace(/\s+/g, " ").trim()}${system.cpu.cores ? `, ${system.cpu.cores} cores` : ""}` : "not known",
  };
}

/** Which lines of a log to mark: the step that failed, and what followed it. */
export function markLog(log: string, failedStep: string | null): Array<{ n: number; text: string; mark: "step" | "fail" | "after" | null }> {
  const lines = log.split("\n");
  let at = -1;
  if (failedStep) for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.includes(`STEP ${failedStep}`)) { at = i; break; }
  return lines.map((text, i) => ({ n: i + 1, text, mark: /\]\s+FAIL\b|PROFILE NOT SAVED|UPDATE NOT APPLIED/.test(text) ? "fail" : at >= 0 && i === at ? "step" : at >= 0 && i > at ? "after" : null }));
}

// ---- for a column of a table: the part of a name that tells one from another. The whole name is in the tooltip.

/** "13th Gen Intel(R) Core(TM) i7-13700H, 14 cores" → "i7-13700H, 14 cores"; "AMD Ryzen 7 5800X 8-Core Processor" → "Ryzen 7 5800X". */
export function shortCpu(cpu: string): string {
  const t = cpu
    .replace(/\((?:R|TM|C)\)/gi, "")
    .replace(/^\s*\d+(?:st|nd|rd|th) Gen\s+/i, "")
    .replace(/\b(?:Intel|AMD)\b\s*/gi, "")
    .replace(/\bCore\s+(?=i\d|Ultra)/i, "")
    .replace(/\s+CPU\s+@\s*[\d.]+\s*GHz/i, "")
    .replace(/\s+\d+-Core Processor/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return t || cpu;
}

/** "NVIDIA GeForce RTX 4070 Laptop GPU + Intel(R) Iris(R) Xe Graphics" → "RTX 4070 Laptop +1": the strongest card first, the rest counted. */
export function shortGpu(gpu: string): string {
  if (!gpu || gpu === "not known") return gpu;
  const names = gpu.split(" + ").map((g) => g.replace(/\((?:R|TM|C)\)/gi, "").replace(/\b(?:NVIDIA|GeForce|AMD|Intel|Graphics|GPU)\b/gi, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (names.length === 0) return gpu;
  const rank = (n: string) => (/\b(RTX|GTX|RX\s*\d|Arc)\b/i.test(n) ? 0 : 1);
  const sorted = [...names].sort((a, b) => rank(a) - rank(b));
  return sorted.length > 1 ? `${sorted[0]} +${sorted.length - 1}` : sorted[0]!;
}

/** "Windows 11 Home Single Language 24H2 (26100)" → "11 Home SL 24H2": the column is called Windows. */
export function shortOs(os: string): string {
  if (!os || os === "not known") return os;
  return os.replace(/^Windows\s+/i, "").replace(/\bSingle Language\b/i, "SL").replace(/\s*\(\d+\)\s*$/, "").replace(/\s+/g, " ").trim() || os;
}
