# Lumencraft

A Minecraft-style voxel sandbox that runs in the browser, with a rendering pipeline modelled on the popular "realistic" shader packs: physically based sky, soft sun shadows, volumetric clouds, god rays, reflective water, bloom and filmic tone mapping.

It is plain WebGL 2 and JavaScript with no runtime dependencies. Terrain, textures and sounds are all generated procedurally, so the repository ships no image or audio assets.

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

`dist/index.html` runs straight from disk (double-click it) or from any static host.

`npm test` runs the Node test suite, which covers terrain determinism, lighting, meshing, raycasting, saving and weather, without a browser.

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

Touch screens get an on-screen stick, jump/sneak/fly buttons, drag-to-look, tap to place and hold to break.

Your world (seed, position, time of day, hotbar and every block you change) is saved in the browser's IndexedDB. Use **New world** on the title screen to start over, optionally with a seed.

## Graphics

Everything below can be toggled in **Settings → Graphics**, or chosen through the Low / Medium / High / Ultra presets. The first launch picks a preset from the GPU, and steps down once if the game runs well under 30 fps.

- **Deferred PBR lighting.** A G-buffer stores albedo, normal-mapped and geometric normals, roughness, metalness, emission and the Minecraft-style sky/block light levels. Every block texture comes with a generated height, normal, roughness and emission map, and specular uses GGX.
- **Atmosphere.** Single-scattering Rayleigh, Mie and ozone, with an approximation for multiple scattering. It is rendered into a sky-view lookup table, so sunrise and sunset colours, the sun's aureole and moonlit nights all come from the same model. The same model runs on the CPU to produce the sunlight colour and sky ambient.
- **Soft shadows.** A single distorted shadow map concentrates resolution near the player. Percentage-closer soft shadows (PCSS) give contact-hardened penumbrae, a normal-offset bias avoids acne, and texel snapping keeps shadows stable. Leaves and grass sway identically in the shadow pass.
- **Volumetric clouds.** Raymarched cumulus built from GPU-generated 3D Perlin-Worley noise and a weather map, lit with Beer-Lambert extinction, a powder term and dual-lobe Henyey-Greenstein phase. They drift with the wind, cast moving shadows on the landscape, and fade into the horizon haze.
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
- Around 65 blocks, including glass, bricks, metal blocks, wool in 15 colours, torches and light-emitting blocks.
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
src/game/                  game loop, player physics, input, audio, particles, saving
src/ui/                    menus, settings, hotbar, inventory, block icons
tools/                     dev server and single-file build
test/                      Node tests (npm test)
```

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds `dist/` and publishes it on every push to `main`. Before its first run, enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Browser support

The game needs WebGL 2 with `EXT_color_buffer_float`, which current Chrome, Edge, Firefox and Safari provide. On integrated graphics, start with the Medium or Low preset, a smaller render distance, or a lower resolution scale.

Lumencraft is an independent fan project inspired by Minecraft. It is not affiliated with Mojang or Microsoft and uses none of their assets.
