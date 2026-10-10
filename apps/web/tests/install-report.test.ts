import { describe, expect, it } from "vitest";
import { markLog, MAX_LOG_BYTES, NO_PC_MODES, PC_REPORT, redactLog, redactText, reportSchema, sanitizeReport, suggestTier, summary, truncateMiddle } from "@/lib/install-report";

describe("redaction", () => {
  it("takes the name out of paths under Users, however they are written", () => {
    expect(redactText("C:\\Users\\Jo Bloggs\\AppData\\Roaming\\.minecraft")).toBe("C:\\Users\\~\\AppData\\Roaming\\.minecraft");
    expect(redactText("gameDir=c:\\users\\alex\\AppData")).toBe("gameDir=c:\\users\\~\\AppData");
    expect(redactText('"path":"C:\\\\Users\\\\alex.b\\\\AppData\\\\x.jar"')).toBe('"path":"C:\\\\Users\\\\~\\\\AppData\\\\x.jar"');
    expect(redactText("D:/Users/Alex/Desktop/installer")).toBe("D:/Users/~/Desktop/installer");
    expect(redactText("at /home/alex/.minecraft and /Users/alex/Library")).toBe("at /home/~/.minecraft and /Users/~/Library");
    expect(redactText("C:\\Program Files\\Java\\bin\\java.exe")).toBe("C:\\Program Files\\Java\\bin\\java.exe");
  });
  it("takes out tokens, passwords and e-mail addresses", () => {
    expect(redactText("Authorization: Bearer abcDEF123_-xyz")).toBe("Authorization: Bearer ~");
    expect(redactText('{"launcherToken":"Zm9vYmFyYmF6cXV4","savedAt":"2026-09-29"}')).toBe('{"launcherToken":"~","savedAt":"2026-09-29"}');
    expect(redactText("token=abcd1234efgh; password: hunter22")).toBe("token=~; password: ~");
    expect(redactText("signed in as alex@example.com")).toBe("signed in as ~@~");
    expect(redactText("poll https://x/api/launcher/poll?t=Q2hhbmdlTWVQbGVhc2VUaGlzSXNBVG9rZW5fMTIzNDU2Nzg5MA")).toBe("poll https://x/api/launcher/poll?t=~");
  });
  it("leaves file hashes and versions alone", () => {
    const sha = "a".repeat(64) + "0123456789abcdef".repeat(4);
    expect(redactText(`sha512 ${sha}`)).toBe(`sha512 ${sha}`);
    expect(redactText("NeoForge 21.1.252, Windows 10.0.19045, driver 32.0.15.6094")).toBe("NeoForge 21.1.252, Windows 10.0.19045, driver 32.0.15.6094");
  });
  it("takes addresses out of the log", () => {
    expect(redactLog("connected from 82.10.20.30 via 192.168.1.10:25565")).toBe("connected from ~ip~ via ~ip~:25565");
    expect(redactLog("peer 2a01:4b00:1234::1 and fe80::1ff:fe23:4567:890a")).toBe("peer ~ip~ and ~ip~");
    expect(redactLog("[2026-09-29T07:26:01] STEP Signing in")).toBe("[2026-09-29T07:26:01] STEP Signing in");
    expect(redactLog("NeoForge 21.1.252 on Windows 10.0.19045")).toBe("NeoForge 21.1.252 on Windows 10.0.19045");
  });
});

describe("truncateMiddle", () => {
  it("keeps short logs whole", () => {
    expect(truncateMiddle("short", 100)).toBe("short");
  });
  it("cuts the middle and keeps both ends, within the limit, also with wide characters", () => {
    const log = `START versions here\n${"x".repeat(700_000)}\n${"é".repeat(1000)}\nFAIL the end`;
    const out = truncateMiddle(log);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(MAX_LOG_BYTES);
    expect(out.startsWith("START versions here")).toBe(true);
    expect(out.endsWith("FAIL the end")).toBe(true);
    expect(out).toContain("the middle of the log was cut");
    expect(out).not.toContain("\ufffd");
  });
});

