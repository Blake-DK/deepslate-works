import { describe, expect, it } from "vitest";
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { openZip } from "../src/zip";
import { iconFor, modNameOf, titleOf } from "../src/items";

// docs/13 §13: the item catalogue is read out of the jars; these build a small jar the same way a mod's is laid out.

function jar(files: Record<string, string | Buffer>, store = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", store ? { store: true } : { zlib: { level: 9 } });
    const out = new PassThrough();
    const parts: Buffer[] = [];
    out.on("data", (c: Buffer) => parts.push(c));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, body] of Object.entries(files)) a.append(body, { name });
    void a.finalize();
  });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const BLOCK_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9]);

describe("openZip", () => {
  it("reads deflated and stored entries, and lists them", async () => {
    for (const store of [false, true]) {
      const z = openZip(await jar({ "a.txt": "hello", "dir/b.json": '{"x":1}' }, store));
      expect(z.names.sort()).toEqual(["a.txt", "dir/b.json"]);
      expect(z.read("a.txt")?.toString()).toBe("hello");
      expect(z.read("dir/b.json")?.toString()).toBe('{"x":1}');
      expect(z.read("missing")).toBeNull();
    }
  });
  it("says so when it is not a zip", () => {
    expect(() => openZip(Buffer.from("not a zip at all, nothing like one"))).toThrow("not a zip file");
  });
});

describe("iconFor", () => {
  it("takes an item's own picture, or follows a block item to its block's texture", async () => {
    const z = openZip(await jar({
      "assets/create/models/item/andesite_alloy.json": '{"parent":"item/generated","textures":{"layer0":"create:item/andesite_alloy"}}',
      "assets/create/textures/item/andesite_alloy.png": PNG,
      "assets/create/models/item/andesite_casing.json": '{"parent":"create:block/andesite_casing"}',
      "assets/create/models/block/andesite_casing.json": '{"parent":"block/cube_all","textures":{"all":"#casing","casing":"create:block/andesite_casing"}}',
      "assets/create/textures/block/andesite_casing.png": BLOCK_PNG,
      "assets/create/models/item/ghost.json": '{"parent":"builtin/entity"}',
      "META-INF/neoforge.mods.toml": 'modId="create"\ndisplayName="Create"\n',
    }));
    const srcs = [{ zip: z }];
    expect(iconFor(srcs, "create:andesite_alloy")).toEqual(PNG);
    expect(iconFor(srcs, "create:andesite_casing")).toEqual(BLOCK_PNG);
    expect(iconFor(srcs, "create:ghost")).toBeNull();
    expect(modNameOf(z, "create-1.21.1-6.0.10")).toBe("Create");
    expect(titleOf("andesite_alloy")).toBe("Andesite Alloy");
  });
});
