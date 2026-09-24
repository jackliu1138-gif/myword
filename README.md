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
npm run build    # writes dist/index.html (about 250 KB)
```

`dist/index.html` runs straight from disk (double-click it) or from any static host. Served over HTTP(S) it is also an installable web app (manifest and icons are copied next to it), so phones and tablets can add it to the home screen and run it full screen.

`npm test` runs the Node test suite, which covers terrain determinism, lighting, meshing, raycasting, saving, weather and the translations, without a browser.

### Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Walk |
| Mouse | Look |
| `Space` | Jump, swim up, fly up |
| `Space` twice or `F` | Toggle flying |
| `Shift` | Sneak (won't walk off edges), fly down |
| `W` twice or `R` | Sprint |
| Left click (hold) | Break blocks |
| Right click | Place the selected block |
| Middle click | Pick the block you're looking at |
| `1`–`9`, mouse wheel | Choose hotbar slot |
| `E` | Open all blocks |
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
- **Mining and tools**: hold to break; cracks show progress. Stone and ores need a pickaxe to drop anything; the right tool (pickaxe, axe, shovel) is faster. Tools and weapons wear out.
- **Combat**: swords hit harder, jumping hits are critical, hits knock creatures back. The bow charges while held and needs arrows.
- **Crafting**: open the inventory (E / Y / bag button). Every recipe you can make with what you carry is listed; tap one to craft it (planks, sticks, torches, tools, swords, bow and arrows, bread, cooked meat, glass, bricks...).
- **Dying** drops everything you carried where you fell; you respawn at the world spawn.

The creature simulation (`src/sim/`) runs at 20 ticks per second with no DOM or WebGL, so the multiplayer server can run the same code.

## Multiplayer and voice chat

Run `node server/server.mjs` on a server (Node 18+, no packages) and friends open its address in a browser to share one world. The Chinese deployment guide in [server/README.zh-CN.md](server/README.zh-CN.md) covers systemd, https with Caddy and a TURN relay (coturn) for voice.

- **Shared world**: block edits and the time of day are kept on the server (`server/data/world.json`); each player's inventory, health and position are saved by name.
- **Creatures** live on the machine of the player they spawned near and are sent to nearby players as snapshots; hits, damage, knockback and loot travel as messages, so everyone can fight the same zombie.
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

- Infinite terrain streamed in 16×16×128 chunks. It has continents and oceans, eroded mountains with 3D overhangs and snow caps, and rivers.
- Ten biomes: plains, forest, birch forest, taiga, snowy taiga, desert, beach, ocean, river and mountains.
- Spaghetti and cheese caves with lava lakes, plus coal, iron, gold and diamond ores.
- Oak, big oak, birch and spruce trees, cacti, grass, ferns and flowers.
- 65 placeable blocks, including glass, bricks, metal blocks, wool in 15 colours, torches and light-emitting blocks.
- Terrain generation, light propagation and meshing run in a pool of Web Workers. Meshing uses face culling, per-vertex ambient occlusion and smooth lighting. If workers are unavailable, it falls back to the main thread.
- Physics covers gravity and axis-separated AABB collision, sprinting, sneaking with edge protection, swimming, flying and optional auto-jump.
- Water fills gaps next to it, and procedural WebAudio provides material-specific break, place and step sounds plus wind, birds, crickets and cave drips.

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