const REPORT = {
  packVersion: "0.1.0+47b0b579", installerVersion: "1.1.0", outcome: "failed", failedStep: "Checking the Minecraft Launcher", durationSec: 12.4,
  log: "[2026-09-29T10:00:00] === Deepslate Works start ===\r\n[2026-09-29T10:00:01] STEP Signing in\r\n[2026-09-29T10:00:02] OK Signed in as Bramble09\r\n[2026-09-29T10:00:03] STEP Checking the Minecraft Launcher\r\n[2026-09-29T10:00:03] looked in C:\\Users\\player\\AppData\\Roaming\\.minecraft on ALEX-PC from 203.0.113.10\r\n[2026-09-29T10:00:03] FAIL Install the Minecraft Launcher\r\n",
  system: {
    os: { caption: "Microsoft Windows 11 Home", version: "10.0.26100", build: "26100", display: "24H2", arch: "64-bit" },
    cpu: { name: "AMD Ryzen 5 5600X 6-Core Processor", cores: 6, threads: 12 }, ramGb: 31.9,
    gpus: [{ name: "NVIDIA GeForce RTX 3070", driver: "32.0.15.6094", vramMb: 8192 }],
    disk: { drive: "C:", freeGb: 211.5, totalGb: 930 }, launcher: { version: null, kind: "not found" },
    java: { source: "path", path: "C:\\Users\\player\\scoop\\apps\\java\\bin\\java.exe", version: "openjdk version \"21.0.4\" 2024-07-16" },
    neoforge: { version: "21.1.252", before: false, after: false }, powershell: "5.1.26100.1",
    hostname: "ALEX-PC", username: "player",
  },
  extra: "dropped",
};

describe("a report on its way into the database", () => {
  it("is read, and what is not asked for is dropped", () => {
    const r = reportSchema.parse(REPORT);
    expect(r.durationSec).toBe(12);
    expect("extra" in r).toBe(false);
    expect("hostname" in r.system).toBe(false);
    expect("username" in r.system).toBe(false);
  });
  it("takes the test game's check (3.6.1), kept out of every live figure with the test Plays", async () => {
    expect(reportSchema.parse({ ...REPORT, mode: "test_game_check" }).mode).toBe("test_game_check");
    const { TEST_MODES, PLAY_MODES } = await import("@/shared/join-gate");
    expect(TEST_MODES).toEqual(["test_play", "test_game_check"]);
    for (const m of TEST_MODES) expect((PLAY_MODES as readonly string[]).includes(m)).toBe(false);
    const { describeAction } = await import("@/shared/events");
    expect(describeAction("installer.report", { role: "ADMIN", name: "Bramble09" }, { mode: "test_game_check", outcome: "ok" }, "OK")).toBe("Bramble09 started the test game with every mod of the test pack");
  });
  it("refuses what makes no sense", () => {
    expect(reportSchema.safeParse({ ...REPORT, outcome: "exploded" }).success).toBe(false);
    expect(reportSchema.safeParse({ ...REPORT, durationSec: -1 }).success).toBe(false);
    expect(reportSchema.safeParse({ ...REPORT, log: "x".repeat(MAX_LOG_BYTES * 2 + 1) }).success).toBe(false);
    expect(reportSchema.safeParse({ ...REPORT, system: { ...REPORT.system, gpus: Array.from({ length: 9 }, () => ({ name: "x" })) } }).success).toBe(false);
  });
  it("holds no user name, computer name or address when stored (docs/07 acceptance)", () => {
    const s = sanitizeReport(reportSchema.parse(REPORT), ["player", "ALEX-PC"]);
    const stored = JSON.stringify(s);
    expect(stored).not.toMatch(/player|ALEX-PC|203\.0\.113\.10/i);
    expect(s.log).toContain("C:\\Users\\~\\AppData\\Roaming\\.minecraft on ~ from ~ip~");
    expect(s.system.java?.path).toBe("C:\\Users\\~\\scoop\\apps\\java\\bin\\java.exe");
    expect(s.failedStep).toBe("Checking the Minecraft Launcher");
    expect(s.log).not.toContain("\r");
  });
  it("keeps what it is for: the versions and the hardware", () => {
    const s = sanitizeReport(reportSchema.parse(REPORT), ["player"]);
    expect(s.system.os).toEqual({ caption: "Microsoft Windows 11 Home", version: "10.0.26100", build: "26100", display: "24H2", arch: "64-bit" });
    expect(s.system.gpus).toEqual([{ name: "NVIDIA GeForce RTX 3070", driver: "32.0.15.6094", vramMb: 8192 }]);
    expect(s.system.ramGb).toBe(31.9);
    expect(s.system.java?.version).toBe('openjdk version "21.0.4" 2024-07-16');
    expect(summary(s.system)).toEqual({ os: "Windows 11 Home 24H2 (26100)", ram: "32 GB", gpu: "NVIDIA GeForce RTX 3070", cpu: "AMD Ryzen 5 5600X 6-Core Processor, 6 cores" });
  });
  it("does not blank short names, which would chew up ordinary words", () => {
    const s = sanitizeReport(reportSchema.parse({ ...REPORT, log: "installed in a folder" }), ["in", "a"]);
    expect(s.log).toBe("installed in a folder");
  });
});

