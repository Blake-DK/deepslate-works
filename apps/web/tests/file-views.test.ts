import { describe, expect, it } from "vitest";
import { bytes, colour, readList, readProperties, sortEntries } from "@/lib/file-views";

const PROPS = `#Minecraft server properties
#Mon Sep 29 03:46:02 UTC 2026
motd=Deepslate Works
pvp=true
max-players=20
online-mode=TRUE
level-name=world
resource-pack-prompt=
server-ip=
rcon.password=
generator-settings={}
`;

describe("server.properties", () => {
  it("lists the settings and marks the ones that differ from what the manifest expects", () => {
    const { rows, missing } = readProperties(PROPS, { motd: "Deepslate Works", pvp: "false", "max-players": "20", "online-mode": "true", "view-distance": "10" });
    expect(rows.map((r) => r.key)).toEqual(["motd", "pvp", "max-players", "online-mode", "level-name", "resource-pack-prompt", "server-ip", "rcon.password", "generator-settings"]);
    expect(rows.filter((r) => r.differs).map((r) => [r.key, r.value, r.expected])).toEqual([["pvp", "true", "false"]]);
    expect(rows.find((r) => r.key === "online-mode")).toMatchObject({ value: "TRUE", differs: false });
    expect(rows.find((r) => r.key === "level-name")).toMatchObject({ expected: undefined, differs: false });
    expect(rows.find((r) => r.key === "motd")?.line).toBe(3);
    expect(missing).toEqual([{ key: "view-distance", expected: "10" }]);
  });
  it("copes with an empty file", () => {
    expect(readProperties("", { pvp: "false" })).toEqual({ rows: [], missing: [{ key: "pvp", expected: "false" }] });
  });
});

describe("whitelist, ops and bans", () => {
  it("become tables", () => {
    expect(readList("whitelist.json", '[{"uuid":"c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10","name":"Bramble09"}]')).toEqual({ columns: ["name", "uuid"], rows: [["Bramble09", "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10"]] });
    expect(readList("ops.json", '[{"uuid":"u","name":"Bramble09","level":4,"bypassesPlayerLimit":false}]')?.rows).toEqual([["Bramble09", "u", "4", "false"]]);
    expect(readList("banned-players.json", "[]")).toEqual({ columns: ["name", "uuid", "reason", "source", "created", "expires"], rows: [] });
  });
  it("leave everything else alone", () => {
    expect(readList("server.properties", "[]")).toBeNull();
    expect(readList("whitelist.json", "not json")).toBeNull();
    expect(readList("whitelist.json", '{"a":1}')).toBeNull();
  });
});

describe("colour", () => {
  const join = (line: string, ext: string) => colour(line, ext).map((t) => t.text).join("");
  it("never changes the text", () => {
    for (const [line, ext] of [["motd=Deepslate Works # hello", "properties"], ['  "pvp": false, "n": -1.5e3, "s": "a \\"b\\" c"', "json"], ["[29Sep2026 03:46:07.132] [Server thread/WARN] [x/]: Can't keep up!", "log"], ["ip: \"10.77.0.2\"", "conf"], ["", "toml"], ["plain words", "txt"], ["<xml/>", "xml"]] as const) expect(join(line, ext)).toBe(line);
  });
  it("tells comments, keys and values apart", () => {
    expect(colour("# a comment", "properties")).toEqual([{ text: "# a comment", kind: "comment" }]);
    expect(colour("port: 8100", "conf").map((t) => t.kind)).toEqual(["plain", "key", "plain", "number"]);
    expect(colour("enabled=true", "properties").at(-1)).toEqual({ text: "true", kind: "word" });
    expect(colour('"name": "Bramble09"', "json").filter((t) => t.kind !== "plain").map((t) => t.kind)).toEqual(["key", "string"]);
    expect(colour("[19:00:00] [Server thread/ERROR]: boom", "log")[1]).toEqual({ text: "[Server thread/ERROR]", kind: "word" });
  });
});

describe("sizes and sorting", () => {
  it("writes sizes", () => {
    expect(bytes(157)).toBe("157 B");
    expect(bytes(1939)).toBe("1.9 KB");
    expect(bytes(478402)).toBe("467 KB");
    expect(bytes(6972019)).toBe("6.6 MB");
    expect(bytes(3 * 1073741824)).toBe("3.00 GB");
  });
  it("sorts by any column and keeps folders on top", () => {
    const e = [{ name: "b.txt", dir: false, size: 5, modified: "2026-09-01T00:00:00Z" }, { name: "mods", dir: true, size: 0, modified: null }, { name: "A.log", dir: false, size: 50, modified: "2026-09-20T00:00:00Z" }, { name: "config", dir: true, size: 0, modified: null }];
    expect(sortEntries(e, undefined, undefined).map((x) => x.name)).toEqual(["config", "mods", "A.log", "b.txt"]);
    expect(sortEntries(e, "size", "desc").map((x) => x.name)).toEqual(["config", "mods", "A.log", "b.txt"]);
    expect(sortEntries(e, "size", "asc").map((x) => x.name)).toEqual(["config", "mods", "b.txt", "A.log"]);
    expect(sortEntries(e, "modified", "desc").map((x) => x.name)).toEqual(["config", "mods", "A.log", "b.txt"]);
    expect(sortEntries(e, "name", "desc").map((x) => x.name)).toEqual(["mods", "config", "b.txt", "A.log"]);
  });
});
