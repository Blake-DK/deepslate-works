import { describe, expect, it } from "vitest";
import { actionOf, mb, viaOf } from "@/lib/download-log";
import { describeAction, EVENT_KINDS, KIND_LABEL, kindOf, PLAYER_KINDS, SEVERITY } from "@/shared/events";

const kane = { name: "KaneFinch", role: "PLAYER" } as const;
const alex = { name: "Bramble09", role: "ADMIN" } as const;
const nobody = { name: null, role: null } as const;

describe("the download log", () => {
  it("is a kind of its own, for admins only", () => {
    expect(EVENT_KINDS).toContain("DOWNLOAD");
    expect(KIND_LABEL.DOWNLOAD).toBe("Download");
    expect(SEVERITY.DOWNLOAD).toBe("player");
    expect(PLAYER_KINDS).not.toContain("DOWNLOAD");
    for (const a of ["download.file", "download.file.key", "download.modlist", "download.modlist.key", "files.download"]) expect(kindOf(a, "PLAYER")).toBe("DOWNLOAD");
    expect(kindOf("files.download", "ADMIN")).toBe("DOWNLOAD");
    expect(kindOf("installer.report", "PLAYER")).toBe("INSTALL");
    expect(kindOf("downloads", "PLAYER")).toBe("PLAYER_ACTION");
  });
  it("knows how something was fetched", () => {
    expect(viaOf(false, false)).toBe("site");
    expect(viaOf(true, false)).toBe("installer");
    expect(viaOf(true, true)).toBe("key");
    expect(actionOf("file", "site")).toBe("download.file");
    expect(actionOf("file", "key")).toBe("download.file.key");
    expect(actionOf("modlist", "installer")).toBe("download.modlist");
    expect([mb(900), mb(21518), mb(5_400_000)]).toEqual(["1 KB", "21 KB", "5.1 MB"]);
  });
  it("says who downloaded what, how large, and which version", () => {
    expect(describeAction("download.file", kane, { file: "installer.zip", via: "site", size: 21518, version: "1.4.1" }, "OK")).toBe("KaneFinch downloaded the installer 1.4.1 (21 KB)");
    expect(describeAction("download.file", kane, { file: "installer.zip", via: "installer", size: 21518, version: "1.4.1" }, "OK")).toBe("KaneFinch downloaded the installer 1.4.1 (21 KB), from the installer");
    expect(describeAction("download.file", alex, { file: "config.zip", via: "installer", size: 3568, version: "0.1.0+b5d461ea" }, "OK")).toBe("Bramble09 downloaded the pack's settings (3 KB, pack 0.1.0+b5d461ea), from the installer");
    expect(describeAction("download.modlist", kane, { file: "mod list", via: "installer", version: "0.1.0+b5d461ea", files: 29 }, "OK")).toBe("KaneFinch fetched the mod list (pack 0.1.0+b5d461ea, 29 mods for a PC), from the installer");
  });
  it("says who was refused, and why, once", () => {
    expect(describeAction("download.file", kane, { file: "installer.zip", via: "site", refused: "not_live" }, "DENIED")).toBe("KaneFinch was refused the installer: the site is not open yet and they have no early access");
    expect(describeAction("download.modlist", kane, { file: "mod list", via: "installer", refused: "server_offline" }, "DENIED")).toBe("KaneFinch was refused the mod list, from the installer: downloads are open while the server is up");
  });
  it("with the pack's key there is nobody to name", () => {
    expect(describeAction("download.file.key", nobody, { file: "config.zip", via: "key", size: 3568, version: "0.1.0+b5d461ea" }, "OK")).toBe("The pack's settings (3 KB, pack 0.1.0+b5d461ea) was downloaded with the pack's key");
    expect(describeAction("download.modlist.key", nobody, { file: "mod list", via: "key", version: "0.1.0+b5d461ea", files: 29 }, "OK")).toBe("The mod list (pack 0.1.0+b5d461ea, 29 mods for a PC) was fetched with the pack's key");
  });
  it("a file an admin takes from the server reads as before", () => {
    expect(describeAction("files.download", alex, { path: "logs/latest.log" }, "OK")).toBe("Bramble09 downloaded logs/latest.log from the server");
  });
});
