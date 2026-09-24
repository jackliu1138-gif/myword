// Game controller: world lifecycle, player, interaction, time of day, UI state, frame loop.

import { World } from '../world/world.js';
import { Renderer, QUALITY_PRESETS } from '../render/renderer.js';
import { generateTextures, buildTextureArrays } from '../world/textures.js';
import { Player, raycast } from './player.js';
import { Input, TouchControls } from './input.js';
import { Audio, materialOf } from './audio.js';
import { Particles } from './particles.js';
import { Weather } from './weather.js';
import * as store from './save.js';
import { BLOCK, BLOCKS, SHAPE, SHAPE_OF, FACE_TEX, IS_SOLID, IS_LIQUID, TINT, MAT, CHUNK_SIZE } from '../world/blocks.js';
import { clockText } from '../ui/ui.js';
import { buildIcons } from '../ui/icons.js';
import { BIOME_NAMES, BIOME } from '../world/generator.js';
import { mat4 } from '../engine/math.js';

const DEFAULT_HOTBAR = [BLOCK.GRASS, BLOCK.DIRT, BLOCK.STONE_BRICKS, BLOCK.OAK_PLANKS, BLOCK.OAK_LOG, BLOCK.GLASS, BLOCK.TORCH, BLOCK.WATER, BLOCK.GLOWSTONE];
const REACH = 6;
const SAVE_VERSION = 1;

function detectPreset() {
  const touch = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 700;
  if (touch && small) return 'low';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(r)) return 'low';
    if (/intel|uhd|iris|mali|adreno|powervr|apple gpu/i.test(r)) return 'medium';
  } catch (e) { /* ignore */ }
  return 'high';
}

export function defaultSettings() {
  const preset = detectPreset();
  return {
    preset,
    ...QUALITY_PRESETS[preset],
    renderDistance: preset === 'low' ? 6 : preset === 'medium' ? 7 : 9,
    fov: 75,
    sensitivity: 1,
    invertY: false,
    viewBobbing: true,
    autoJump: false,
    volume: 0.7,
    ambience: true,
    dayLength: 20,
    timeOfDay: 0.06,
    cloudCoverage: 0.5,
    brightness: 1,
    weather: 'auto',
  };
}

