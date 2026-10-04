import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/29 §4: the live stream sends `raw` and `meta` only for an admin who asked for scope=admin.

const state = vi.hoisted(() => ({ user: null as null | { pcTier: string; role: "ADMIN" | "PLAYER" }, admins: [] as boolean[] }));
vi.mock("@/server/auth/session", () => ({ loadCurrentUser: async () => state.user }));
vi.mock("@/server/event-log", () => ({
  eventsAfter: async (_after: bigint, _f: unknown, admin: boolean) => {
    state.admins.push(admin);
    // what event-log hands back: raw and meta already empty for a non-admin; the route must not add them anyway
    return [{ id: "7", at: new Date("2026-10-04T10:00:00Z"), kind: "DEATH", actor: "uuid-1", message: "samoyedx fell", count: 1, who: { name: "Rowan", mcUuid: "uuid-1", mcName: "samoyedx" }, raw: admin ? "[10:00] samoyedx fell" : null, meta: admin ? { name: "samoyedx" } : null }];
  },
}));

const { GET } = await import("@/app/api/events/stream/route");

async function firstRow(url: string): Promise<Record<string, unknown>> {
  const ac = new AbortController();
  const res = await GET(new Request(url, { signal: ac.signal }));
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("data: ") || !text.slice(text.indexOf("data: ")).includes("\n\n")) text += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  await reader.cancel();
  const line = text.split("\n").find((l) => l.startsWith("data: "))!;
  return JSON.parse(line.slice(6)) as Record<string, unknown>;
}

describe("the live stream", () => {
  beforeEach(() => {
    state.admins = [];
  });
  it("sends raw and meta to an admin with scope=admin", async () => {
    state.user = { pcTier: "MID", role: "ADMIN" };
    const row = await firstRow("http://x/api/events/stream?after=1&scope=admin");
    expect(row).toMatchObject({ id: "7", kind: "DEATH", message: "samoyedx fell", raw: "[10:00] samoyedx fell", meta: { name: "samoyedx" }, who: { mcName: "samoyedx" } });
    expect(state.admins).toEqual([true]);
  });
  it("sends neither to an admin without scope=admin, nor to a player who asks for it", async () => {
    state.user = { pcTier: "MID", role: "ADMIN" };
    const asAdmin = await firstRow("http://x/api/events/stream?after=1");
    state.user = { pcTier: "MID", role: "PLAYER" };
    const asPlayer = await firstRow("http://x/api/events/stream?after=1&scope=admin");
    for (const row of [asAdmin, asPlayer]) {
      expect(row).not.toHaveProperty("raw");
      expect(row).not.toHaveProperty("meta");
      expect(row).not.toHaveProperty("actor");
      expect(row).toMatchObject({ id: "7", message: "samoyedx fell" });
    }
    expect(state.admins).toEqual([false, false]);
  });
  it("refuses anyone not signed in", async () => {
    state.user = null;
    expect((await GET(new Request("http://x/api/events/stream"))).status).toBe(401);
  });
});
