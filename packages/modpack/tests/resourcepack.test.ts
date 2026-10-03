import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildConfigZip, RESOURCE_PACK_ZIP } from "../src/build";
import { diffLocks, hashResourcePack, packHash, type LockFile } from "../src/lock";
import { openZip, openZipFile } from "../src/zip";

const dirs: string[] = [];
async function tmp() {
  const d = await mkdtemp(path.join(tmpdir(), "rp-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function pack(root: string, skin = "skin") {
  const v = path.join(root, "assets/minecraft/textures/entity/villager");
  await mkdir(v, { recursive: true });
  await writeFile(path.join(root, "pack.mcmeta"), '{"pack":{"pack_format":34,"description":"t"}}');
  await writeFile(path.join(root, "README.md"), "drop textures here");
  await writeFile(path.join(v, "villager.png"), skin);
}

describe("the Deepslate texture pack (modpack/resourcepack/)", () => {
  it("is hashed only when it has a pack.mcmeta, and the hash follows its files", async () => {
    const d = await tmp();
    expect(await hashResourcePack(undefined)).toBeUndefined();
    expect(await hashResourcePack(path.join(d, "missing"))).toBeUndefined();
    await pack(d);
    const h = await hashResourcePack(d);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    await pack(d, "other skin");
    expect(await hashResourcePack(d)).not.toBe(h);
  });

  it("is part of the pack's version and of Lock's diff; without it the version is what it was", () => {
    const files = [{ slug: "a", versionId: "1" }];
    expect(packHash("21.1.252", files, [], undefined)).toBe(packHash("21.1.252", files, []));
    expect(packHash("21.1.252", files, [], "a".repeat(64))).not.toBe(packHash("21.1.252", files, []));
    const base: LockFile = { generatedAt: "", minecraft: "1.21.1", neoforge: "21.1.252", hash: "", files: [], configs: [] };
    expect(diffLocks(base, base).configs).toEqual([]);
    expect(diffLocks(base, { ...base, resourcepack: "a".repeat(64) }).configs).toEqual(["resourcepack"]);
    expect(diffLocks({ ...base, resourcepack: "a".repeat(64) }, { ...base, resourcepack: "b".repeat(64) }).configs).toEqual(["resourcepack"]);
  });

  it("goes into config.zip as resourcepacks/deepslate-textures.zip, without its README", async () => {
    const d = await tmp();
    const config = path.join(d, "config");
    await mkdir(config);
    await writeFile(path.join(config, "a.toml"), "x = 1");
    const resourcepack = path.join(d, "resourcepack");
    await pack(resourcepack);
    const out = await buildConfigZip({ dist: path.join(d, "dist"), config, resourcepack }, () => {});
    const zip = await openZipFile(out!);
    expect(zip.names).toContain("config/a.toml");
    expect(zip.names).toContain(`resourcepacks/${RESOURCE_PACK_ZIP}`);
    const inner = openZip(zip.read(`resourcepacks/${RESOURCE_PACK_ZIP}`)!);
    expect(inner.names.sort()).toEqual(["assets/minecraft/textures/entity/villager/villager.png", "pack.mcmeta"]);
    expect(inner.read("assets/minecraft/textures/entity/villager/villager.png")!.toString()).toBe("skin");
  });

  it("leaves config.zip as it was when there is no pack", async () => {
    const d = await tmp();
    const config = path.join(d, "config");
    await mkdir(config);
    await writeFile(path.join(config, "a.toml"), "x = 1");
    await mkdir(path.join(d, "dist"));
    const zip = await openZipFile((await buildConfigZip({ dist: path.join(d, "dist"), config, resourcepack: path.join(d, "none") }, () => {}))!);
    expect(zip.names.filter((n) => !n.endsWith("/"))).toEqual(["config/a.toml"]);
  });
});
