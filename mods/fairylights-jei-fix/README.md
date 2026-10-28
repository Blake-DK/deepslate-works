# Fairy Lights 1.2.3, JEI tooltip crash fixed (patched jar)

Fairy Lights 1.2.3 (`fairy-lights-fabric` on Modrinth, the lucalabs-de port, MIT) crashes the game when the mouse is
over a slot of the hanging lights or pennant bunting recipe in JEI (2026-10-27, a player's crash report):

```
java.lang.NullPointerException: Cannot invoke "de.lucalabs.fairylights.main.items.crafting.GenericIngredient.getTooltip()" because "ingredient" is null
	at de.lucalabs.fairylights.integrations.jei.GenericRecipeExtension.lambda$setRecipe$1(GenericRecipeExtension.java:47)
	at mezz.jei.library.gui.ingredients.RecipeSlot.addTooltip(RecipeSlot.java:175)
```

`GenericRecipeExtension.setRecipe` gives each of the nine slots a tooltip callback that calls `getTooltip()` on the
slot's ingredient, and an empty slot has none. Reported upstream as lucalabs-de/FairyLightsFabric#32.

**The patch** (`Patch.java`, ASM): `if (ingredient == null) return;` in front of that callback's body, and the version
in `neoforge.mods.toml` from `1.2.3` to `1.2.3-dsw.1`, so the app and the logs show which jar runs. Every other entry
of the jar is copied unchanged (the same 614 names in the same order, the same dates). It is the same mod, so lights
already placed in the world stay as they are.

**Build:** `mods/fairylights-jei-fix/build.sh` (Docker, memory-capped, no network inside; the JDK image pinned by
digest, the Fairy Lights jar and ASM pinned by sha512; prints the jar's sha512, the same on every run). It ships the
way docs/58 ships a jar that is not on Modrinth: the file in `data/private-jars/` on the stack, pinned by sha512 in
`mods.json`.

**Back to Modrinth** the day a version after 1.2.3 fixes it: drop `source` from the entry, pin that version, Lock.

Licence: Fairy Lights is MIT (`LICENSE`, copied from the mod's repository); the patch is MIT too.
