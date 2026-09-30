import path from "node:path";

/** Repo-relative layout (docs/02). MODPACK_DIR overrides where mods.json lives; everything else hangs off it. */
export function modpackPaths(modpackDir = process.env.MODPACK_DIR ?? path.join(process.cwd(), "..", "..", "modpack")) {
  const root = path.resolve(modpackDir);
  const repo = process.env.REPO_DIR ?? path.resolve(root, "..");
  return {
    root,
    repo,
    manifest: path.join(root, "mods.json"),
    lock: path.join(root, "mods.lock.json"),
    config: path.join(root, "config"),
    server: path.join(root, "server"),
    items: path.join(root, "items", "vanilla-1.21.1.json"), // docs/13 §13: every vanilla item, from the game's own report
    datapacks: path.join(root, "datapacks"), // go into the world: Minecraft/world/datapacks/ (docs/14)
    dist: process.env.DIST_DIR ?? path.join(repo, "dist"),
    installer: path.join(repo, "installer"),
  };
}
