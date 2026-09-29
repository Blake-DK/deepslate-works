import type { ConsoleTail } from "../amp/console.js";
import type { MapLine } from "../events/parse.js";

// Where BlueMap's render stands, from its own answers to `bluemap` and `bluemap maps` (the patterns are in
// events/parse.ts). The portal asks while the "render the map" step of the pre-generation is on
// (status/pregen.ts); an answer somebody else asked for on the console is read all the same.

/** The map of the overworld, as BlueMap names it (the folder of the world). */
export const OVERWORLD_MAP = "world";
/** All the maps of the server: what "delete the map" deletes. */
export const ALL_MAPS = ["world", "world_the_nether", "world_the_end"];

export type MapInfo = { status: "updated" | "rendering" | "purging" | "pending" | "frozen"; percent: number | null; pending: number };

export type MapState = {
  threads: "running" | "idle" | "stopped" | "paused" | null;
  /** The map of the task in hand, how far that task is, and BlueMap's own estimate. */
  current: string | null;
  percent: number | null;
  remaining: string | null;
  maps: Record<string, MapInfo>;
  /** When BlueMap last gave its status, and when it last listed its maps. */
  statusAt: string | null;
  listAt: string | null;
  /** When BlueMap last said that it was still loading: what it was asked then, it has not done. */
  loadingAt: string | null;
  /** How many lists have been read. */
  lists: number;
  /** Which answer the next lines belong to, and which map. */
  block: "status" | "maps" | null;
  cursor: string | null;
};

export const NO_MAP: MapState = { threads: null, current: null, percent: null, remaining: null, maps: {}, statusAt: null, listAt: null, loadingAt: null, lists: 0, block: null, cursor: null };

/** Pure: the state after one more line of BlueMap's. */
export function nextMap(s: MapState, l: MapLine, at: Date): MapState {
  const when = at.toISOString();
  switch (l.what) {
    case "status":
      return { ...s, threads: null, current: null, percent: null, remaining: null, statusAt: when, block: "status", cursor: null };
    case "maps":
      return { ...s, maps: {}, listAt: when, lists: s.lists + 1, block: "maps", cursor: null };
    case "threads":
      return { ...s, threads: l.state };
    case "said":
      return { ...s, threads: l.threads };
    case "current":
      return { ...s, current: l.map, block: "status" };
    case "progress":
      return s.block === "status" ? { ...s, percent: l.percent } : s;
    case "remaining":
      return s.block === "status" ? { ...s, remaining: l.text } : s;
    case "map":
      return s.block === "maps" ? { ...s, cursor: l.map, maps: { ...s.maps, [l.map]: { status: l.icon, percent: null, pending: 0 } } } : s;
    case "rendering":
    case "pending":
    case "frozen": {
      const was = s.block === "maps" && s.cursor ? s.maps[s.cursor] : undefined;
      if (!was || !s.cursor) return s;
      const now: MapInfo = l.what === "rendering" ? { ...was, status: l.purge ? "purging" : "rendering", percent: l.percent } : l.what === "pending" ? { ...was, status: was.status === "rendering" || was.status === "purging" ? was.status : "pending", pending: l.tasks } : { ...was, status: was.status === "updated" ? "frozen" : was.status };
      return { ...s, maps: { ...s.maps, [s.cursor]: now } };
    }
    case "loading":
      return { ...s, loadingAt: when, block: null, cursor: null };
    case "other":
      return s;
  }
}

/**
 * Pure: has BlueMap said that this map is rendered? Its list must name the map as updated, with nothing in hand
 * and nothing waiting, and its status must not have the map's task in hand or the render threads stopped.
 */
export function rendered(s: MapState, map: string): boolean {
  const m = s.maps[map];
  if (!m || m.status !== "updated" || m.pending > 0) return false;
  if (s.threads === "stopped" || s.threads === "paused") return false;
  return s.current !== map;
}

export class MapWatch {
  state: MapState = NO_MAP;

  constructor(tail: ConsoleTail, private readonly now: () => number = () => Date.now()) {
    tail.on((e, info) => {
      if (e.type === "map" && !info.replay) this.state = nextMap(this.state, e.line, new Date(this.now()));
      // another server, another BlueMap: what the last one said is history
      if (e.type === "started" && !info.replay) this.state = { ...NO_MAP, lists: this.state.lists };
    });
  }
}
