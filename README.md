# Lumencraft

A Minecraft-style voxel sandbox that runs in the browser, with a rendering pipeline modelled on the popular "realistic" shader packs: physically based sky, soft sun shadows, volumetric clouds, god rays, reflective water, bloom and filmic tone mapping.

It is plain WebGL 2 and JavaScript with no runtime dependencies. Terrain, textures and sounds are all generated procedurally, so the repository ships no image or audio assets.

The interface is in English and Simplified Chinese; switch on the title screen or in **Settings → General**. 中文说明见 [README.zh-CN.md](README.zh-CN.md).

## Play

```bash
npm install      # only needed for the bundler used by `npm run build`
npm run dev      # http://localhost:8080
```

`npm run dev` needs no install: it's a small Node static server. Any static server works too (for example `python3 -m http.server`), because the source runs as native ES modules.

To get a single self-contained file:

```bash
npm run build    # writes dist/index.html (about 1 MB)
```

`dist/index.html` runs straight from disk (double-click it) or from any static host. Served over HTTP(S) it is also an installable web app (manifest and icons are copied next to it), so phones and tablets can add it to the home screen and run it full screen.

`npm test` runs the Node test suite, which covers terrain determinism, lighting, meshing, raycasting, saving, weather, flowing liquids, shaped blocks, furnaces and chests, hunger, experience, enchanting, brewing, loot, trading, rails, elytra flight, structures, the multiplayer server and the translations, without a browser.

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk |
| Mouse | Look |
| `Space` | Jump, swim up, fly up; with elytra on, press it again in the air to glide |
| `Space` twice or `F` | Toggle flying |
| `Shift` | Sneak (won't walk off edges), fly down |
| `W` twice or `R` | Sprint |
| Left click (hold) | Break blocks |
| Right click | Place the selected block; open doors, gates, chests, furnaces, brewing stands and enchanting tables; eat and drink (hold); use buckets, bows, crossbows, fishing rods, fireworks and spawn eggs; trade, tame, breed, shear, milk, saddle and ride; hold up a shield in the other hand |
| Middle click | Pick the block you're looking at |
| `1`–`9`, mouse wheel | Choose hotbar slot |
| `Q` (`Ctrl`+`Q`: the stack) | Drop the held item |
| `X` | Swap what is in your hands (the other hand holds a shield, a totem, a torch...) |
| `F5` or `C` | First person, third person from behind, from the front (also in the pause menu, the touch camera button and the controller's D-pad left) |
| `Enter` (looking at a villager) | Talk to it |
| `Shift` (riding) | Get off |
| `E` | Open all blocks (E again, Esc or the × at its top right closes it; the × is the way out on phones and tablets) |
| `T` (hold) | Fast-forward the time of day |
| `F3` or `` ` `` | Debug overlay |
| `H` | Hide the interface |
| `Esc` | Pause |

Touch screens get a floating stick (push to the edge to sprint), drag-to-look, tap to place and hold to break, buttons for jump, sneak, fly, break, place, blocks, pause and full screen, and a tappable hotbar. Button size, opacity, look speed and haptics are in **Settings → Controls**.

### Controllers and TV remotes

Any controller the browser reports with the standard mapping works (Xbox, PlayStation, Switch Pro and most Android pads):

| Button | Action |
| --- | --- |
| Left stick | Move (click: sprint) |
| Right stick | Look (click: pick block) |
| A | Jump, twice to fly |
| B | Sneak, fly down |
| X | Toggle flying |
| Y | Open all blocks |
| RT / LT | Break / place |
| LB / RB | Previous / next hotbar slot |
| D-pad up / down | Fast-forward time / hide the interface |
| View / Menu | Debug overlay / pause |

Menus follow the D-pad or stick (A chooses, B goes back, LB / RB switch settings tabs), and a TV remote's arrows, OK and Back keys do the same. Rumble is used for breaking and placing and can be turned off. **Device check** on the title screen lists what the browser supports (WebGL 2, float render targets, controllers, GPU) for troubleshooting.

Your world (seed, position, time of day, hotbar and every block you change) is saved in the browser's IndexedDB. Use **New world** on the title screen to start over, optionally with a seed.

## Survival and creatures

New worlds start in **survival** (choose creative or a difficulty when you create one, or switch any time under Settings → World).

- **Health and air**: ten hearts; falling, drowning, lava, fire, cacti and monsters hurt you. Health comes back slowly, faster by eating (right-click / LT / tap while holding food).
- **Monsters come out in the dark**: zombies (burn in sunlight), creepers (hiss, then explode), skeletons (keep their distance and shoot), spiders (climb walls, leap). They find their way to you with A* path finding. Peaceful difficulty has none.
- **Animals** graze on grass in daylight: cows, pigs, sheep (in several wool colours) and chickens. They drop food and materials.
- **Mining and tools**: hold to break; cracks show progress. Stone and ores need a pickaxe to drop anything; the right tool (pickaxe, axe, shovel) is faster. Tools and weapons wear out. Swords, pickaxes, axes, shovels and hoes come in wood, stone, iron, gold (fast but fragile), diamond and netherite (diamond gear plus a netherite ingot, from ancient debris deep in the Nether).
- **Armour**: leather, chainmail, iron, gold, diamond and netherite helmets, chestplates, leggings and boots. Worn armour (shown above the hearts, and on your model for other players) soaks up damage from monsters, arrows, fire and explosions, and wears down as it does.
- **Combat**: swords hit harder, jumping hits are critical, hits knock creatures back. The bow charges while held and needs arrows.
- **Inventory**: a 36-slot bag, the 9-slot hotbar and 4 armour slots. Click a stack to pick it up (right click: half), click or drag it anywhere to put it down (right click: one), shift-click to send it between bag and hotbar or onto your body, 1–9 over a slot to swap it with the hotbar. Creative mode adds the full palette with category tabs, search and a bin.
- **Crafting**: every recipe you can make with what you carry is listed; tap one to craft it (tools and armour of every material, beds, bows and arrows, flint and steel, eyes of ender, bread, chests, furnaces, doors, fences, stairs, slabs, buckets...).
- **Chests and furnaces**: a chest holds 27 stacks that stay in the world (shift-click moves stacks across). A furnace smelts and cooks: raw iron and raw gold (what those ores drop now) into ingots, sand into glass, cobblestone into stone, clay into bricks, logs into charcoal, meat into food. It burns coal, charcoal, wood or a bucket of lava, keeps cooking while you are away, and glows while lit.
- **Building blocks**: slabs and stairs in ten materials (walked up without jumping; two slabs make a full block), doors that open (and pair up into double doors), fences that join up and are too tall to jump over, fence gates, trapdoors, ladders to climb, glass panes, iron bars, and signs you can write on (in any language).
- **Water and lava flow**: liquids spread from their source (water seven blocks, lava three, or seven in the Nether), fall down holes and dry up when the source goes. Water between two sources becomes a source itself; lava meeting water hardens into obsidian or cobblestone. Buckets pick liquids up and pour them out; milk a cow with one.
- **Trees grow back**: leaves sometimes drop saplings; planted on grass or dirt they grow into oaks, birches and spruces. Bone meal (from bones) speeds up saplings and crops and makes flowers sprout.
- **Dropped items** (thrown with `Q` or out of the inventory, spilled on death, broken from blocks) lie on the ground until someone walks up to them; in multiplayer everyone sees them and whoever gets there first picks them up.
- **Farming**: till grass or dirt with a hoe, plant wheat seeds (from tall grass), and harvest the ripe wheat for bread. Crops grow on the world clock, so all players see the same field.
- **Beds** in all 16 colours: sleep through the night (in multiplayer once everyone in the overworld is in bed) and respawn beside your bed. They explode in the Nether and the End.
- **The Nether**: build a 4 × 5 obsidian frame and light it with flint and steel. Netherrack caverns over a lava sea, glowstone, quartz, soul sand, ancient debris, and nether brick fortresses; zombified piglins (they fight back if you hit one), ghasts (fireballs) and blazes (blaze rods). Each block there is 8 in the overworld.
- **The End**: eyes of ender (ender pearl + blaze powder) fly towards the nearest stronghold; fill its portal room's 12 frames and jump in. On the End's island ten obsidian pillars hold end crystals that heal the Ender Dragon; destroy them, defeat the dragon (boss bar at the top) and the exit portal home opens, with the dragon egg. Endermen drop ender pearls, which you can throw to teleport.
- **Dying** drops everything you carried where you fell; you respawn at your bed (if it's still there) or the world spawn.
- **Several worlds**: the title screen's world list keeps as many single-player worlds as you like, each with its own name, mode, buildings, inventory and time; open, rename or delete them there.
- **Hunger**: ten drumsticks beside the hearts. Running, jumping, swimming, fighting and healing use them up; eating takes a moment (hold the use button) and each food fills them by its own amount (and saturation). Full, you heal quickly; empty, you starve. Rotten flesh, raw chicken and pufferfish can make you ill.
- **Experience and enchanting**: creatures, ores, smelting, trading, breeding and fishing leave green orbs; levels show above the hotbar. An enchanting table (book, diamonds, obsidian) with up to 15 bookshelves around it offers three enchantments for levels and lapis lazuli: sharpness, smite, looting, efficiency, fortune, silk touch, unbreaking, protection, feather falling, power, flame, infinity, quick charge, multishot, piercing, lure, luck of the sea... Mending (on some villagers' wares) repairs what you hold and wear with the experience you pick up.
- **Potions**: a brewing stand fuelled with blaze powder turns water bottles into potions: nether wart makes an Awkward Potion, then glistering melon, ghast tear, blaze powder, sugar, magma cream, golden carrot, pufferfish, spider eye, phantom membrane or a slime ball give healing, regeneration, strength, swiftness, fire resistance, night vision, water breathing, poison, slow falling or leaping; fermented spider eye turns them to harming, weakness, slowness or invisibility, and gunpowder makes them splash. Effects show at the top right; milk clears them.
- **Shield, crossbow, fishing rod, totem**: a shield in the other hand blocks what comes from the front (an axe knocks it aside). The crossbow loads while held and fires an arrow (or three with multishot, or a firework from the other hand). The fishing rod catches fish, now and then treasure or junk, and can hook a creature to pull it in. A totem of undying in either hand saves you from death once.
- **Villages**: houses, farms, a well, a smithy and lamp posts on dirt paths, in plains, desert, savanna, taiga and snowy styles. Villagers have jobs (farmer, fisherman, shepherd, fletcher, librarian, cartographer, cleric, armorer, weaponsmith, toolsmith, butcher, leatherworker, mason) and trade for emeralds; they restock every morning and go home at night. **Iron golems** guard them (and are built from a T of iron blocks and a pumpkin).
- **Villagers that talk**: right click (or tap) a villager to talk. Each is somebody: a name, a character, a quirk and a voice that follow from who it is, the same for every player. They remember each player (what was said, presents, tasks done, a punch), pass on the village's gossip (who went to the Nether, who fell into lava, who slew the dragon), set tasks with a reward (the task card shows what you have; hand it in from the talk screen), give friends small presents, can be talked into a discount on their trades and into following you. Their words appear over their heads and are spoken in the device's own voice (quieter with distance; a setting turns it off), and you can type, pick a ready-made line or speak (where the browser can). The answers come from the server's language model (the user's ATRIA model by default; any OpenAI-compatible endpoint) whose key never leaves the server; without one, or when it is busy or slow, a scripted mind answers instead. On a server everyone near a villager hears it, and its memories are kept with the world; in single player they are kept in the save. Whatever a model says a villager does is checked (no stacks of diamonds), and requests are rationed. Sneak and right click to trade straight away.
- **Pets and farm animals**: wolves (tamed with bones) follow you, fight for you and sit when told; cats (raw fish) scare creepers away. Two animals fed their food (wheat, carrots, seeds) have a baby that grows up. Shear sheep for wool (it grows back), milk cows with a bucket. Cod, salmon, tropical fish, pufferfish and squid swim in the water.
- **New monsters**: witches (throw potions, drink their own), slimes (split when killed; in swamps and slime chunks), phantoms (swoop down on players who haven't slept for three nights), pillager patrols and outposts, vindicators, evokers (fangs from the ground) in woodland mansions, guardians and an elder guardian in ocean monuments, shulkers in end cities, cave spiders by mineshaft spawners, wither skeletons, and the **Wither** (three wither skeleton skulls on a T of soul sand).
- **Getting about**: boats on water; minecarts on rails that curve and slope as they are laid (powered rails speed carts up); horses (ride one until it stops throwing you, then saddle it); and **elytra** (worn in the chest slot, or put on by using them from the hand): jump, then press jump again in the air to glide (straight after the jump, as since Java 1.15; in creative that second press spreads them rather than toggling flight), the view widening with speed and the air rushing past. Use a firework rocket in flight for a burst along the way you look (to about 34 blocks a second, as in Minecraft), with colour-cycling sparks streaming off both wings and the rocket's fire between them. A rocket used with the elytra on but not spread (jumping, falling, flying, or standing and looking at the sky rather than at a block) spreads them and takes you with it.
- **Pressure plates** open the doors, gates and trapdoors beside them while a player, creature or item is on them (stone plates only for players and creatures), and close them again when it steps off; iron doors only open this way. TNT lit with flint and steel (or under a plate) blows up after a moment.
- **Structures** in the new world: villages, desert temples (with their TNT trap), abandoned mineshafts (rails, cobwebs, cave spider spawners), dungeons (a monster spawner and loot), witch huts, pillager outposts, ocean monuments, woodland mansions and end cities with their ships (elytra aboard, beyond the End's outer gateways after the dragon). Their chests hold loot rolled when first opened.

The creature simulation (`src/sim/`) runs at 20 ticks per second with no DOM or WebGL, so the multiplayer server can run the same code.

## Multiplayer and voice chat

Run `node server/server.mjs` on a server (Node 18+, no packages) and friends open its address in a browser to share one world. The Chinese deployment guide in [server/README.zh-CN.md](server/README.zh-CN.md) covers systemd, https with Caddy and a TURN relay (coturn) for voice.

- **Shared world**: block edits in all three dimensions, the End's dragon fight, chests, furnaces, signs and the time of day are kept on the server (`server/data/world.json`, or `DATA_DIR`); each player's inventory, armour, health, dimension and position are saved by name. Everyone sees what the others hold and wear.
- **Shared things**: dropped items are seen by everyone and go to whoever reaches them first. A chest or furnace is open to one player at a time (others are told who is using it); furnaces keep cooking on the server; breaking a chest spills what it held for everyone.
- **Creatures** live on the machine of the player they spawned near and are sent to nearby players as snapshots; hits, damage, knockback and loot travel as messages, so everyone can fight the same zombie. A structure's villagers, golems and cats are spawned once for the whole server (by whoever gets there first). The creatures that stay (villagers, pets, horses, boats, what was bred) are kept by the server and handed to whoever is near them when the player simulating them leaves or walks away.
- **Weather** is the server's: rain and storms come and go for everyone at once. A player who picks Clear, Rain or Storm in their settings sees that instead, only for themselves.
- Brewing stands brew on the server like furnaces; loot chests are filled once, by the server; enchantments travel with dropped items; hunger, experience and effects are saved with each player.
- **Chat** with Enter. **Voice** is a WebRTC mesh signalled through the server, played through Web Audio with distance falloff and stereo placement ("Nearby"), or at equal volume ("Everyone"). Devices without a microphone still hear everyone.
- Settings: `PORT`, `PASSWORD`, `SERVER_NAME`, `MAX_PLAYERS`, `SEED`, `GAME_MODE`, `DIFFICULTY`, `DAY_LENGTH`, `TURN_URLS`, `TURN_SECRET` (environment or `server/config.json`).
- The claude.ai preview can't connect: its sandbox blocks WebSockets and the microphone.

## Graphics

Everything below can be toggled in **Settings → Graphics**, or chosen through the Lite / Low / Medium / High / Ultra presets. Lite is meant for phones, TVs and projectors. The first launch picks a preset from the device and GPU. During the first minutes of play it steps the preset down, one level at a time, while the game runs well under 30 fps. **Dynamic resolution** then lowers the render resolution while the frame rate is under the target (30, 45 or 60 fps) and raises it again when there is headroom.

- **Deferred PBR lighting.** A G-buffer stores albedo, normal-mapped and geometric normals, roughness, metalness, emission and the Minecraft-style sky/block light levels. Every block texture comes with a generated height, normal, roughness and emission map, and specular uses GGX.
- **Atmosphere.** Single-scattering Rayleigh, Mie and ozone, with an approximation for multiple scattering. It is rendered into a sky-view lookup table, so sunrise and sunset colours, the sun's aureole and moonlit nights all come from the same model. The same model runs on the CPU to produce the sunlight colour and sky ambient. The moon goes through eight phases, one per day, so dark new-moon nights show the stars.
- **Soft shadows.** A single distorted shadow map concentrates resolution near the player. Percentage-closer soft shadows (PCSS) give contact-hardened penumbrae, a normal-offset bias avoids acne, and texel snapping keeps shadows stable. Leaves and grass sway identically in the shadow pass.
- **Volumetric clouds.** Raymarched cumulus built from GPU-generated 3D Perlin-Worley noise and a weather map, lit with Beer-Lambert extinction, a powder term and dual-lobe Henyey-Greenstein phase. They drift with the wind, cast moving shadows on the landscape, and fade into the horizon haze. The jittered march is accumulated over frames in a cloud history buffer of its own (reprojected by cloud distance and wind) and upsampled with a Catmull-Rom filter, so the clouds stay smooth even on presets without TAA; noise mip levels follow the pixel footprint to avoid sparkle.
- **God rays.** The view ray is marched through the shadow map and cloud shadows with height fog, giving light shafts through trees and cave mouths, and underwater beams.
- **Water.** Animated wave normals, screen-space reflections that fall back to the sky, refraction, Beer-Lambert absorption that separates turquoise shallows from deep blue ocean, sun glints, shoreline foam, Snell's window from below, and caustics on the seabed derived from the curvature of the surface.
- **Foliage.** Leaves and grass sway in the wind and let light through (subsurface scattering) when backlit.
- **Weather.** Rain spells and thunderstorms arrive now and then, or can be chosen in Settings → World. The sky and clouds turn overcast, and surfaces open to the sky get darker and glossier. Flat ground collects puddles with raindrop ripples, and glossy and wet surfaces get screen-space reflections sampled from the previous frame. Lightning lights up the storm clouds, followed by thunder. Roofs and tree canopies keep rain off, deserts stay dry, and cold biomes get snow instead.
- **Lighting.** Flood-filled sky and block light. Torches, glowstone, lava, jack o'lanterns and sea lanterns emit warm light that flickers slightly.
- **Post-processing.**
  - SSAO
  - Temporal anti-aliasing with variance clipping (or FXAA)
  - Energy-conserving bloom
  - Eye adaptation driven by the light around the camera
  - ACES filmic tone mapping with colour grading
  - Scotopic (night-vision) desaturation
  - Vignette and dithering
- **Pixel-art sampling.** A "sharp bilinear" filter keeps 16×16 textures crisp up close and alias-free in the distance, with anisotropic filtering.

## World

- Infinite terrain streamed in 16×16×384 chunks (as tall as Minecraft's, with the sea at 63 and peaks past 200). It has continents and oceans, eroded mountains with 3D overhangs and snow caps, and rivers. Only the part of a chunk that holds something is lit and meshed.
- Sixteen biomes: plains, forest, birch forest, taiga, snowy taiga, desert, beach, ocean, river and mountains, plus jungle (giant trees, vines, melons), savanna (acacias), swamp (murky water, lily pads, drooping oaks), badlands (terracotta mesas in bands), cherry grove (pink blossom and petals) and dark forest (thick dark oaks).
- Worlds made before the 384-high world keep their original 128-high terrain (the generator version is saved with each world); new worlds use the new one.
- Spaghetti and cheese caves with lava lakes, plus coal, iron, gold, lapis, emerald (in mountains) and diamond ores.
- Oak, big oak, birch, spruce, jungle (and giant jungle), acacia, dark oak and cherry trees, which all grow from their saplings (four in a square for the big ones), cacti, grass, ferns and flowers.
- Over 150 placeable blocks, including glass, bricks, metal blocks, wool in 16 colours, torches and light-emitting blocks, and blocks with a state (which way they face, open or shut, a liquid's level) such as stairs, doors and flowing water.
- Terrain generation, light propagation and meshing run in a pool of Web Workers. Meshing uses face culling, per-vertex ambient occlusion and smooth lighting. If workers are unavailable, it falls back to the main thread.
- Physics covers gravity and axis-separated AABB collision, sprinting, sneaking with edge protection, swimming, flying and optional auto-jump.
- Water and lava flow (see above), and procedural WebAudio provides material-specific break, place and step sounds plus wind, birds, crickets and cave drips.

## Project layout

```
index.html, styles.css     page shell and UI styles
src/main.js                entry point
src/engine/                WebGL helpers, matrix math
src/world/                 blocks, noise, terrain generator, lighting + mesher, worker, chunk streaming, textures
src/render/                renderer (pass orchestration), CPU atmosphere
src/render/shaders/        GLSL: terrain, sky, clouds, lighting, water, post-processing, overlays, noise generation
src/game/                  game loop, player physics, input (keyboard, mouse, touch, controllers), audio, particles, saving, device detection
src/ui/                    menus, settings, hotbar, inventory, block icons, translations, focus navigation
tools/                     dev server, single-file build, icon generator
test/                      Node tests (npm test)
```

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds `dist/` and publishes it on every push to `main`. Before its first run, enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Browser support

The game needs WebGL 2 with `EXT_color_buffer_float`, which current Chrome, Edge, Firefox and Safari provide. On integrated graphics, start with the Medium or Low preset, a smaller render distance, or a lower resolution scale.

Lumencraft is an independent fan project inspired by Minecraft. It is not affiliated with Mojang or Microsoft and uses none of their assets.
