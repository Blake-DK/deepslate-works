import type { FeedEvent } from "../../src/discord/lines.js";

// docs/21 §11: every line against a real Event row, as read from the database (2026-10-02, `raw` left out).
const row = (r: { id: number; at: string; kind: string; actor: string | null; message: string; meta: unknown }): FeedEvent => ({ ...r, id: BigInt(r.id), at: new Date(`${r.at}Z`) });
export const REAL = {
  join: row({ id: 3601, at: "2026-10-01T17:37:45.548", kind: "JOIN", actor: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10", message: "bramble09 joined", meta: { name: "bramble09" } }),
  leave: row({ id: 3650, at: "2026-10-01T18:07:49.56", kind: "LEAVE", actor: "c50f3e2a-7d41-4b8e-9a63-2e1d4f6b8c10", message: "bramble09 left after 30 min", meta: { name: "bramble09", reason: "Disconnected", minutes: 30 } }),
  death: row({ id: 3636, at: "2026-10-01T17:57:31.434", kind: "DEATH", actor: "3d8a51f0-6c2e-4b97-a1d4-58f9c0e2b7a6", message: "KaneFinch was slain by Vindicator", meta: { name: "KaneFinch" } }),
  advancement: row({ id: 3617, at: "2026-10-01T17:49:24.592", kind: "ADVANCEMENT", actor: "3d8a51f0-6c2e-4b97-a1d4-58f9c0e2b7a6", message: "KaneFinch has made the advancement [Monster Hunter]", meta: { how: "advancement", name: "KaneFinch", title: "Monster Hunter" } }),
  start: row({ id: 3857, at: "2026-10-02T18:36:04.968", kind: "SERVER_START", actor: null, message: "Server online (started in 1.0 s)", meta: { seconds: 1.039 } }),
  asleep: row({ id: 3941, at: "2026-10-02T18:41:01.204", kind: "SERVER_STOP", actor: null, message: "Server asleep (nobody on)", meta: { state: "PreparingForSleep", stopLine: true } }),
  crash: row({ id: 127, at: "2026-09-29T11:14:07.759", kind: "CRASH", actor: null, message: "The server went down without shutting down first", meta: { state: "Stopping" } }),
  restart: row({ id: 3663, at: "2026-10-01T18:35:57.971", kind: "ADMIN_ACTION", actor: "cmulnt3pv0000qy2hb9ci1pht", message: "The planned restart went ahead", meta: { action: "server.restart", detail: null, params: { minutes: 1, scheduled: true }, result: "OK" } }),
  stop: row({ id: 255, at: "2026-09-29T16:48:41.323", kind: "ADMIN_ACTION", actor: null, message: "System stopped the server", meta: { action: "server.stop", detail: "[caller vps-session not a user]", params: {}, result: "OK" } }),
  held: row({ id: 3592, at: "2026-10-01T17:32:40.901", kind: "LINK", actor: null, message: "KaneFinch is waiting in the entrance room", meta: { action: "limbo.held", detail: null, params: { name: "KaneFinch", uuid: "3d8a51f0-6c2e-4b97-a1d4-58f9c0e2b7a6", reason: "unknown uuid" }, result: "OK" } }),
  bind: row({ id: 3596, at: "2026-10-01T17:33:09.656", kind: "LINK", actor: "cmums15nd0002oy2he53ih2hp", message: "kanefinch linked their Minecraft account KaneFinch", meta: { action: "link.bind", detail: null, params: { via: "link", code: "YD3NKA", mcUuid: "3d8a51f0-6c2e-4b97-a1d4-58f9c0e2b7a6", mcUsername: "KaneFinch" }, result: "OK" } }),
  sync: row({ id: 27, at: "2026-09-29T03:41:53.931", kind: "SYNC", actor: null, message: "Someone: modpack.sync", meta: { from: "AuditLog", action: "modpack.sync", detail: null, params: {}, result: "OK" } }),
  news: row({ id: 2521, at: "2026-09-30T04:20:00.967", kind: "ADMIN_ACTION", actor: null, message: "System posted an announcement", meta: { action: "announcement.create", detail: "[posted from the VPS on Alex's word]", params: { say: false, about: "map cache", length: 106, pinned: true }, result: "OK" } }),
  siteSettings: row({ id: 24, at: "2026-09-28T21:21:16.823", kind: "ADMIN_ACTION", actor: "cmulnt3pv0000qy2hb9ci1pht", message: "Bramble09: site.settings", meta: { from: "AuditLog", action: "site.settings", detail: null, params: { live: false, launchAt: "2026-10-06T17:20:00.000Z" }, result: "OK" } }),
  voteOpen: row({ id: 7, at: "2026-09-28T20:22:00.857", kind: "ADMIN_ACTION", actor: "cmulnt3pv0000qy2hb9ci1pht", message: "Bramble09: vote.open", meta: { from: "AuditLog", action: "vote.open", detail: null, params: { voteId: "smoke-vote" }, result: "OK" } }),
};

