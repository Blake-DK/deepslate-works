import { db } from "../db.js";
import type { SnapshotStore } from "./poller.js";

export const prismaSnapshotStore: SnapshotStore = {
  async save(s) {
    await db.serverSnapshot.create({ data: { at: s.at, state: s.state, players: s.players, tps: s.tps, cpu: s.cpu, memMb: s.memMb === null ? null : Math.round(s.memMb), ...(s.pings ? { pings: s.pings } : {}) } });
  },
  async prune(now, maxAgeDays, thinAfterHours) {
    const tooOld = new Date(now.getTime() - maxAgeDays * 86_400_000);
    const thinBefore = new Date(now.getTime() - thinAfterHours * 3_600_000);
    const { count: deleted } = await db.serverSnapshot.deleteMany({ where: { at: { lt: tooOld } } });
    // Keep the first row of every five-minute bucket, plus any row where the state or the player list changed.
    const thinned = await db.$executeRaw`
      DELETE FROM "ServerSnapshot" s USING (
        SELECT id,
               row_number() OVER (PARTITION BY floor(extract(epoch FROM at) / 300) ORDER BY at) AS rn,
               lag(state) OVER (ORDER BY at) AS prev_state,
               lag(players) OVER (ORDER BY at) AS prev_players,
               state, players
        FROM "ServerSnapshot" WHERE at < ${thinBefore}
      ) d
      WHERE s.id = d.id AND d.rn > 1 AND d.state = d.prev_state AND d.players = d.prev_players`;
    return { deleted, thinned: Number(thinned) };
  },
};
