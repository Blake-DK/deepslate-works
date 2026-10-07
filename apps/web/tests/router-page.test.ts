import { describe, expect, it } from "vitest";
import { playersText, stateText, suggestedPort } from "@/lib/router";

// Admin → Server → Router: how the dashboard's words read on the page.

describe("router page", () => {
  it("names the three probe states and anything else as unknown", () => {
    expect(stateText("online")).toEqual({ text: "Up", tone: "good" });
    expect(stateText("listening")).toEqual({ text: "Port open, not answering yet", tone: "warn" });
    expect(stateText("down")).toEqual({ text: "Down", tone: "bad" });
    expect(stateText(null).text).toBe("Unknown");
    expect(stateText("sleeping").tone).toBe("neutral");
  });
  it("players only when the server said", () => {
    expect(playersText({ online: 3, max: 20 })).toBe("3 / 20 playing");
    expect(playersText({ online: 0, max: null })).toBe("0 playing");
    expect(playersText({ online: null, max: 20 })).toBeNull();
  });
  it("suggests the first free port, or none", () => {
    expect(suggestedPort({ freePorts: [25573, 25575] })).toBe(25573);
    expect(suggestedPort({ freePorts: [] })).toBeUndefined();
  });
});
