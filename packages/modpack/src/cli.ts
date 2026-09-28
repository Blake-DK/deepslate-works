import { readFile } from "node:fs/promises";
import path from "node:path";
import { lintManifest } from "./lint";
import { verifyLinks } from "./verify-links";

const [cmd = "help", ...rest] = process.argv.slice(2);
const manifestPath = path.resolve(process.env.MODPACK_DIR ?? path.join(process.cwd(), "..", "..", "modpack"), "mods.json");

async function loadRaw(): Promise<unknown> {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

async function main() {
  switch (cmd) {
    case "lint": {
      const { manifest, issues } = lintManifest(await loadRaw());
      for (const i of issues) console.log(`${i.level.toUpperCase().padEnd(5)} ${i.message}`);
      const errors = issues.filter((i) => i.level === "error").length;
      console.log(`${manifestPath}: ${manifest ? `${manifest.mods.length} mods, ` : ""}${errors} error(s), ${issues.length - errors} warning(s)`);
      process.exit(errors ? 1 : 0);
    }
    // falls through never
    case "verify-links": {
      const { manifest, issues } = lintManifest(await loadRaw());
      if (!manifest) {
        for (const i of issues) console.log(`ERROR ${i.message}`);
        process.exit(1);
      }
      const results = await verifyLinks(manifest, { onResult: (r) => console.log(`${r.ok ? "ok  " : "FAIL"} ${r.kind.padEnd(8)} ${r.slug.padEnd(26)} ${r.status} ${r.url}`) });
      const failed = results.filter((r) => !r.ok);
      console.log(`${results.length} links checked, ${failed.length} failed`);
      process.exit(failed.length ? 1 : 0);
    }
    // falls through never
    case "lock":
    case "build":
    case "sync-server":
      console.log(`${cmd}: Phase 2 (docs/06). Not implemented yet.`);
      process.exit(2);
    // falls through never
    default:
      console.log(`usage: modpack <lint|verify-links|lock|build|sync-server> [${rest.join(" ")}]\nMODPACK_DIR=${path.dirname(manifestPath)}`);
      process.exit(cmd === "help" ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
