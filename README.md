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

`npm test` runs the Node test suite, which covers terrain determinism, lighting, meshing, raycasting, saving, weather, flowing liquids, shaped blocks, furnaces and chests, hunger, experience, enchanting, brewing, loot, trading, rails, elytra flight, structures, the planets' orbits and maps, flying to space and landing on the Moon and Mars, flying saucers (their way across space, launch pads and docking decks, landing, bouncing and getting up off their hull, seats), the F-22 (its controls, its shape, its missiles' and cannon's damage), the multiplayer server and the translations, without a browser.

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk |
| Mouse | Look |
| `Space` | Jump, swim up, fly up; with elytra on, press it again in the air to glide; on the Moon and Mars, press it again in the air and hold it to fire your suit's thrusters |
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
| `G` | Pick up a villager, a friend or an animal in your arms (a princess carry); again (or right click) to put it down, or throw it while running (also the touch screen's Lift button and the controller's D-pad right) |
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
- **Space, the Moon and Mars**: keep flying up (creative flight, or elytra and fireworks, which push harder as the air thins) and the sky turns black. 2000 blocks above the sea (100 km at 50 m a block) the air ends and you are in space, the curved Earth below you: its continents, oceans, ice caps and clouds, and on its night side the lights of its villages, all drawn from the world's own terrain. The Moon goes round the Earth (its phases are the ones the night sky shows), and Mars, Jupiter (bands, the great red spot) and Saturn (rings) hang where they are. Markers show how far each one is, and the further you are from everything the faster you fly. Near a body you go round with it, so stopping keeps you over the same ground. Come down close to the Moon or Mars and you land on it, your suit's thrusters bringing you down in seconds. Jupiter and Saturn have no ground: their beacons guide you to a station floating over their clouds, above the Great Red Spot and under Saturn's rings, with a glass dome over a cherry tree garden, a landing pad and a sea of banded cloud below (fall off and your thrusters bring you back). The Moon has grey regolith, dark maria and craters, a sixth of the Earth's gravity, and the Earth in its black sky going through phases of its own. Mars has red sand and rock, volcanoes, a great canyon and ice caps under a butterscotch sky with blue sunsets. Your suit's thrusters bring you down unhurt and lift you up again (press jump again in the air and hold it); climb high enough and you are back in space. Nothing burns without air there, and nether portals only work between the overworld and the Nether.
- **Carrying**: pick up a villager, a friend or a small animal in your arms (a princess carry) and take it with you, through portals and into space too in single player. Villagers have something to say about it and remember it; put one down far from its home and it lives there instead, so you can move villagers into your own houses. On a server everyone sees who carries whom, and someone carried can wriggle free by jumping three times.
- **Flying saucers**: a mothership 55 blocks across: a plated silver hull with a band of chasing lights round its rim, navigation lights and a strobe, a ring of lit windows, a great glass dome over a deck with the pilot's console, sixteen passenger seats round a hologram of where it is going, a main engine and eight thrusters underneath, and six landing legs that each reach down to the ground under them, so it stands level on uneven ground. Creative has one in the inventory; in survival it is made from 4 iron blocks, 4 glass, 2 lanterns and 2 diamonds, and its 64-unit tank takes coal or charcoal (1), blaze rods (2) or lava buckets (8): right click it holding fuel, or press Add fuel in its panel. Use it on the ground and it settles a little in front of you (it needs a clear patch about as wide as itself); right click any part of it and a beam lifts you up into the pilot's seat. The flight panel lists where it can go (the Earth, the Moon, Mars, the stations over Jupiter and Saturn), what each trip costs and how long it should take: 30 seconds, a minute, three minutes, or anything from 15 seconds to 15 minutes, to watch the view. The autopilot does the rest: the engines wind up, ignite with a boom that shakes the ground and throws a ring of dust out over it, and it lifts off on columns of fire whose red glow lights up the ground, the trees and the smoke all round (at night most of all), up out of the air, round the planet and across space, and down onto the fixed launch pad at the other end (on the Earth the spot where the saucer was first set down, on the Moon and Mars the great pad in the middle of their worlds, on the stations a docking deck of its own beside each, joined to it by a bridge). Its sound is synthesised: a deep rumble you feel as much as hear, the roar and crackle of the fire, the turbines' whine, the boom of ignition rolling away and the thud of landing; in space it is heard only through the hull. In flight the camera swings round the saucer as you look about; the wheel or the trip bar's + and − bring it closer or take it further out, and **C** switches to the view from the bridge, under the dome, and back. **Fly it myself** hands you the controls: steer with the movement keys (the way the camera looks), jump to climb, sneak to come down, sprint for speed (faster still high up and in space). Keep coming down over flat ground and it slows and lands itself; rough ground is refused; hit the ground or a wall and it just bounces off, unharmed. Fly up out of the air into space and down onto any planet, or call up the autopilot again from wherever you are. Landed, sneak to climb out; the saucer stays where it is. It seats sixteen besides the pilot: landed, **Invite villagers aboard** asks the villagers near it in (friends always come, the rest may be too scared) and they are beamed up into the seats, where they sit and look out through the glass and have something to say at lift-off, in space and on arrival; **Let the villagers off** beams them down round the saucer wherever it is, and they make their home there. A villager carried aboard takes a seat too. In survival, flying it yourself burns a unit of fuel every half minute.
  On a phone or tablet two fingers pinched together or spread apart take the camera further out or bring it closer, as the wheel does. **The Earth saucer base**, one to a world on open land a few hundred blocks from the middle (the same place for everyone on a server), is a destination for every saucer: a spaceport 256 blocks across with five launch pads round a plaza, its terminal and a 45-block control tower (a ladder up the inside to the glass control cabin and a beacon on its mast), taxiways lit along their edges and a ring of lights round the deck. A saucer sent there comes down on a free pad (each player's saucer has its own order to try them in; a pad with a saucer on it is passed over, and the panel says when all five are taken).
- **Carpets** in the sixteen wool colours (two wool make three): put one on the floor, or on the top of a bed, where it lies over the mattress as its blanket and hangs down the sides; a bed with a blanket is still slept in, and breaking the bed brings its blanket off with it.
- **F-22 Raptor**: a fighter jet at its real size (18.9 m long, 13.56 m across, wings swept 42 degrees, two canted tails, caret intakes, the gold-tinted canopy, two thrust-vectoring nozzles), with moving stabilators, flaperons and rudders, landing gear that folds away, weapons-bay doors that open as a missile drops, the afterburner's flame with its shock diamonds lighting up the ground, and a cockpit you can fly it from. Creative has one; in survival it is made from 6 iron blocks, 2 diamonds, 2 glass and 2 TNT. It is made easy to fly, the way a game's "mouse aim" does it: it goes where you look (the circle in the middle of the green HUD), banking into its turns by itself, and Auto-GCAS (as on real F-22s) pulls it up out of a dive into the ground. W and S work the throttle (W held at full lights the afterburner), A and D roll, Shift is the air brake; take off down a runway with W (it lifts its nose by itself) or straight up with Space. **H hovers**: it holds still in the air, its nose where you look, so you can aim exactly; W A S D move it, Space and Shift take it up and down, and down on the ground it lands (Shift again climbs out). The left button fires the M61 cannon (480 rounds, tracers among them), the right button a missile (six AIM-120s from the main bay, then an AIM-9 from each side bay): hold the circle on a creature or another player for a moment and the box round it turns red, locked, and the missile goes after it; otherwise it flies to wherever the circle is. **F** sets the firepower, 1 to 5: what the rounds and missiles hit is blown apart that hard (a missile at full firepower leaves a crater thirty blocks across): blocks (obsidian too), creatures and players, in creative mode as well. The HUD shows speed (km/h and Mach), height over the sea and the ground, heading, the pitch ladder and bank, g, throttle, rounds and missiles left, the firepower and the airframe's state; **C** switches between the view from behind it and the cockpit (the wheel or two fingers zoom). On the ground for a few seconds it rearms. Crash it and the seat throws you out to come down under a parachute; shot down, you go down with it. Its sound is synthesised too: the turbines' whine, the roar and the afterburner's thunder and crackle, the cannon's tearing buzz, missiles away, and blasts heard as late as sound takes to arrive. On a touch screen it has its own buttons (cannon, missile, hover, firepower); on a controller the right trigger fires the cannon, the left a missile, X hovers and the D-pad's right sets the firepower.
- **Dying** drops everything you carried where you fell; you respawn at your bed (if it's still there) or the world spawn.
- **Several worlds**: the title screen's world list keeps as many single-player worlds as you like, each with its own name, mode, buildings, inventory and time; open, rename or delete them there.
- **Hunger**: ten drumsticks beside the hearts. Running, jumping, swimming, fighting and healing use them up; eating takes a moment (hold the use button) and each food fills them by its own amount (and saturation). Full, you heal quickly; empty, you starve. Rotten flesh, raw chicken and pufferfish can make you ill.
- **Experience and enchanting**: creatures, ores, smelting, trading, breeding and fishing leave green orbs; levels show above the hotbar. An enchanting table (book, diamonds, obsidian) with up to 15 bookshelves around it offers three enchantments for levels and lapis lazuli: sharpness, smite, looting, efficiency, fortune, silk touch, unbreaking, protection, feather falling, power, flame, infinity, quick charge, multishot, piercing, lure, luck of the sea... Mending (on some villagers' wares) repairs what you hold and wear with the experience you pick up.
- **Potions**: a brewing stand fuelled with blaze powder turns water bottles into potions: nether wart makes an Awkward Potion, then glistering melon, ghast tear, blaze powder, sugar, magma cream, golden carrot, pufferfish, spider eye, phantom membrane or a slime ball give healing, regeneration, strength, swiftness, fire resistance, night vision, water breathing, poison, slow falling or leaping; fermented spider eye turns them to harming, weakness, slowness or invisibility, and gunpowder makes them splash. Effects show at the top right; milk clears them.
- **Shield, crossbow, fishing rod, totem**: a shield in the other hand blocks what comes from the front (an axe knocks it aside). The crossbow loads while held and fires an arrow (or three with multishot, or a firework from the other hand). The fishing rod catches fish, now and then treasure or junk, and can hook a creature to pull it in. A totem of undying in either hand saves you from death once.
- **Villages**: houses, farms, a well, a smithy and lamp posts on dirt paths, in plains, desert, savanna, taiga and snowy styles. Villagers have jobs (farmer, fisherman, shepherd, fletcher, librarian, cartographer, cleric, armorer, weaponsmith, toolsmith, butcher, leatherworker, mason) and trade for emeralds; they restock every morning and go home at night. **Iron golems** guard them (and are built from a T of iron blocks and a pumpkin).
- **Villagers that talk**: right click (or tap) a villager to talk. Each is somebody: a name, a character, a quirk and a voice that follow from who it is, the same for every player. They remember each player (what was said, presents, tasks done, a punch), pass on the village's gossip (who went to the Nether, who fell into lava, who slew the dragon), set tasks with a reward (the task card shows what you have; hand it in from the talk screen), give friends small presents, can be talked into a discount on their trades and into following you. Their words appear over their heads and are spoken in the device's own voice (quieter with distance; a setting turns it off), and you can type, pick a ready-made line or speak (where the browser can). **Settings → Sound → Test** says a line and tells you whether the device can speak and what to do if it can't (pages opened inside WeChat, QQ and other apps usually have no speech); on iPhones and iPads the game's sound and the voices play even with the silent switch on. The answers come from the server's language model (the user's ATRIA model by default; any OpenAI-compatible endpoint) whose key never leaves the server; without one, or when it is busy or slow, a scripted mind answers instead. On a server everyone near a villager hears it, and its memories are kept with the world; in single player they are kept in the save. Whatever a model says a villager does is checked (no stacks of diamonds), and requests are rationed. Sneak and right click to trade straight away.
- **Village life**: villagers know of real places round about (a desert temple, a witch hut, a pillager outpost, an ocean monument, a woodland mansion, an abandoned mineshaft, another village, a stronghold, found in the world's own plan): ask one "Anything interesting near here?" and it tells you which way and how far, with a warning, and the place is marked on your screen (an arrow at the edge when it is behind you) until you get there; the pause menu takes the marker away. Find it and the villager who told you is pleased, and the village talks about it. Two neighbours stop and chat now and then, face to face, the conversation written by the server's model (on a server everyone near sees and hears the same one; scripted without a model). Their feelings show: a heart, a note, a cross vein, a ! or ? rising over their heads, and a nod, a shake of the head, a wave, a cheer, a hop or a stamp of the foot. They wave when a good friend comes by, cheer (and like you better) when you see off a monster near them, tell you off for knocking their houses about (not what you built yourself), run indoors from storms, and gather round when you drop out of the sky.
- **Pets and farm animals**: wolves (tamed with bones) follow you, fight for you and sit when told; cats (raw fish) scare creepers away. Two animals fed their food (wheat, carrots, seeds) have a baby that grows up. Shear sheep for wool (it grows back), milk cows with a bucket. Cod, salmon, tropical fish, pufferfish and squid swim in the water.
- **New monsters**: witches (throw potions, drink their own), slimes (split when killed; in swamps and slime chunks), phantoms (swoop down on players who haven't slept for three nights), pillager patrols and outposts, vindicators, evokers (fangs from the ground) in woodland mansions, guardians and an elder guardian in ocean monuments, shulkers in end cities, cave spiders by mineshaft spawners, wither skeletons, and the **Wither** (three wither skeleton skulls on a T of soul sand).
- **Getting about**: boats on water; minecarts on rails that curve and slope as they are laid (powered rails speed carts up); horses (ride one until it stops throwing you, then saddle it); and **elytra** (worn in the chest slot, or put on by using them from the hand): jump, then press jump again in the air to glide (straight after the jump, as since Java 1.15; in creative that second press spreads them rather than toggling flight), the view widening with speed and the air rushing past. Use a firework rocket in flight for a burst along the way you look (to about 34 blocks a second, as in Minecraft), with colour-cycling sparks streaming off both wings and the rocket's fire between them. A rocket used with the elytra on but not spread (jumping, falling, flying, or standing and looking at the sky rather than at a block) spreads them and takes you with it.
- **Pressure plates** open the doors, gates and trapdoors beside them while a player, creature or item is on them (stone plates only for players and creatures), and close them again when it steps off; iron doors only open this way. TNT lit with flint and steel (or under a plate) blows up after a moment.
- **Structures** in the new world: villages, desert temples (with their TNT trap), abandoned mineshafts (rails, cobwebs, cave spider spawners), dungeons (a monster spawner and loot), witch huts, pillager outposts, ocean monuments, woodland mansions and end cities with their ships (elytra aboard, beyond the End's outer gateways after the dragon). Their chests hold loot rolled when first opened.

The creature simulation (`src/sim/`) runs at 20 ticks per second with no DOM or WebGL, so the multiplayer server can run the same code.

## Multiplayer and voice chat

Run `node server/server.mjs` on a server (Node 18+, no packages) and friends open its address in a browser to share one world. The Chinese deployment guide in [server/README.zh-CN.md](server/README.zh-CN.md) covers systemd, https with Caddy and a TURN relay (coturn) for voice.

- **Shared world**: block edits in every dimension (the overworld, the Nether, the End, the Moon and Mars), the End's dragon fight, chests, furnaces, signs and the time of day are kept on the server (`server/data/world.json`, or `DATA_DIR`); each player's inventory, armour, health, dimension and position are saved by name. Everyone sees what the others hold and wear.
- **Shared things**: dropped items are seen by everyone and go to whoever reaches them first. A chest or furnace is open to one player at a time (others are told who is using it); furnaces keep cooking on the server; breaking a chest spills what it held for everyone.
- **Creatures** live on the machine of the player they spawned near and are sent to nearby players as snapshots; hits, damage, knockback and loot travel as messages, so everyone can fight the same zombie. A structure's villagers, golems and cats are spawned once for the whole server (by whoever gets there first). The creatures that stay (villagers, pets, horses, boats, what was bred) are kept by the server and handed to whoever is near them when the player simulating them leaves or walks away.
- **Space**: players in space see each other where they are over the planet nearest them, the same ground below for everyone; leave the server in space and you come back over the same place, however far the Moon has gone round meanwhile.
- **Flying saucers**: everyone sees a saucer take off, fly and land, with its fire and smoke. Right click someone's landed saucer to ask to come aboard: up to sixteen passengers (villagers aboard included) sit on its deck and go wherever it goes, into space and onto other worlds too, swinging the camera round it as they like; sneak once it has landed to get off. Anyone can climb into a parked saucer: the game that was running it hands it over.
- **F-22s**: everyone sees the others' jets fly (smoothly, however fast they go), their afterburners, gear and hover, their tracers and missiles, and hears them roar past; what their fire breaks is broken for everyone. A missile or a burst of cannon fire that hits another player kills them however they play (creative too); a player flying an F-22 takes it on the jet, which is shot down when it has had enough. Anyone can climb into a parked F-22: the game that was running it hands it over.
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
- **From the sky to space.** Climbing higher, the landscape gives way to the planet. A transmittance table and a sky-view table (in the manner of Bruneton and Hillaire) show the Earth's air from any height, from a blue limb above a black sky to sunsets along the terminator. The ground comes from maps that the world's own generator paints on Web Workers (near, middle and whole-planet maps, sampled by pixel footprint), with its clouds, glints on the oceans, moonlit clouds and village lights on the night side. The Moon is lit with Lommel-Seeliger reflectance and earthshine, Mars has a thin dusty air, Jupiter and Saturn have banded clouds, Saturn's rings are shadowed by the planet, and the stars and the Milky Way stay fixed in the sky. The cumulus layer curves with the planet, and exposure follows the sunlight once the sky is black.
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

- The overworld is the map of a real-sized Earth (6360 km in radius at 50 m a block). The first 40,000 blocks from its middle are the terrain as it always was. Further out, continents and oceans and climates follow the latitude: ice in the far north and south, deserts in the dry belts, jungles at the equator (about 53,000 blocks south of the middle). The Moon and Mars are worlds of their own.
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
src/world/                 blocks, noise, terrain generators (overworld, Nether, End, Moon, Mars), the space model (orbits, frames) and planet maps, lighting + mesher, worker, chunk streaming, textures
src/render/                renderer (pass orchestration), CPU atmosphere
src/render/shaders/        GLSL: terrain, sky, space (the planets from orbit), clouds, lighting, water, post-processing, overlays, noise generation
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
