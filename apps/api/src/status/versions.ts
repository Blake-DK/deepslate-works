import { readFileSync } from "node:fs";
import type { Amp } from "../amp/client.js";
import type { ConsoleTail } from "../amp/console.js";
import { chunks } from "../files/browse.js";

// Versions in the footers (planner, 2026-10-01): what really runs, never a typed number. api's own: package.json's
// semver, the commit and build time CI stamps into the image (PORTAL_COMMIT, PORTAL_BUILT_AT), the time it started
// (= the last deploy). The server's: the first line of its logs/latest.log, written at every start by ModLauncher:
// "ModLauncher running: args [--launchTarget, forgeserver, --fml.neoForgeVersion, 21.1.252, …, --fml.mcVersion, 1.21.1, …]".

export type Build = { app: "api"; version: string; commit: string | null; builtAt: string | null; startedAt: string };
export type ServerVersion = { minecraft: string; neoforge: string; readAt: string };

const STARTED = new Date().toISOString();
const FRESH_MS = 10 * 60_000;

function ownVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
const VERSION = ownVersion();

/** Pure: a stamped value, or null when the image was built without one ("dev", empty). */
export const stamped = (v: string | undefined) => (v && v !== "dev" && /^[\w.:+-]{1,64}$/.test(v) ? v : null);

export function build(env: NodeJS.ProcessEnv = process.env): Build {
  return { app: "api", version: VERSION, commit: stamped(env.PORTAL_COMMIT), builtAt: stamped(env.PORTAL_BUILT_AT), startedAt: STARTED };
}

/** Pure: Minecraft and NeoForge out of ModLauncher's first line. */
export function parseLaunchLine(text: string): { minecraft: string; neoforge: string } | null {
  const nf = /--fml\.neoForgeVersion,\s*([\w.+-]{1,40})/.exec(text);
  const mc = /--fml\.mcVersion,\s*([\w.+-]{1,40})/.exec(text);
  return nf && mc ? { minecraft: mc[1]!, neoforge: nf[1]! } : null;
}

export class ServerVersions {
  private last: ServerVersion | null = null;

  constructor(
    private readonly amp: Amp,
    private readonly tail: ConsoleTail,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start() {
    // a new start writes a new latest.log: read it again then
    this.tail.on((e) => {
      if (e.type === "started") this.last = null;
    });
  }

  /** While the server runs: its versions, read at most every 10 minutes. Otherwise null (the site falls back to the pack). */
  async current(): Promise<ServerVersion | null> {
    if (this.tail.state !== 20) return null;
    if (this.last && this.now() - Date.parse(this.last.readAt) < FRESH_MS) return this.last;
    try {
      const parts: Buffer[] = [];
      for await (const c of chunks(this.amp, "logs/latest.log", 4096, 4096)) parts.push(c);
      const v = parseLaunchLine(Buffer.concat(parts).toString("utf8"));
      this.last = v ? { ...v, readAt: new Date(this.now()).toISOString() } : null;
    } catch {
      this.last = null;
    }
    return this.last;
  }
}
