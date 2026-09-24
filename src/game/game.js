// Game controller: world lifecycle, player, interaction, time of day, UI state, frame loop.

import { World } from '../world/world.js';
import { Renderer, QUALITY_PRESETS } from '../render/renderer.js';
import { generateTextures, buildTextureArrays } from '../world/textures.js';
import { Player } from './player.js';
import { Input, TouchControls } from './input.js';
import { Audio, materialOf } from './audio.js';
import { Particles } from './particles.js';
import { Weather } from './weather.js';
import * as store from './save.js';
import { BLOCK, BLOCKS, FACE_TEX, IS_SOLID, IS_LIQUID, CHUNK_SIZE } from '../world/blocks.js';
import { clockText, PRESET_ORDER } from '../ui/ui.js';
import { t, tList, setLanguage, detectLanguage } from '../ui/i18n.js';
import { buildIcons, buildItemIcons } from '../ui/icons.js';
import { BIOME } from '../world/generator.js';
import { mat4 } from '../engine/math.js';
import { installPlay } from './play.js';
import { detectPreset, collectDeviceInfo, isTvDevice } from './device.js';
import { Gamepads, PAD } from './gamepad.js';
import { FocusNav } from '../ui/focusnav.js';

// 2: survival (game mode, difficulty, inventory with counts, health). Version 1 saves load as creative worlds.
const SAVE_VERSION = 2;
const SAVE_VERSIONS = [1, 2];

export function defaultSettings() {
  const preset = detectPreset();
  return {
    preset,
    ...QUALITY_PRESETS[preset],
    renderDistance: { lite: 4, low: 6, medium: 7, high: 9, ultra: 10 }[preset] || 7,
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
    language: detectLanguage(),
    texturePack: preset === 'high' || preset === 'ultra' ? 'hd' : 'pixel',
    dynamicRes: preset === 'lite' || preset === 'low',
    targetFps: 30,
    padSensitivity: 1,
    padInvertY: false,
    padVibration: true,
    touchSize: 1,
    touchOpacity: 0.7,
    touchSensitivity: 1,
    touchHaptics: true,
  };
}

function seedFromString(s) {
  if (!s) return (Math.random() * 2 ** 31) | 0;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h | 0;
}