function seedFromString(s) {
  if (!s) return (Math.random() * 2 ** 31) | 0;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

const TINT_RGB = {
  [TINT.GRASS]: [0.5, 0.76, 0.33], [TINT.FOLIAGE]: [0.42, 0.7, 0.27], [TINT.BIRCH]: [0.52, 0.68, 0.36], [TINT.SPRUCE]: [0.4, 0.58, 0.4],
};

export class Game {
  constructor(canvas, ui, opts = {}) {
    this.canvas = canvas;
    this.ui = ui;
    this.opts = opts;
    this.state = 'boot';
    this.last = performance.now();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.frameMs = 0;
    this.debug = false;
    this.hudHidden = false;
    this.titleAngle = 0.6;
    this.eyeSky = 1;
    this.swing = 0;
    this.breakTimer = 0;
    this.placeTimer = 0;
    this.saveTimer = 0;
    this.selection = null;
    this.handModel = mat4.create();
    this.fovCurrent = 75;
    this.cloudOffset = [0, 0];
    this.loadingDone = false;
    this.lastSelected = -1;
    this.BLOCK = BLOCK; // handy for the console and automated tests
    this.weather = new Weather();
    this.precip = { amount: 0, type: 'rain' };
    this.rainMapKey = '';
    this.rainMapTime = 0;
    this.rainMapData = new Uint8Array(64 * 64);
    this.biomeTimer = 0;
  }

  async start() {
    const saved = store.loadSettings();
    this.settings = { ...defaultSettings(), ...(saved || {}) };
    if (this.opts.settingsOverride) Object.assign(this.settings, this.opts.settingsOverride);
    this.textures = generateTextures();
    const arrays = buildTextureArrays(this.textures);
    this.renderer = new Renderer(this.canvas, arrays, this.settings);
    this.icons = buildIcons(this.textures);
    this.ui.buildInventory(this.icons);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.save();
      this.ui.showError('The graphics context was lost (the GPU was reset or ran out of memory). Your world was saved; reload the page to continue.');
    });
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onLockError = () => {
      if (this.state === 'playing') this.ui.setLockHint(true);
    };
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
      this.touch = new TouchControls(document.getElementById('app'), this.input);
    }
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.audio.ambientOn = this.settings.ambience;
    this.bindUi();

    const data = this.opts.freshWorld ? null : await store.loadWorld();
    const seed = this.opts.seed !== undefined ? this.opts.seed : data && data.version === SAVE_VERSION ? data.seed : seedFromString('');
    this.loadWorld(seed, data && data.version === SAVE_VERSION && data.seed === seed ? data : null);
    this.enterTitle();
    const loop = (t) => {
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(); });
  }

  // ------------------------------------------------------------------ world lifecycle
  loadWorld(seed, data) {
    if (this.world) {
      for (const c of this.world.chunks.values()) this.renderer.freeChunk(c);
      this.world.dispose();
    }
    const edits = data ? World.deserializeEdits(data.edits) : null;
    const workers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.world = new World(seed, { renderDistance: this.settings.renderDistance, workers, edits });
    this.world.onChunkUnload = (c) => this.renderer.freeChunk(c);
    this.player = new Player(this.world);
    this.particles = new Particles(this.world);
    if (data && data.player) {
      this.player.pos = data.player.pos.slice();
      this.player.yaw = data.player.yaw;
      this.player.pitch = data.player.pitch;
      this.player.flying = !!data.player.flying;
      this.spawnPending = false;
    } else {
      this.player.pos = this.world.generator.findSpawn();
      this.player.yaw = Math.PI * 0.25;
      this.spawnPending = true;
    }
    this.dayTime = data && typeof data.dayTime === 'number' ? data.dayTime : this.settings.timeOfDay;
    this.hotbar = data && Array.isArray(data.hotbar) && data.hotbar.length === 9 ? data.hotbar.slice() : DEFAULT_HOTBAR.slice();
    this.selected = data && Number.isInteger(data.selected) ? data.selected : 0;
    this.titleAnchor = this.player.pos.slice();
    this.loadingDone = false;
    this.ui.renderHotbar(this.hotbar, this.selected);
    this.ui.setTitleMeta(`Seed ${seed} · ${data ? 'saved world' : 'new world'}`);
    this.ui.setPlayLabel(data ? 'Continue' : 'Play');
    this.player.onStep = (b) => this.audio.play('step', b < 0 ? 'water' : materialOf(BLOCKS[b]), 0.8);
    this.player.onLand = (speed, b) => { if (speed > 6) this.audio.play('step', materialOf(BLOCKS[b]), 1.4); };
    this.player.onSplash = () => this.audio.play('splash');
    this.renderer.resetHistory();
    this.world.dirtyEdits = false;
  }

  async save() {
    if (!this.world || !this.player || this.state === 'boot') return;
    const data = {
      version: SAVE_VERSION,
      seed: this.world.seed,
      player: { pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch, flying: this.player.flying },
      dayTime: this.dayTime,
      hotbar: this.hotbar,
      selected: this.selected,
      edits: this.world.serializeEdits(),
      savedAt: Date.now(),
    };
    this.world.dirtyEdits = false;
    await store.saveWorld(data);
  }

  // ------------------------------------------------------------------ UI wiring
  bindUi() {
    const ui = this.ui;
    ui.on('click', () => { this.audio.unlock(); this.audio.play('click'); });
    ui.on('play', () => this.play());
    ui.on('resume', () => this.play());
    ui.on('openSettings', () => {
      ui.buildSettings(this.settings, (k, v, live) => this.changeSetting(k, v, live));
      ui.push('settings');
    });
    ui.on('openHelp', () => ui.push('help'));
    ui.on('openNewWorld', () => {
      document.getElementById('seed-input').value = '';
      ui.push('newworld');
      setTimeout(() => document.getElementById('seed-input').focus(), 40);
    });
    ui.on('back', () => ui.pop());
    ui.on('toTitle', async () => { await this.save(); this.enterTitle(); });
    ui.on('createWorld', async (seedText) => {
      await store.deleteWorld();
      this.loadWorld(seedFromString(seedText), null);
      this.enterTitle();
      this.ui.toast('New world created');
    });
    ui.on('pickBlock', (id) => {
      this.hotbar[this.selected] = id;
      this.ui.renderHotbar(this.hotbar, this.selected);
      this.ui.showBlockName(BLOCKS[id].name);
      this.audio.play('pop');
    });
    ui.on('selectSlot', (i) => {
      this.selected = i;
      this.ui.renderHotbar(this.hotbar, this.selected);
    });
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.state === 'playing' && !this.input.locked && !this.input.lockFailed) this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
  }

  changeSetting(key, value, live) {
    const s = this.settings;
    if (key === 'preset') {
      Object.assign(s, QUALITY_PRESETS[value]);
      s.preset = value;
      if (this.state !== 'playing') s.autoTuned = true;
    } else {
      s[key] = value;
      if (['shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa'].includes(key)) s.preset = 'custom';
    }
    if (key === 'timeOfDay') this.dayTime = value;
    if (key === 'renderDistance') {
      this.world.renderDistance = value;
      this.world.lastCx = null; // re-scan the neighbourhood with the new radius
    }
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'ambience') this.audio.ambientOn = value;
    const graphics = ['preset', 'renderScale', 'shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa'];
    if (!live && graphics.includes(key)) this.renderer.applySettings(s);
    store.saveSettings(s);
  }

  onGlobalKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const code = e.code;
    if (code === 'Escape') {
      if (this.state === 'inventory') { this.closeInventory(); e.preventDefault(); }
      else if (this.state === 'playing' && !this.input.locked) this.pause();
      else if (this.state === 'paused' || this.state === 'title') {
        if (this.ui.current === 'settings' || this.ui.current === 'help' || this.ui.current === 'newworld') this.ui.pop();
        else if (this.state === 'paused') this.play();
      }
      return;
    }
    if (code === 'KeyE') {
      if (this.state === 'playing') { this.openInventory(); e.preventDefault(); }
      else if (this.state === 'inventory') { this.closeInventory(); e.preventDefault(); }
    }
    if (code === 'F3' || code === 'Backquote') {
      this.debug = !this.debug;
      if (!this.debug) this.ui.setDebug(null);
      e.preventDefault();
    }
    if (code === 'KeyH' && (this.state === 'playing')) {
      this.hudHidden = !this.hudHidden;
      this.ui.setHud(!this.hudHidden);
    }
  }

  onLockChange(locked) {
    if (locked) {
      this.ui.setLockHint(false);
    } else if (this.state === 'playing') {
      this.pause();
    }
  }

  enterTitle() {
    this.state = 'title';
    this.input.enabled = false;
    this.input.exitLock();
    this.ui.clearStack();
    this.ui.show('title');
    this.ui.setHud(false);
    if (this.touch) this.touch.show(false);
    this.titleAnchor = this.player.pos.slice();
  }

  play() {
    this.audio.unlock();
    this.ui.clearStack();
    this.ui.show(null);
    this.state = 'playing';
    this.input.enabled = true;
    this.ui.setHud(!this.hudHidden);
    if (this.touch) this.touch.show(true);
    if (!this.touch || !this.input.touch.active) {
      if (!this.input.lockFailed) this.input.requestLock();
    }
    this.ui.setLockHint(this.input.lockFailed && !this.touch);
    if (this.input.lockFailed && !this.touch) {
      document.getElementById('lockhint').textContent = 'Drag with the mouse to look around';
      setTimeout(() => this.ui.setLockHint(false), 4000);
    }
    this.renderer.resetHistory();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.ui.show('pause');
    if (this.touch) this.touch.show(false);
    this.save();
  }

  openInventory() {
    this.state = 'inventory';
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    this.suppressPause = true;
    this.input.exitLock();
    this.ui.renderHotbar(this.hotbar, this.selected);
    this.ui.show('inventory');
  }

  closeInventory() {
    this.ui.show(null);
    this.state = 'playing';
    this.input.enabled = true;
    if (!this.input.lockFailed && !this.touch) this.input.requestLock();
  }

  // ------------------------------------------------------------------ per frame
  frame(now) {
    const real = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(0.1, real);
    this.last = now;
    const t0 = performance.now();
    try {
      this.update(dt);
      this.renderFrame(dt);
    } catch (err) {
      console.error(err);
      if (!this.errorShown) {
        this.errorShown = true;
        this.ui.toast('Something went wrong: ' + err.message, 6000);
      }
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
    this.fpsFrames++;
    this.fpsTime += real;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      if (this.debug) this.ui.setDebug(this.debugText());
      this.autoQuality();
    }
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    const playing = this.state === 'playing';
    const frameInput = input.consumeFrame();
    let ctl = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, toggleFly: false, autoJump: this.settings.autoJump };

    if (playing) {
      const k = (c) => input.down(c);
      this.player.look(frameInput.dx, frameInput.dy, this.settings.sensitivity, this.settings.invertY);
      ctl.forward = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);
      ctl.strafe = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
      const tc = input.touch;
      if (tc.active) {
        if (Math.abs(tc.move[1]) > 0.15) ctl.forward = -tc.move[1];
        if (Math.abs(tc.move[0]) > 0.15) ctl.strafe = tc.move[0];
        if (-tc.move[1] > 0.92) ctl.sprint = true;
      }
      ctl.jump = k('Space') || tc.jump;
      ctl.sneak = k('ShiftLeft') || k('ShiftRight') || tc.sneak;
      ctl.sprint = ctl.sprint || k('KeyR') || k('ControlLeft') || frameInput.doubleW || (this.player.sprinting && ctl.forward > 0);
      ctl.toggleFly = frameInput.doubleSpace || input.wasPressed('KeyF') || tc.toggleFly;
      tc.toggleFly = false;
      if (tc.menu) { tc.menu = false; this.pause(); }
      if (tc.inventory) { tc.inventory = false; this.openInventory(); }
      for (let i = 0; i < 9; i++) {
        if (input.wasPressed('Digit' + (i + 1))) this.selectSlot(i);
      }
      if (frameInput.wheel) this.selectSlot((this.selected + frameInput.wheel + 9) % 9);
    }

    // hold on terrain until the spawn chunk exists
    const ready = this.world.isChunkReady(this.player.pos[0], this.player.pos[2]);
    if (ready && this.spawnPending) {
      const spot = this.findStandingSpot(Math.floor(this.player.pos[0]), Math.floor(this.player.pos[2]));
      this.player.pos = [spot[0] + 0.5, spot[1] + 0.02, spot[2] + 0.5];
      this.titleAnchor = this.player.pos.slice();
      this.spawnPending = false;
    }
    if (playing && ready && !this.spawnPending) {
      // fixed sub-steps keep movement identical at any frame rate
      let rem = dt;
      while (rem > 1e-6) {
        const step = Math.min(rem, 1 / 60);
        this.player.update(step, ctl);
        ctl.toggleFly = false;
        rem -= step;
      }
    }

    // time of day
    if (this.state !== 'paused') {
      const fast = playing && input.down('KeyT') ? 90 : 1;
      this.dayTime = (this.dayTime + (dt * fast) / (this.settings.dayLength * 60)) % 1;
      if (fast > 1 && this.ui.current === null) this.ui.toast('Time ' + clockText(this.dayTime), 400);
      this.cloudOffset[0] += dt * 3.2;
      this.cloudOffset[1] += dt * 1.1;
    }

    // weather
    if (this.state !== 'paused') {
      this.weather.update(dt, this.settings.weather, (distance) => this.audio.play('thunder', 'stone', 1.2 - distance * 0.7));
    }

    // camera
    const cam = this.computeCamera(dt);
    this.camera = cam;
    this.updatePrecipitation(dt, cam);

    // streaming and mesh uploads
    this.world.update(cam.pos[0], cam.pos[2], cam.forward[0], cam.forward[2]);
    this.uploadMeshes();
    this.updateLoading();

    // interaction
    this.selection = null;
    if (playing && !this.spawnPending) this.interact(dt);
    this.particles.update(dt);
    this.swing = Math.max(0, this.swing - dt * 4);

    // environment
    const eye = cam.pos;
    const [sl, bl] = this.world.getLight(Math.floor(eye[0]), Math.floor(eye[1]), Math.floor(eye[2]));
    this.eyeSky += (sl / 15 - this.eyeSky) * (1 - Math.exp(-dt * 1.5));
    this.eyeBlock = (this.eyeBlock || 0) + (bl / 15 - (this.eyeBlock || 0)) * (1 - Math.exp(-dt * 1.5));
    const sunY = Math.sin(this.dayTime * Math.PI * 2);
    this.audio.update({
      skyLight: this.eyeSky, day: sunY > 0 ? 1 : 0, underwater: this.player.headInWater && playing, altitude: eye[1],
      rain: this.precip.type === 'rain' ? this.precip.amount : 0, storm: this.weather.storm,
    });

    // autosave
    this.saveTimer += dt;
    if (this.saveTimer > 30 && this.world.dirtyEdits) {
      this.saveTimer = 0;
      this.save();
    }
    if (this.debug && this.ui.current === 'settings') this.ui.refreshLive('timeOfDay', this.dayTime);
  }

  // Once per install: if the first stretch of play runs well below 30 fps, step the preset down.
  autoQuality() {
    if (this.state !== 'playing' || this.settings.autoTuned || !this.loadingDone) return;
    this.perfSamples = this.perfSamples || [];
    this.perfSamples.push(this.fps);
    if (this.perfSamples.length < 16) return;
    const avg = this.perfSamples.reduce((a, b) => a + b, 0) / this.perfSamples.length;
    this.perfSamples = [];
    const order = ['low', 'medium', 'high', 'ultra'];
    const i = order.indexOf(this.settings.preset);
    if (avg < 26 && i > 0) {
      this.changeSetting('preset', order[i - 1]);
      if (this.settings.renderDistance > 8) this.changeSetting('renderDistance', 8);
      this.ui.toast(`Running at ${Math.round(avg)} fps, switched graphics to ${order[i - 1]}. Change it in Settings.`, 5000);
      if (i - 1 === 0) this.markTuned();
    } else {
      this.markTuned();
    }
  }

  markTuned() {
    this.settings.autoTuned = true;
    store.saveSettings(this.settings);
  }

  // What falls from the sky here (none in deserts, snow in the cold and on high peaks)
  // and a top-down map of the columns around the camera so roofs keep it off.
  updatePrecipitation(dt, cam) {
    this.biomeTimer -= dt;
    if (this.biomeTimer <= 0) {
      this.biomeTimer = 1;
      const col = this.world.generator.column(Math.floor(cam.pos[0]), Math.floor(cam.pos[2]));
      this.precipType = col.biome === BIOME.DESERT ? 'none' : col.biome === BIOME.SNOWY || col.temp < -0.42 || cam.pos[1] > 104 ? 'snow' : 'rain';
    }
    const amount = this.precipType === 'none' ? 0 : Math.max(0, (this.weather.rain - 0.15) / 0.85);
    this.precip.amount = amount;
    this.precip.type = this.precipType || 'rain';
    if (amount <= 0) return;
    const ox = Math.floor(cam.pos[0]) - 32, oz = Math.floor(cam.pos[2]) - 32;
    const key = ox + ',' + oz;
    const now = performance.now();
    if (key === this.rainMapKey && now - this.rainMapTime < 1500) return;
    this.rainMapKey = key;
    this.rainMapTime = now;
    const w = this.world, d = this.rainMapData;
    for (let z = 0; z < 64; z++) {
      for (let x = 0; x < 64; x++) {
        let y = 127;
        while (y > 0) {
          const b = w.getBlock(ox + x, y, oz + z);
          if (b && (IS_SOLID[b] || IS_LIQUID[b] || BLOCKS[b].wave === 1)) break;
          y--;
        }
        d[z * 64 + x] = y;
      }
    }
    this.renderer.updateRainMap(ox, oz, d);
  }

  selectSlot(i) {
    if (i === this.selected) return;
    this.selected = i;
    this.ui.renderHotbar(this.hotbar, this.selected);
    this.ui.showBlockName(BLOCKS[this.hotbar[i]].name);
  }

  computeCamera(dt) {
    const p = this.player;
    if (this.state === 'title' || this.state === 'boot') {
      this.titleAngle += dt * 0.025;
      const a = this.titleAnchor;
      const r = 34;
      const pos = [a[0] + Math.sin(this.titleAngle) * r, a[1] + 16, a[2] + Math.cos(this.titleAngle) * r];
      const target = [a[0], a[1] + 6, a[2]];
      let f = [target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]];
      const l = Math.hypot(...f);
      f = f.map((v) => v / l);
      // tilt up a little to show the sky
      f[1] += 0.12;
      const l2 = Math.hypot(...f);
      return { pos, forward: f.map((v) => v / l2), fov: (70 * Math.PI) / 180 };
    }
    const eye = p.eye;
    const fwd = p.forward();
    let bobY = 0, bobX = 0;
    if (this.settings.viewBobbing && !p.flying) {
      bobY = Math.abs(Math.sin(p.bobPhase)) * 0.055 * p.bobAmount;
      bobX = Math.cos(p.bobPhase) * 0.03 * p.bobAmount;
    }
    const right = [Math.cos(p.yaw), 0, -Math.sin(p.yaw)];
    const pos = [eye[0] + right[0] * bobX, eye[1] + bobY, eye[2] + right[2] * bobX];
    let fovTarget = this.settings.fov;
    if (p.sprinting) fovTarget *= p.flying ? 1.15 : 1.1;
    this.fovCurrent += (fovTarget - this.fovCurrent) * (1 - Math.exp(-dt * 10));
    return { pos, forward: fwd, fov: (this.fovCurrent * Math.PI) / 180 };
  }

  uploadMeshes() {
    const q = this.world.meshQueue;
    const t0 = performance.now();
    let n = 0;
    while (q.length && (n < 2 || performance.now() - t0 < 5)) {
      const { chunk, mesh } = q.shift();
      // skip meshes for chunks that were unloaded (possibly re-created) since the job started
      if (this.world.chunks.get(chunk.key) !== chunk) continue;
      this.renderer.uploadChunk(chunk, mesh);
      n++;
    }
  }

  updateLoading() {
    if (this.loadingDone) return;
    const p = this.state === 'title' || this.state === 'boot' ? this.titleAnchor : this.player.pos;
    const pcx = Math.floor(p[0] / CHUNK_SIZE), pcz = Math.floor(p[2] / CHUNK_SIZE);
    const R = 3;
    let total = 0, ready = 0;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > R * R) continue;
        total++;
        const c = this.world.getChunk(pcx + dx, pcz + dz);
        if (c && c.gpu) ready++;
      }
    }
    if (ready >= total) {
      this.loadingDone = true;
      this.ui.setLoading(null);
      this.renderer.exposureReset = true;
    } else {
      this.ui.setLoading(ready / total, `${ready} / ${total} chunks near you`);
    }
  }

  interact(dt) {
    const p = this.player;
    const eye = p.eye;
    const dir = p.forward();
    const hit = raycast(this.world, eye, dir, REACH);
    if (hit) this.selection = { min: [hit.box[0], hit.box[1], hit.box[2]], max: [hit.box[3], hit.box[4], hit.box[5]] };
    const input = this.input;
    const tc = input.touch;
    // a click that started and ended between two frames still counts
    const lmb = input.buttons.has(0) || input.clicked.has(0) || tc.breakHeld;
    const rmb = input.buttons.has(2) || input.clicked.has(2);
    this.breakTimer -= dt;
    this.placeTimer -= dt;
    if (input.clicked.has(0)) this.breakTimer = 0;
    if (input.clicked.has(2)) this.placeTimer = 0;
    if (lmb && this.breakTimer <= 0 && hit) {
      this.breakTimer = 0.24;
      this.breakBlock(hit);
    }
    if ((rmb && this.placeTimer <= 0) || tc.tap) {
      tc.tap = false;
      if (hit) {
        this.placeTimer = 0.24;
        this.placeBlock(hit);
      }
    }
    if (input.clicked.has(1) && hit) {
      const id = hit.block;
      const idx = this.hotbar.indexOf(id);
      if (idx >= 0) this.selectSlot(idx);
      else if (BLOCKS[id].inventory) {
        this.hotbar[this.selected] = id;
        this.ui.renderHotbar(this.hotbar, this.selected);
        this.ui.showBlockName(BLOCKS[id].name);
      }
    }
  }

  breakBlock(hit) {
    const { x, y, z, block } = hit;
    if (block === BLOCK.BEDROCK && y <= 0) return;
    if (!this.world.setBlock(x, y, z, 0)) return;
    const above = this.world.getBlock(x, y + 1, z);
    if (SHAPE_OF[above] === SHAPE.CROSS || SHAPE_OF[above] === SHAPE.TORCH) this.world.setBlock(x, y + 1, z, 0);
    const [sl, bl] = this.world.getLight(x + hit.normal[0], y + hit.normal[1], z + hit.normal[2]);
    this.particles.burst(x, y, z, block, sl / 15, bl / 15);
    this.audio.play('break', materialOf(BLOCKS[block]));
    this.swing = 1;
  }

  placeBlock(hit) {
    const id = this.hotbar[this.selected];
    if (!id) return;
    let x = hit.x, y = hit.y, z = hit.z;
    if (!BLOCKS[hit.block].replaceable) {
      x += hit.normal[0]; y += hit.normal[1]; z += hit.normal[2];
    }
    const cur = this.world.getBlock(x, y, z);
    if (!BLOCKS[cur].replaceable || cur === id) return;
    if (IS_SOLID[id] && this.player.intersectsBlock(x, y, z)) return;
    const shape = SHAPE_OF[id];
    if ((shape === SHAPE.CROSS || shape === SHAPE.TORCH || id === BLOCK.CACTUS) && !IS_SOLID[this.world.getBlock(x, y - 1, z)]) return;
    if (this.world.setBlock(x, y, z, id)) {
      this.audio.play('place', materialOf(BLOCKS[id]));
      this.swing = 1;
    }
  }

  // ------------------------------------------------------------------ rendering
  handState() {
    const id = this.hotbar[this.selected];
    const d = BLOCKS[id];
    if (!d || !d.tex || this.state !== 'playing' || this.hudHidden) return null;
    const p = this.player;
    const flat = d.shape === SHAPE.CROSS || d.shape === SHAPE.TORCH;
    const bob = this.settings.viewBobbing ? p.bobAmount : 0;
    const bx = Math.cos(p.bobPhase) * 0.035 * bob;
    const by = -Math.abs(Math.sin(p.bobPhase)) * 0.04 * bob;
    const sw = Math.sin(this.swing * Math.PI);
    const tx = 0.56 + bx - sw * 0.12, ty = -0.52 + by - sw * 0.18, tz = -0.95 + sw * 0.1;
    if (flat) mat4.fromTRS(this.handModel, tx, ty + 0.05, tz, -0.1 - sw * 0.6, -0.35, 0.1, 0.5, 0.5, 0.04);
    else mat4.fromTRS(this.handModel, tx, ty, tz, 0.3 - sw * 0.9, 0.78, 0.0, 0.36);
    const e = p.eye;
    const [sl, bl] = this.world.getLight(Math.floor(e[0]), Math.floor(e[1]), Math.floor(e[2]));
    const tex = FACE_TEX;
    const side = tex[id * 4 + 2];
    return {
      visible: true,
      model: this.handModel,
      layers: flat ? [side, side, side, 1] : [tex[id * 4], tex[id * 4 + 1], side, d.layer === 1 ? 1 : 0],
      sky: sl / 15,
      block: Math.max(bl, d.emission) / 15,
      tint: d.tint && d.tint !== TINT.WATER ? 1 : 0,
      tintColor: TINT_RGB[d.tint] || [1, 1, 1],
      mat: d.mat === MAT.WATER ? MAT.GLOSSY : d.mat,
    };
  }

  renderFrame(dt) {
    const cam = this.camera;
    const sunY = Math.sin(this.dayTime * Math.PI * 2);
    // morning mist near sunrise, clearer at noon
    const morning = Math.exp(-Math.pow((this.dayTime - 0.02) / 0.06, 2)) + Math.exp(-Math.pow((this.dayTime - 0.98) / 0.05, 2));
    const rain = this.weather ? this.weather.rain : 0;
    const fog = {
      density: (0.0011 + morning * 0.0045 + (sunY < 0 ? 0.001 : 0)) * (1 + rain * 3.5) + rain * 0.002,
      falloff: 0.03 * (1 - rain * 0.5),
    };
    const state = {
      camera: cam,
      chunks: this.world.chunks.values(),
      renderDistance: this.world.renderDistance,
      dayTime: this.dayTime,
      fog,
      underwater: this.state === 'playing' && this.player.headInWater,
      waterDepth: this.player.headInWater ? this.waterDepthAbove() : 0,
      eyeSky: this.eyeSky,
      eyeBlock: this.eyeBlock || 0,
      wind: 1,
      cloudCoverage: this.settings.cloudCoverage,
      cloudOffset: this.cloudOffset,
      brightness: this.settings.brightness,
      weather: {
        rain: this.weather.rain,
        storm: this.weather.storm,
        wetness: this.precipType === 'none' ? 0 : this.weather.wetness,
        flash: this.weather.flash,
        snow: this.precip.type === 'snow',
      },
      precip: this.precip,
      selection: this.hudHidden ? null : this.selection,
      particles: this.particles,
      hand: this.handState(),
    };
    this.renderer.render(state, dt);
  }

  // Open ground near (x, z): a solid, non-foliage top block with two free blocks above it.
  findStandingSpot(x0, z0) {
    const w = this.world;
    for (let r = 0; r <= 10; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = x0 + dx, z = z0 + dz;
          if (!w.isChunkReady(x, z)) continue;
          const y = w.surfaceHeight(x, z);
          const top = BLOCKS[w.getBlock(x, y, z)];
          if (!top || !IS_SOLID[top.id] || top.wave === 1 || top.key.endsWith('_log') || IS_LIQUID[top.id]) continue;
          if (IS_SOLID[w.getBlock(x, y + 1, z)] || IS_SOLID[w.getBlock(x, y + 2, z)]) continue;
          return [x, y + 1, z];
        }
      }
    }
    return [x0, w.surfaceHeight(x0, z0) + 1, z0];
  }

  // Blocks of water between the eye and the surface above it.
  waterDepthAbove() {
    const e = this.camera.pos;
    const x = Math.floor(e[0]), z = Math.floor(e[2]);
    let y = Math.floor(e[1]);
    let d = 0;
    while (d < 40 && IS_LIQUID[this.world.getBlock(x, y + 1, z)]) { y++; d++; }
    return d + (1 - (e[1] - Math.floor(e[1])));
  }

  debugText() {
    const p = this.player;
    const r = this.renderer;
    const x = Math.floor(p.pos[0]), y = Math.floor(p.pos[1]), z = Math.floor(p.pos[2]);
    const col = this.world.generator.column(x, z);
    const [sl, bl] = this.world.getLight(x, Math.floor(p.pos[1] + 1), z);
    const yawDeg = ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'][Math.round(yawDeg / 90) % 4];
    const gl = r.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    const t = r.targets;
    return [
      `Lumencraft  ${this.fps.toFixed(0)} fps  (${this.frameMs.toFixed(1)} ms cpu)`,
      `XYZ ${p.pos[0].toFixed(2)} ${p.pos[1].toFixed(2)} ${p.pos[2].toFixed(2)}`,
      `Chunk ${Math.floor(x / 16)} ${Math.floor(z / 16)}   facing ${facing}`,
      `Biome ${BIOME_NAMES[col.biome]}   light sky ${sl} block ${bl}`,
      `Time ${clockText(this.dayTime)}   weather ${this.weather.describe()}${this.precip.type !== 'rain' ? ' (' + this.precip.type + ')' : ''}   ${p.flying ? 'flying' : p.inWater ? 'swimming' : p.onGround ? 'on ground' : 'airborne'}`,
      `Chunks ${this.world.chunks.size} loaded, ${r.stats.chunks} drawn, ${r.stats.shadowChunks} in shadow pass`,
      `Draws ${r.stats.draws}   tris ${(r.stats.tris / 1000).toFixed(0)}k`,
      `Render ${t ? t.w + 'x' + t.h : ''}  preset ${this.settings.preset}  shadows ${this.settings.shadows ? this.settings.shadowRes : 'off'}`,
      `Seed ${this.world.seed}`,
      gpu ? `GPU ${String(gpu).slice(0, 60)}` : '',
    ].filter(Boolean).join('\n');
  }
}
