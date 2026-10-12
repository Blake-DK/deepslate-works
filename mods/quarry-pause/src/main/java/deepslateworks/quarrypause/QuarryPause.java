package deepslateworks.quarrypause;

import com.yogpc.qp.machine.MachineStorage;
import net.neoforged.fml.common.Mod;

/**
 * docs/56 §3: a quarry (Additional Enchanted Miner) whose output can go nowhere stops digging, and starts again by
 * itself when there is room. The quarry keeps what it digs in an internal storage and pushes it into the blocks next to
 * it after every dig; whatever is still in that storage at the start of its next turn had nowhere to go. While anything
 * is left there, the mixins skip the quarry's dig step, so it breaks nothing and uses no power. The push still runs
 * every tick, so the quarry carries on by itself once a chest is emptied or a pipe frees up.
 *
 * At most the drops of the last block wait in the storage. They are not dropped when the quarry is broken: a mod that
 * moves blocks (a Create contraption) removes the block after copying its data, and dropping then would duplicate them.
 *
 * Server only: nothing here is sent to players, and their game does not need this mod.
 */
@Mod(QuarryPause.ID)
public final class QuarryPause {
    public static final String ID = "dsw_quarry_pause";

    /** True when the storage still holds items that could not be passed on. */
    public static boolean blocked(MachineStorage storage) {
        return storage != null && !storage.itemKeyCounts().isEmpty();
    }
}