// average canopy colours for falling leaves
const LEAF_TINT = {
  [BLOCK.OAK_LEAVES]: [0.42, 0.66, 0.26], [BLOCK.BIRCH_LEAVES]: [0.55, 0.68, 0.33], [BLOCK.SPRUCE_LEAVES]: [0.36, 0.52, 0.36],
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
    // settings added since the save was written follow the saved preset
    const preset = QUALITY_PRESETS[this.settings.preset];
    if (saved && preset) for (const k of Object.keys(preset)) if (!(k in saved)) this.settings[k] = preset[k];
    // settings v3: leaf cards and 3D grass became opt-in (lighter and cleaner by default)
    if (saved && (saved.settingsVersion || 0) < 3) {
      this.settings.fancyLeaves = false;
      this.settings.grass3d = preset ? preset.grass3d : false;
      this.settings.grassShadows = false;
    }
    this.settings.settingsVersion = 3;
    if (this.opts.settingsOverride) Object.assign(this.settings, this.opts.settingsOverride);
    // interface icons always come from the pixel-art pack; the world can use either pack
    this.pixelTextures = generateTextures('pixel');
    this.textures = this.settings.texturePack === 'hd' ? generateTextures('hd') : this.pixelTextures;
    const arrays = buildTextureArrays(this.textures);
    this.renderer = new Renderer(this.canvas, arrays, this.settings);
    this.icons = buildIcons(this.pixelTextures);
    this.setupPlay();
    buildItemIcons(this.itemSprites, this.icons);
    this.ui.buildInventory(this.icons);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.raf);
      this.save();
      this.ui.showError(t('err.contextLost'));
    });
    this.input = new Input(this.canvas);
    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onLockError = () => {
      if (this.state === 'playing') this.ui.setLockHint(true);
    };
    if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
      this.touch = new TouchControls(document.getElementById('app'), this.input, { settings: () => this.settings, t });
    }
    this.audio = new Audio();
    this.audio.setVolume(this.settings.volume);
    this.audio.ambientOn = this.settings.ambience;
    this.pads = new Gamepads();
    this.pads.onConnect = (p) => this.ui.toast(t('toast.padConnected', { name: String(p.id).replace(/\s*\(.*$/, '').slice(0, 40) }), 3000);
    this.pads.onDisconnect = () => this.ui.toast(t('toast.padDisconnected'), 2500);
    this.nav = new FocusNav();
    this.padSprint = false;
    this.lastPadA = 0;
    this.bindUi();

    const data = this.opts.freshWorld ? null : await store.loadWorld();
    const usable = data && SAVE_VERSIONS.includes(data.version);
    const seed = this.opts.seed !== undefined ? this.opts.seed : usable ? data.seed : seedFromString('');
    if (this.opts.mode) this.newWorldMode = this.opts.mode;
    this.loadWorld(seed, usable && data.seed === seed ? data : null);
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
    this.world = new World(seed, { renderDistance: this.settings.renderDistance, workers, edits, meshOptions: { fancyLeaves: this.settings.fancyLeaves !== false } });
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
    this.dayCount = data && Number.isInteger(data.dayCount) ? data.dayCount : 0;
    this.selected = data && Number.isInteger(data.selected) && data.selected >= 0 && data.selected < 9 ? data.selected : 0;
    this.titleAnchor = this.player.pos.slice();
    this.loadingDone = false;
    this.setupWorldPlay(data);
    this.ui.setTitleMeta({ seed, saved: !!data });
    this.ui.setPlayLabel(data ? 'title.continue' : 'title.play');
    this.player.onStep = (b) => this.audio.play('step', b < 0 ? 'water' : materialOf(BLOCKS[b]), 0.8);
    this.player.onLand = (speed, b) => {
      if (speed > 6) this.audio.play('step', materialOf(BLOCKS[b]), 1.4);
      this.onLandDamage(speed);
    };
    this.player.onSplash = () => this.audio.play('splash');
    this.renderer.resetHistory();
    this.world.dirtyEdits = false;
  }

  async save() {
    if (!this.world || !this.player || this.state === 'boot') return;
    const me = this.me();
    const data = {
      version: SAVE_VERSION,
      seed: this.world.seed,
      player: {
        pos: this.player.pos, yaw: this.player.yaw, pitch: this.player.pitch, flying: this.player.flying,
        health: me ? me.health : undefined, air: me ? me.air : undefined,
      },
      dayTime: this.dayTime,
      dayCount: this.dayCount || 0,
      selected: this.selected,
      ...this.serializePlay(),
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
    ui.on('openDevice', () => {
      ui.showDevice(collectDeviceInfo(this));
      ui.push('device');
      clearInterval(this.deviceTimer);
      this.deviceTimer = setInterval(() => {
        if (ui.current !== 'device') { clearInterval(this.deviceTimer); return; }
        ui.showDevice(collectDeviceInfo(this));
      }, 1000);
    });
    ui.on('openNewWorld', () => {
      document.getElementById('seed-input').value = '';
      ui.syncNewWorld();
      ui.push('newworld');
      setTimeout(() => document.getElementById('seed-input').focus(), 40);
    });
    ui.on('back', () => ui.pop());
    ui.on('toTitle', async () => { await this.save(); this.enterTitle(); });
    ui.on('createWorld', async (seedText, opts = {}) => {
      this.newWorldMode = opts.mode || 'survival';
      this.newWorldDifficulty = opts.difficulty || 'normal';
      await store.deleteWorld();
      this.loadWorld(seedFromString(seedText), null);
      this.enterTitle();
      this.ui.toast(t('toast.newWorld'));
    });
    ui.on('pickBlock', (id) => this.pickItem(id));
    ui.on('selectSlot', (i) => {
      if (this.state === 'playing') this.selectSlot(i);
      else {
        this.selected = i;
        this.refreshInventoryUI();
      }
    });
    ui.on('invSlot', (i) => this.clickInventorySlot(i));
    ui.on('craft', (i) => this.craft(i));
    ui.on('respawn', () => this.respawn());
    ui.on('setLanguage', (lang) => this.changeSetting('language', lang));
    ui.on('screen', (name) => this.nav.setRoot(name ? document.getElementById(name) : null));
    // arrow keys / OK on a TV remote (or a keyboard) move through menus
    document.addEventListener('keydown', (e) => this.onMenuKey(e), true);
    window.addEventListener('pointerdown', () => document.documentElement.classList.remove('pad-nav'), true);
    // the Back key of TV remotes and Android navigates history: turn it into the in-game back action
    if (window.top === window && (isTvDevice() || matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches)) {
      try {
        history.pushState({ lumen: true }, '');
        window.addEventListener('popstate', () => {
          if (this.handleBack()) history.pushState({ lumen: true }, '');
        });
      } catch (e) { /* ignore */ }
    }
    this.canvas.addEventListener('click', () => {
      this.audio.unlock();
      if (this.state === 'playing' && !this.input.locked && !this.input.lockFailed) this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => this.onGlobalKey(e));
  }

  changeSetting(key, value, live) {
    const s = this.settings;
    const leavesBefore = s.fancyLeaves;
    if (key === 'preset') {
      Object.assign(s, QUALITY_PRESETS[value]);
      s.preset = value;
      if (this.state !== 'playing') s.autoTuned = true;
    } else {
      s[key] = value;
      if (['shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa', 'grass3d', 'fancyLeaves', 'pom'].includes(key)) s.preset = 'custom';
    }
    if (s.fancyLeaves !== leavesBefore && this.world) this.world.setMeshOptions({ fancyLeaves: s.fancyLeaves });
    if (key === 'texturePack') this.applyTexturePack(value);
    if (key === 'timeOfDay') this.dayTime = value;
    if (key === 'gameMode' && this.sim && value !== this.mode) this.setMode(value);
    if (key === 'difficulty' && this.sim) this.setDifficulty(value);
    if (key === 'renderDistance') {
      this.world.renderDistance = value;
      this.world.lastCx = null; // re-scan the neighbourhood with the new radius
    }
    if (key === 'language') {
      setLanguage(value);
      this.ui.refreshLanguage();
      if (this.touch) this.touch.refreshLabels();
    }
    if (key.startsWith('touch') && this.touch) this.touch.applySettings();
    if (key === 'volume') this.audio.setVolume(value);
    if (key === 'ambience') this.audio.ambientOn = value;
    const graphics = ['preset', 'renderScale', 'shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa', 'grass3d', 'grassShadows', 'pom'];
    if (!live && graphics.includes(key)) this.renderer.applySettings(s);
    store.saveSettings(s);
  }

  applyTexturePack(pack) {
    this.textures = pack === 'hd' ? generateTextures('hd') : this.pixelTextures;
    this.renderer.setTextureArrays(buildTextureArrays(this.textures));
  }

  onGlobalKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    const code = e.code;
    if (code === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      // (while pointer-locked, Esc releases the lock first and the lock change pauses)
      if (!(this.state === 'playing' && this.input.locked)) {
        if (this.handleBack()) e.preventDefault();
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

  // The shared "back" action: Esc, controller B, a TV remote's Back key. Returns false when there
  // was nothing to go back from (the title screen), so the platform can handle it.
  handleBack() {
    if (this.state === 'dead' && this.ui.current === 'death') return true;
    if (this.state === 'inventory') { this.closeInventory(); return true; }
    if (this.state === 'playing') { this.pause(); return true; }
    if (['settings', 'help', 'newworld', 'device'].includes(this.ui.current)) { this.ui.pop(); return true; }
    if (this.state === 'paused') { this.play(); return true; }
    return false;
  }

  menuOpen() {
    return this.state === 'inventory' || this.state === 'dead' || (this.state !== 'playing' && this.ui.current !== null);
  }

  // Arrow keys and OK / Enter in menus (TV remotes send these).
  onMenuKey(e) {
    if (!this.menuOpen()) return;
    const el = document.activeElement;
    if (el && el.tagName === 'INPUT' && el.type === 'text') return;
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    const dir = dirs[e.key];
    if (dir) {
      // sliders keep left / right for their value
      if (el && el.type === 'range' && (dir === 'left' || dir === 'right')) return;
      e.preventDefault();
      e.stopPropagation();
      document.documentElement.classList.add('pad-nav');
      this.nav.move(dir);
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Select') && el && el.type === 'checkbox') {
      e.preventDefault();
      el.click();
    }
    if (e.key === 'Backspace' && !(el && el.tagName === 'INPUT')) {
      e.preventDefault();
      this.handleBack();
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
    const padUser = this.pads.connected && performance.now() - this.pads.lastActive < 1500;
    if ((!this.touch || !this.input.touch.active) && !padUser) {
      if (!this.input.lockFailed) this.input.requestLock();
    }
    this.ui.setLockHint(this.input.lockFailed && !this.touch && !padUser, this.input.lockFailed ? 'hud.dragHint' : 'hud.lockHint');
    if (this.input.lockFailed && !this.touch) setTimeout(() => this.ui.setLockHint(false), 4000);
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
    this.refreshInventoryUI();
    this.ui.show('inventory');
    this.breaking = null;
    this.bowDraw = 0;
  }

  closeInventory() {
    this.ui.show(null);
    this.state = 'playing';
    this.input.enabled = true;
    const padUser = this.pads.connected && performance.now() - this.pads.lastActive < 1500;
    if (!this.input.lockFailed && !this.touch && !padUser) this.input.requestLock();
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
        this.ui.toast(t('toast.error', { msg: err.message }), 6000);
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
      this.updateDynamicResolution(real);
    }
    this.input.endFrame();
  }

  update(dt) {
    const input = this.input;
    const playing = this.state === 'playing';
    const frameInput = input.consumeFrame();
    let ctl = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false, toggleFly: false, autoJump: this.settings.autoJump };
    const pad = this.pads.poll();
    if (pad.connected) {
      this.ui.setPadStyle(pad.style);
      this.updatePadMenus(pad);
    }

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
      // (no Ctrl for sprint: Ctrl+W would close the browser tab)
      ctl.sprint = ctl.sprint || k('KeyR') || frameInput.doubleW || (this.player.sprinting && ctl.forward > 0);
      ctl.toggleFly = frameInput.doubleSpace || input.wasPressed('KeyF') || tc.toggleFly;
      tc.toggleFly = false;
      if (tc.menu) { tc.menu = false; this.pause(); }
      if (tc.inventory) { tc.inventory = false; this.openInventory(); }
      for (let i = 0; i < 9; i++) {
        if (input.wasPressed('Digit' + (i + 1))) this.selectSlot(i);
      }
      if (frameInput.wheel) this.selectSlot((this.selected + frameInput.wheel + 9) % 9);
      if (pad.connected && this.state === 'playing') this.applyPadControls(pad, ctl, dt);
      if (!this.isCreative()) { ctl.toggleFly = false; if (this.player.flying) this.player.flying = false; }
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

    // creatures, items, arrows, health
    this.updatePlay(dt);

    // time of day
    if (this.state !== 'paused') {
      const fast = playing && (input.down('KeyT') || pad.down(PAD.UP)) ? 90 : 1;
      this.dayTime += (dt * fast) / (this.settings.dayLength * 60);
      if (this.dayTime >= 1) { this.dayTime -= 1; this.dayCount = (this.dayCount || 0) + 1; }
      if (fast > 1 && this.ui.current === null) this.ui.toast(t('toast.time', { time: clockText(this.dayTime) }), 400);
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
    this.spawnLeaves(dt, cam);
    this.particles.update(dt, [1.2 + this.weather.storm * 2.5, 0.4 + this.weather.storm], performance.now() / 1000);
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

  // Leaves now and then let go of the canopy above and around the camera (more in wind and rain).
  spawnLeaves(dt, cam) {
    if (this.state === 'boot' || !this.settings.fancyLeaves) return;
    this.leafTimer = (this.leafTimer || 0) - dt;
    if (this.leafTimer > 0) return;
    this.leafTimer = 0.12 / (1 + this.weather.storm * 2);
    const w = this.world;
    for (let tries = 0; tries < 4; tries++) {
      const x = Math.floor(cam.pos[0] + (Math.random() - 0.5) * 28);
      const z = Math.floor(cam.pos[2] + (Math.random() - 0.5) * 28);
      const y0 = Math.floor(cam.pos[1]);
      for (let y = y0 + 10; y > y0 - 8; y--) {
        const b = w.getBlock(x, y, z);
        const d = BLOCKS[b];
        if (!d || d.wave !== 1) continue; // leaves
        if (w.getBlock(x, y - 1, z) !== 0) break;
        const [sl, bl] = w.getLight(x, y - 1, z);
        const tint = LEAF_TINT[b] || [0.45, 0.68, 0.28];
        this.particles.leaf(x + Math.random(), y - 0.05, z + Math.random(), FACE_TEX[b * 4 + 2], tint, sl / 15, bl / 15);
        return;
      }
    }
  }

  // Controller in the game world: sticks, triggers, face buttons, bumpers, D-pad.
  applyPadControls(pad, ctl, dt) {
    const [lx, ly] = pad.left;
    if (Math.abs(ly) > 0.001) ctl.forward = -ly;
    if (Math.abs(lx) > 0.001) ctl.strafe = lx;
    if (pad.pressed(PAD.LS)) this.padSprint = !this.padSprint;
    if (ctl.forward < 0.3) this.padSprint = false;
    ctl.sprint = ctl.sprint || this.padSprint;
    // look: a gentle curve for aiming, speeding up while the stick is held at the edge
    const [rx, ry] = pad.right;
    const mag = Math.hypot(rx, ry);
    this.padEdge = mag > 0.93 ? (this.padEdge || 0) + dt : 0;
    if (mag > 0) {
      const curve = Math.pow(mag, 1.8) / mag;
      const boost = 1 + Math.min(1, Math.max(0, (this.padEdge - 0.25) / 0.4)) * 0.7;
      const rate = 2.7 * boost * curve; // radians per second at full tilt
      const px = (rx * rate * dt) / 0.0022, py = (ry * rate * 0.75 * dt) / 0.0022;
      this.player.look(px, py, this.settings.padSensitivity || 1, this.settings.padInvertY);
    }
    ctl.jump = ctl.jump || pad.down(PAD.A);
    if (pad.pressed(PAD.A)) {
      const now = performance.now();
      if (now - this.lastPadA < 300) ctl.toggleFly = true;
      this.lastPadA = now;
    }
    ctl.sneak = ctl.sneak || pad.down(PAD.B);
    if (pad.pressed(PAD.X)) ctl.toggleFly = true;
    if (pad.pressed(PAD.Y)) { this.openInventory(); return; }
    if (pad.pressed(PAD.LB) || pad.pressed(PAD.LEFT)) this.selectSlot((this.selected + 8) % 9);
    if (pad.pressed(PAD.RB) || pad.pressed(PAD.RIGHT)) this.selectSlot((this.selected + 1) % 9);
    if (pad.pressed(PAD.DOWN)) { this.hudHidden = !this.hudHidden; this.ui.setHud(!this.hudHidden); }
    if (pad.pressed(PAD.VIEW)) { this.debug = !this.debug; if (!this.debug) this.ui.setDebug(null); }
    if (pad.pressed(PAD.MENU)) this.pause();
    this.ui.setLockHint(false);
  }

  // Controller in menus: D-pad / left stick move the focus, A chooses, B goes back.
  updatePadMenus(pad) {
    if (pad.pressed(PAD.A) || pad.pressed(PAD.MENU)) this.audio.unlock();
    if (!this.menuOpen()) return;
    const dir = pad.navDirection();
    if (dir) {
      if ((dir === 'left' || dir === 'right') && this.nav.adjust(dir === 'left' ? -1 : 1)) return;
      this.nav.move(dir);
    }
    if (pad.pressed(PAD.A)) this.nav.activate();
    if (pad.pressed(PAD.B)) this.handleBack();
    if (pad.pressed(PAD.MENU)) {
      if (this.state === 'paused' && this.ui.current === 'pause') this.play();
      else if (this.state === 'title' && this.ui.current === 'title') this.play();
    }
    if (this.state === 'inventory') {
      if (pad.pressed(PAD.Y)) this.closeInventory();
      if (pad.pressed(PAD.LB)) this.selectSlot((this.selected + 8) % 9, true);
      if (pad.pressed(PAD.RB)) this.selectSlot((this.selected + 1) % 9, true);
    } else if (this.ui.current === 'settings') {
      if (pad.pressed(PAD.LB)) this.ui.switchSettingsTab(-1);
      if (pad.pressed(PAD.RB)) this.ui.switchSettingsTab(1);
    }
  }

  // Once per install: if the first stretch of play runs well below 30 fps, step the preset down.
  autoQuality() {
    if (this.state !== 'playing' || this.settings.autoTuned || !this.loadingDone) return;
    this.perfSamples = this.perfSamples || [];
    this.perfSamples.push(this.fps);
    if (this.perfSamples.length < 16) return;
    const avg = this.perfSamples.reduce((a, b) => a + b, 0) / this.perfSamples.length;
    this.perfSamples = [];
    const order = PRESET_ORDER;
    const i = order.indexOf(this.settings.preset);
    if (avg < 26 && i > 0) {
      this.changeSetting('preset', order[i - 1]);
      if (this.settings.renderDistance > 8) this.changeSetting('renderDistance', 8);
      this.ui.toast(t('toast.autoQuality', { fps: Math.round(avg), preset: t('preset.' + order[i - 1]) }), 5000);
      if (i - 1 === 0) this.markTuned();
    } else {
      this.markTuned();
    }
  }

  // Dynamic resolution: every half second, compare the frame rate with the target and move the
  // render scale in small steps (down quickly, up slowly), never above the chosen resolution scale.
  // Frames limited by the CPU (world streaming, meshing) are left alone: fewer pixels won't help.
  updateDynamicResolution() {
    const r = this.renderer;
    if (!r) return;
    if (!this.settings.dynamicRes || this.state !== 'playing' || !this.loadingDone) {
      if (!this.settings.dynamicRes) r.dynScale = 1;
      this.dynGood = 0;
      return;
    }
    const target = this.settings.targetFps || 30;
    const fps = this.fps;
    const interval = 1000 / Math.max(fps, 1);
    const cpuBound = this.frameMs > interval * 0.75;
    const cur = r.dynScale || 1;
    let next = cur;
    this.dynCooldown = Math.max(0, (this.dynCooldown || 0) - 1);
    if (this.dynCooldown > 0) return;
    if (fps < target * 0.88 && !cpuBound && cur > 0.5) {
      // bigger steps when far below the target
      const step = fps < target * 0.6 ? 0.15 : 0.08;
      next = Math.max(0.5, cur - step);
      this.dynGood = 0;
    } else if (fps > target * 1.15 || fps > 58) {
      this.dynGood = (this.dynGood || 0) + 1;
      if (this.dynGood >= 6 && cur < 1) { next = Math.min(1, cur + 0.05); this.dynGood = 0; }
    } else this.dynGood = 0;
    if (Math.abs(next - cur) > 1e-3) {
      r.dynScale = next;
      this.dynCooldown = 3;
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
    // the map covers 64x64 columns and the rain box only 52x52, so it can lag a few blocks behind
    const ox = Math.floor(cam.pos[0] / 4) * 4 - 32, oz = Math.floor(cam.pos[2] / 4) * 4 - 32;
    const key = ox + ',' + oz;
    const now = performance.now();
    if (key === this.rainMapKey && now - this.rainMapTime < 2000) return;
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
    if (this.shake > 0) {
      const k = this.shake * this.shake * 0.09, tm = performance.now() / 1000;
      pos[0] += Math.sin(tm * 53) * k; pos[1] += Math.sin(tm * 61 + 1) * k; pos[2] += Math.sin(tm * 47 + 2) * k;
    }
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
    // chunks stream in around the camera (which circles the anchor on the title screen), so wait
    // for the ones around the camera, within a radius the render distance can actually mesh
    const p = this.state === 'title' || this.state === 'boot' ? (this.camera ? this.camera.pos : this.titleAnchor) : this.player.pos;
    const pcx = Math.floor(p[0] / CHUNK_SIZE), pcz = Math.floor(p[2] / CHUNK_SIZE);
    const R = Math.max(1, Math.min(3, this.world.renderDistance - 2));
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
      this.ui.setLoading(ready / total, t('load.chunks', { ready, total }));
    }
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
      // eight phases, one per day, starting from a full moon on the first night
      moonPhase: (((this.dayCount || 0) + 4) % 8) / 8,
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
      entities: this.buildEntities(),
      playerFeet: this.state === 'playing' ? this.player.pos : null,
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
    const facing = tList('dbg.dirs')[Math.round(yawDeg / 90) % 4];
    const gl = r.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    const tg = r.targets;
    const motion = p.flying ? 'dbg.flying' : p.inWater ? 'dbg.swimming' : p.onGround ? 'dbg.onGround' : 'dbg.airborne';
    return [
      `Lumencraft  ${this.fps.toFixed(0)} fps  (${this.frameMs.toFixed(1)} ms ${t('dbg.cpu')})`,
      `XYZ ${p.pos[0].toFixed(2)} ${p.pos[1].toFixed(2)} ${p.pos[2].toFixed(2)}`,
      `Chunk ${Math.floor(x / 16)} ${Math.floor(z / 16)}   ${t('dbg.facing')} ${facing}`,
      `${t('dbg.biome')} ${tList('biomes')[col.biome]}   ${t('dbg.light', { sky: sl, block: bl })}`,
      `${t('dbg.time')} ${clockText(this.dayTime)}   ${t('dbg.weather')} ${this.weather.describe()}${this.precip.type !== 'rain' ? ' (' + this.precip.type + ')' : ''}   ${t(motion)}`,
      t('dbg.chunks', { loaded: this.world.chunks.size, drawn: r.stats.chunks, shadow: r.stats.shadowChunks }),
      `Draws ${r.stats.draws}   tris ${(r.stats.tris / 1000).toFixed(0)}k`,
      this.sim ? t('dbg.entities', { n: this.sim.entities.size, mode: t('mode.' + this.mode), diff: t('diff.' + this.difficulty) }) : '',
      t('dbg.render', { size: tg ? tg.w + 'x' + tg.h + ((r.dynScale || 1) < 1 ? ` (${Math.round(r.dynScale * 100)}%)` : '') : '', preset: t('preset.' + this.settings.preset), shadows: this.settings.shadows ? this.settings.shadowRes : t('dbg.off') }),
      `${t('dbg.seed')} ${this.world.seed}`,
      gpu ? `GPU ${String(gpu).slice(0, 60)}` : '',
    ].filter(Boolean).join('\n');
  }
}

installPlay(Game);
