import { describe, expect, it } from "vitest";
import { statusText } from "@/lib/server-status";
import { wakeLine } from "@/shared/server-state";

// docs/13 §12: how the site words the server's state and a wake.

const base = { online: [] as unknown[], sleepInMin: null as number | null, reason: null as string | null, wake: { leftS: null as number | null } };

describe("statusText", () => {
  it("words each state the planner's way, with tone", () => {
    expect(statusText({ ...base, server: "online", online: [1, 2] }, false)).toMatchObject({ line: "Online, 2 playing", tone: "good" });
    expect(statusText({ ...base, server: "online", sleepInMin: 4 }, false).line).toBe("Online, nobody on, goes to sleep in about 4 min");
    expect(statusText({ ...base, server: "asleep" }, false)).toMatchObject({ line: "Asleep, join to wake it", tone: "info" });
    expect(statusText({ ...base, server: "waking", wake: { leftS: 12 } }, false)).toMatchObject({ line: "Waking up… about 12 s", tone: "warn" });
    expect(statusText({ ...base, server: "off" }, false)).toMatchObject({ line: "Switched off", tone: "neutral", hint: "The server is switched off. Ask Alex in Discord." });
    expect(statusText({ ...base, server: "crashed" }, false)).toMatchObject({ line: "Crashed", tone: "bad" });
    expect(statusText({ ...base, server: "unreachable" }, false)).toMatchObject({ line: "Can't reach the server", tone: "bad" });
  });
  it("gives admins, and only admins, the reason AMP can't be reached", () => {
    expect(statusText({ ...base, server: "unreachable", reason: "login refused" }, true).reason).toBe("Reason: login refused.");
    expect(statusText({ ...base, server: "unreachable", reason: "login refused" }, false).reason).toBeNull();
  });
});

describe("wakeLine", () => {
  it("counts down, then says ready or that it failed", () => {
    expect(wakeLine({ phase: "waking", leftS: 30 })).toBe("Waking the server, ready in about 30 s");
    expect(wakeLine({ phase: "waking", leftS: 12 })).toBe("Waking the server, ready in about 12 s");
    expect(wakeLine({ phase: "waking", leftS: 0 })).toBe("Waking the server, nearly there");
    expect(wakeLine({ phase: "ready", leftS: null })).toBe("Server ready");
    expect(wakeLine({ phase: "failed", leftS: null })).toBe("The server didn't wake up. Try again in a minute or tell Alex");
    expect(wakeLine({ phase: "idle", leftS: null })).toBeNull();
  });
});