describe("suggestTier", () => {
  const pc = (ramGb: number | null, ...names: string[]) => ({ ramGb, gpus: names.map((name) => ({ name })) });
  it("reads memory and graphics card", () => {
    expect(suggestTier(pc(32, "NVIDIA GeForce RTX 3070"))?.tier).toBe("HIGH");
    expect(suggestTier(pc(16, "AMD Radeon RX 6700 XT"))?.tier).toBe("HIGH");
    expect(suggestTier(pc(16, "Intel(R) Arc(TM) A750 Graphics"))?.tier).toBe("HIGH");
    expect(suggestTier(pc(16, "NVIDIA GeForce GTX 1050 Ti"))?.tier).toBe("MID");
    expect(suggestTier(pc(8, "NVIDIA GeForce RTX 3060"))?.tier).toBe("MID");
    expect(suggestTier(pc(16, "NVIDIA GeForce MX150"))?.tier).toBe("MID");
    expect(suggestTier(pc(16, "Intel(R) UHD Graphics 620"))?.tier).toBe("LOW");
    expect(suggestTier(pc(16, "AMD Radeon(TM) Graphics"))?.tier).toBe("LOW");
    expect(suggestTier(pc(4, "NVIDIA GeForce RTX 4090"))?.tier).toBe("LOW");
  });
  it("uses the real card of a laptop with two, and ignores remote-desktop adapters", () => {
    expect(suggestTier(pc(16, "Intel(R) Iris(R) Xe Graphics", "NVIDIA GeForce RTX 4060 Laptop GPU"))).toEqual({ tier: "HIGH", why: "16 GB of memory, NVIDIA GeForce RTX 4060 Laptop GPU" });
    expect(suggestTier(pc(32, "Parsec Virtual Display Adapter", "Microsoft Basic Display Adapter"))?.tier).toBe("LOW");
  });
  it("says nothing when there is nothing to go on", () => {
    expect(suggestTier(null)).toBeNull();
    expect(suggestTier({ ramGb: null, gpus: [] })).toBeNull();
    expect(summary(null)).toEqual({ os: "not known", ram: "not known", gpu: "not known", cpu: "not known" });
  });
});

describe("markLog", () => {
  it("marks the step that failed, what came after it, and the failure", () => {
    const m = markLog("[t] STEP Signing in\n[t] OK Signed in\n[t] STEP Checking the Minecraft Launcher\n[t] looked\n[t] FAIL Install it", "Checking the Minecraft Launcher");
    expect(m.map((l) => l.mark)).toEqual([null, null, "step", "after", "fail"]);
    expect(m[4]).toMatchObject({ n: 5, text: "[t] FAIL Install it" });
  });
  it("marks nothing in a run that went well", () => {
    expect(markLog("[t] STEP a\n[t] OK b", null).every((l) => l.mark === null)).toBe(true);
  });
});

