package deepslateworks.quarrypause.mixin;

import com.yogpc.qp.machine.MachineStorage;
import com.yogpc.qp.machine.quarry.QuarryEntity;
import deepslateworks.quarrypause.QuarryPause;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** The quarry's dig step is skipped while its storage holds what it could not pass on. */
@Mixin(value = QuarryEntity.class, remap = false)
public abstract class QuarryEntityMixin {
    @Shadow(remap = false)
    MachineStorage storage;

    @Inject(method = "serverTick", at = @At("HEAD"), cancellable = true, remap = false)
    private static void dsw$pauseWhenFull(Level level, BlockPos pos, BlockState state, QuarryEntity quarry, CallbackInfo ci) {
        if (QuarryPause.blocked(((QuarryEntityMixin) (Object) quarry).storage)) ci.cancel();
    }
}
