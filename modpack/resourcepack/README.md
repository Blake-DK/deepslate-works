# Deepslate texture pack

Everything in this folder (except this README) is zipped into `config.zip` as
`resourcepacks/deepslate-textures.zip`. The installer unpacks it into every PC's
`resourcepacks\` folder on Play. Vanilla paths, Minecraft 1.21.1 (`pack_format` 34).

## Swap the villager skin

1. Replace `assets/minecraft/textures/entity/villager/villager.png` with the new skin
   (64×64 PNG, vanilla villager layout).
2. Commit and push to `main` (as ladm).
3. Admin → Modpack → **Lock** (shows `~ settings resourcepack`), then **Build**.
   No Sync needed: the pack is for PCs only. Players get it at their next Play.

## Why the other villager files are blank

A villager is drawn in three layers: `villager.png`, then a biome overlay (`type/`),
then a profession overlay (`profession/`, plus the level badge in `profession_level/`).
Those are all fully transparent here, so every villager shows `villager.png` and
nothing else. To bring back biome looks or profession outfits, delete the blank
files you want back; Minecraft then uses its own.

Any other vanilla texture can be overridden the same way: put it at its vanilla path
under `assets/minecraft/textures/`.

## The gas mask's icon (docs/55 M8)

`assets/minecraft/models/item/leather_helmet.json` is vanilla 1.21.1's own file (from the client jar, its ten
armour-trim overrides kept) with one override added last: `custom_model_data` 5501 shows
`assets/deepslate/models/item/gas_mask.json`. The gas mask is a leather helmet with that number, made by the recipe
`deepslate:gas_mask` in `modpack/datapacks/deepslate-moon/`. `textures/item/gas_mask.png` is tinted by the helmet's
colour (keep it light grey); `gas_mask_overlay.png` (glasses, filter) is drawn as it is. On the head it is a dark
leather cap: 1.21.1 has no worn model of its own without a mod.