describe("the tier is measured, not asked", () => {
  it("is described in the event log", async () => {
    const { describeAction, kindOf } = await import("@/shared/events");
    expect(describeAction("profile.tier.measured", { role: "PLAYER", name: "m1owl" }, { from: "HIGH", to: "LOW", why: "8 GB" })).toBe("m1owl: their PC was measured by the installer: LOW (they had chosen HIGH)");
    expect(describeAction("profile.tier.measured", { role: "PLAYER", name: "m1owl" }, { from: "MID", to: "MID" })).toBe("m1owl: their PC was measured by the installer: MID");
    expect(describeAction("installer.report", { role: "PLAYER", name: "m1owl" }, { outcome: "ok", packVersion: "0.1.0+47b0b579" }, "OK")).toBe("m1owl installed 0.1.0+47b0b579: all good");
    expect(describeAction("installer.report", { role: "PLAYER", name: "m1owl" }, { outcome: "failed", failedStep: "Checking the Minecraft Launcher" }, "FAILED")).toBe('m1owl ran the installer and it failed at "Checking the Minecraft Launcher"');
    expect(kindOf("installer.report", "PLAYER")).toBe("INSTALL");
  });
});

describe("which report says what a member's PC is (Admin → Installs, the player page)", () => {
  it("not the game check 3.6 sends after every Play, nor a log sent, an unfinished run, the uninstaller or a test run", () => {
    for (const m of ["game_check", "log_sent", "unfinished", "uninstall", "test_play", "test_game_check"]) expect(NO_PC_MODES).toContain(m);
    for (const m of ["play", "update", "first_install", "install", "handover", "update_only"]) expect(NO_PC_MODES).not.toContain(m);
    expect(PC_REPORT).toEqual({ mode: { notIn: [...NO_PC_MODES] }, minimal: false }); // nor a ping with reports off
  });
  it("a game check's PC, as it is stored, says nothing: no tier from it", () => {
    const stored = reportSchema.parse({ packVersion: "0.1.0+d44eb2ba", installerVersion: "3.6.1", mode: "game_check", outcome: "ok", durationSec: 0, log: "game check: all 71 mods loaded", system: null }).system;
    expect(suggestTier(stored)).toBeNull();
  });
});

describe("short names for a column", () => {
  it("keep what tells one processor from another", async () => {
    const { shortCpu } = await import("@/lib/install-report");
    expect(shortCpu("13th Gen Intel(R) Core(TM) i7-13700H, 14 cores")).toBe("i7-13700H, 14 cores");
    expect(shortCpu("12th Gen Intel(R) Core(TM) i9-12900K, 16 cores")).toBe("i9-12900K, 16 cores");
    expect(shortCpu("Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz, 4 cores")).toBe("i5-8250U, 4 cores");
    expect(shortCpu("AMD Ryzen 7 5800X 8-Core Processor, 8 cores")).toBe("Ryzen 7 5800X, 8 cores");
    expect(shortCpu("not known")).toBe("not known");
  });
  it("put the real graphics card first and count the rest", async () => {
    const { shortGpu } = await import("@/lib/install-report");
    expect(shortGpu("NVIDIA GeForce RTX 4070 Laptop GPU + Intel(R) Iris(R) Xe Graphics")).toBe("RTX 4070 Laptop +1");
    expect(shortGpu("Intel(R) Arc(TM) A380 Graphics + NVIDIA GeForce RTX 3080")).toBe("Arc A380 +1");
    expect(shortGpu("Intel(R) UHD Graphics 620 + NVIDIA GeForce GTX 1650")).toBe("GTX 1650 +1");
    expect(shortGpu("Intel(R) UHD Graphics 620")).toBe("UHD 620");
    expect(shortGpu("AMD Radeon RX 6700 XT")).toBe("Radeon RX 6700 XT");
    expect(shortGpu("not known")).toBe("not known");
  });
  it("leave Windows out of the Windows column", async () => {
    const { shortOs } = await import("@/lib/install-report");
    expect(shortOs("Windows 11 Home Single Language 24H2 (26100)")).toBe("11 Home SL 24H2");
    expect(shortOs("Windows 11 Pro 25H2 (26200)")).toBe("11 Pro 25H2");
    expect(shortOs("Windows 10 Home 22H2 (19045)")).toBe("10 Home 22H2");
    expect(shortOs("not known")).toBe("not known");
  });
});
