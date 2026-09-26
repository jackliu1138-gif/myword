// DOM user interface: screens, settings, hotbar, inventory, toasts, help, device check, debug overlay.

import { BLOCKS, BLOCK } from '../world/blocks.js';
import { t, itemName, applyI18n, getLanguage } from './i18n.js';
import { GLYPHS } from '../game/gamepad.js';
import { ITEMS, RECIPES, itemDef } from '../sim/items.js';
import { ARMOR_REF } from '../sim/inventory.js';

// Creative palette tabs: which blocks count as natural (the rest of the blocks are for building)
const NATURE = new Set(['stone', 'grass', 'dirt', 'sand', 'gravel', 'clay', 'snow', 'ice', 'cactus', 'oak_log', 'birch_log', 'spruce_log',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'tall_grass', 'fern', 'poppy', 'dandelion', 'cornflower', 'dead_bush', 'pumpkin',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'obsidian', 'netherrack', 'soul_sand', 'nether_quartz_ore', 'magma_block',
  'ancient_debris', 'glowstone', 'end_stone', 'dragon_egg', 'lava', 'water']);
const PALETTE_TABS = ['all', 'building', 'nature', 'tools', 'combat', 'food', 'misc'];
function paletteTab(d) {
  if (d.kind === 'block') return NATURE.has(d.key) ? 'nature' : 'building';
  if (['sword', 'bow', 'arrow', 'armor'].includes(d.kind)) return 'combat';
  if (['pickaxe', 'axe', 'shovel', 'hoe', 'igniter', 'pearl', 'eye'].includes(d.kind)) return 'tools';
  if (d.kind === 'food') return 'food';
  return 'misc';
}

const $ = (id) => document.getElementById(id);

const PRESET_KEYS = ['shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa', 'grass3d', 'fancyLeaves', 'pom'];
export const PRESET_ORDER = ['lite', 'low', 'medium', 'high', 'ultra'];

const pct = (v) => Math.round(v * 100) + '%';

// Settings screen layout. Labels and descriptions are i18n keys.
const SCHEMA = [
  {
    tab: 'general',
    items: [
      { key: 'language', type: 'choice', label: 'set.language', full: true, options: [['zh', '中文'], ['en', 'English']], raw: true },
    ],
  },
  {
    tab: 'graphics',
    items: [
      { key: 'preset', type: 'preset', label: 'set.preset', full: true, desc: 'set.preset.desc' },
      { key: 'texturePack', type: 'choice', label: 'set.texturePack', full: true, options: [['pixel', 'pack.pixel'], ['hd', 'pack.hd']], desc: 'set.texturePack.desc' },
      { key: 'renderDistance', type: 'range', label: 'set.renderDistance', min: 3, max: 16, step: 1, fmt: (v) => t('unit.chunks', { n: v }) },
      { key: 'renderScale', type: 'range', label: 'set.renderScale', min: 0.35, max: 1, step: 0.05, fmt: pct },
      { key: 'dynamicRes', type: 'toggle', label: 'set.dynamicRes', desc: 'set.dynamicRes.desc' },
      { key: 'targetFps', type: 'choice', label: 'set.targetFps', options: [[30, '30'], [45, '45'], [60, '60']], raw: true, num: true },
      { key: 'shadows', type: 'toggle', label: 'set.shadows', desc: 'set.shadows.desc' },
      { key: 'clouds', type: 'toggle', label: 'set.clouds', desc: 'set.clouds.desc' },
      { key: 'volumetric', type: 'toggle', label: 'set.volumetric', desc: 'set.volumetric.desc' },
      { key: 'ssr', type: 'toggle', label: 'set.ssr', desc: 'set.ssr.desc' },
      { key: 'ssao', type: 'toggle', label: 'set.ssao', desc: 'set.ssao.desc' },
      { key: 'bloom', type: 'toggle', label: 'set.bloom', desc: 'set.bloom.desc' },
      { key: 'taa', type: 'toggle', label: 'set.taa', desc: 'set.taa.desc' },
      { key: 'grass3d', type: 'toggle', label: 'set.grass3d', desc: 'set.grass3d.desc' },
      { key: 'fancyLeaves', type: 'toggle', label: 'set.fancyLeaves', desc: 'set.fancyLeaves.desc' },
      { key: 'pom', type: 'toggle', label: 'set.pom', desc: 'set.pom.desc' },
    ],
  },
  {
    tab: 'world',
    items: [
      { key: 'gameMode', type: 'choice', label: 'set.gameMode', options: [['survival', 'mode.survival'], ['creative', 'mode.creative']], desc: 'set.gameMode.desc' },
      { key: 'difficulty', type: 'choice', label: 'set.difficulty', options: [['peaceful', 'diff.peaceful'], ['easy', 'diff.easy'], ['normal', 'diff.normal'], ['hard', 'diff.hard']], desc: 'set.difficulty.desc' },
      { key: 'weather', type: 'choice', label: 'set.weather', full: true, options: [['auto', 'weather.auto'], ['clear', 'weather.clear'], ['rain', 'weather.rain'], ['storm', 'weather.storm']], desc: 'set.weather.desc' },
      { key: 'timeOfDay', type: 'range', label: 'set.timeOfDay', min: 0, max: 1, step: 0.005, fmt: (v) => clockText(v), live: true },
      { key: 'dayLength', type: 'range', label: 'set.dayLength', min: 2, max: 60, step: 1, fmt: (v) => t('unit.minutes', { n: v }) },
      { key: 'cloudCoverage', type: 'range', label: 'set.cloudCoverage', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'brightness', type: 'range', label: 'set.brightness', min: 0.5, max: 2, step: 0.05, fmt: pct },
    ],
  },
  {
    tab: 'controls',
    items: [
      { key: 'fov', type: 'range', label: 'set.fov', min: 50, max: 110, step: 1, fmt: (v) => v + '°' },
      { key: 'sensitivity', type: 'range', label: 'set.sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'invertY', type: 'toggle', label: 'set.invertY' },
      { key: 'viewBobbing', type: 'toggle', label: 'set.viewBobbing' },
      { key: 'autoJump', type: 'toggle', label: 'set.autoJump', desc: 'set.autoJump.desc' },
      { key: 'padSensitivity', type: 'range', label: 'set.padSensitivity', min: 0.3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'padInvertY', type: 'toggle', label: 'set.padInvertY' },
      { key: 'padVibration', type: 'toggle', label: 'set.padVibration' },
      { key: 'touchSize', type: 'range', label: 'set.touchSize', min: 0.7, max: 1.5, step: 0.05, fmt: pct, touch: true },
      { key: 'touchOpacity', type: 'range', label: 'set.touchOpacity', min: 0.25, max: 1, step: 0.05, fmt: pct, touch: true },
      { key: 'touchSensitivity', type: 'range', label: 'set.touchSensitivity', min: 0.3, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×', touch: true },
      { key: 'touchHaptics', type: 'toggle', label: 'set.touchHaptics', desc: 'set.touchHaptics.desc', touch: true },
    ],
  },
  {
    tab: 'sound',
    items: [
      { key: 'volume', type: 'range', label: 'set.volume', min: 0, max: 1, step: 0.05, fmt: pct },
      { key: 'ambience', type: 'toggle', label: 'set.ambience', desc: 'set.ambience.desc' },
      { key: 'voiceVolume', type: 'range', label: 'set.voiceVolume', min: 0, max: 2, step: 0.05, fmt: pct },
      { key: 'voiceMode', type: 'choice', label: 'set.voiceMode', options: [['proximity', 'voice.proximity'], ['global', 'voice.global']], desc: 'voice.hint' },
    ],
  },
];

// Help screen: [keys, action] rows. A key is plain text, "i18n:key" or an array of those.
const kb = (...keys) => keys;
const HELP = [
  {
    title: 'help.keyboard',
    rows: [
      [kb('W', 'A', 'S', 'D'), 'act.walk'],
      [kb('i18n:key.mouse'), 'act.look'],
      [kb('Space'), 'act.jump'],
      [kb('Space ×2', 'i18n:key.or', 'F'), 'act.toggleFly'],
      [kb('Shift'), 'act.sneak'],
      [kb('W ×2', 'i18n:key.or', 'R'), 'act.sprint'],
      [kb('i18n:key.leftClick'), 'act.break'],
      [kb('i18n:key.rightClick'), 'act.place'],
      [kb('i18n:key.middleClick'), 'act.pick'],
      [kb('1–9', 'i18n:key.wheel'), 'act.hotbar'],
      [kb('E'), 'act.inventory'],
      [kb('Q'), 'act.drop'],
      [kb('Enter'), 'act.chat'],
      [kb('V'), 'act.mic'],
      [kb('T'), 'act.fastTime'],
      [kb('F3', 'i18n:key.or', '`'), 'act.debug'],
      [kb('H'), 'act.hideHud'],
      [kb('Esc'), 'act.pause'],
    ],
  },
  {
    title: 'help.gamepad',
    rows: [
      [kb('i18n:pad.leftStick'), 'act.moveSprint'],
      [kb('i18n:pad.rightStick'), 'act.lookPick'],
      [kb('pad:A'), 'act.jumpFly'],
      [kb('pad:B'), 'act.sneak'],
      [kb('pad:X'), 'act.toggleFly'],
      [kb('pad:Y'), 'act.inventory'],
      [kb('pad:RT'), 'act.break'],
      [kb('pad:LT'), 'act.place'],
      [kb('pad:LB', 'pad:RB'), 'act.hotbarPad'],
      [kb('i18n:pad.dpad', '↑'), 'act.fastTime'],
      [kb('i18n:pad.dpad', '↓'), 'act.hideHud'],
      [kb('i18n:pad.view'), 'act.debug'],
      [kb('i18n:pad.menu'), 'act.pause'],
    ],
    note: 'act.menuNav',
  },
  {
    title: 'help.touch',
    rows: [
      [kb('i18n:touch.stick'), 'touch.stickDesc'],
      [kb('i18n:touch.drag'), 'touch.dragDesc'],
      [kb('i18n:touch.tap'), 'touch.tapDesc'],
      [kb('i18n:touch.hold'), 'touch.holdDesc'],
      [kb('i18n:touch.hotbar'), 'touch.hotbarDesc'],
      [kb('i18n:touch.buttons'), 'touch.buttonsDesc'],
    ],
  },
];

const QUICK = [
  [kb('W', 'A', 'S', 'D'), 'act.move'],
  [kb('Space'), 'act.jumpFly'],
  [kb('i18n:key.leftClick'), 'act.breakBlock'],
  [kb('i18n:key.rightClick'), 'act.placeBlock'],
  [kb('E'), 'act.allBlocks'],
  [kb('T'), 'act.holdTime'],
];

let padStyle = 'xbox';

function keyHtml(k) {
  const text = k.startsWith('i18n:') ? t(k.slice(5)) : k.startsWith('pad:') ? GLYPHS[padStyle][k.slice(4)] : k;
  if (k === 'i18n:key.or') return ` ${text} `;
  return `<kbd>${escapeHtml(text)}</kbd>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function keyRows(rows) {
  return rows.map(([keys, act]) => `<div><dt>${keys.map(keyHtml).join('')}</dt><dd>${escapeHtml(t(act))}</dd></div>`).join('');
}

const WIDE_ROWS = new Set(['dev.gpu', 'dev.gamepads', 'dev.screen']);
function deviceRows(rows) {
  return rows.map(([k, v, ok]) => {
    const cls = [ok === false ? 'bad' : ok === true ? 'good' : '', WIDE_ROWS.has(k) ? 'wide' : ''].join(' ').trim();
    return `<div class="${cls}"><dt>${escapeHtml(t(k))}</dt><dd>${escapeHtml(v)}</dd></div>`;
  }).join('');
}

const SLOT_HTML = (num) => `${num !== '' ? `<span class="num">${num}</span>` : ''}<img alt="" hidden><span class="count"></span><span class="wear" hidden><i></i></span>`;

export function clockText(tm) {
  // dayTime 0 = 06:00 sunrise
  const mins = Math.round(((tm * 24 + 6) % 24) * 60);
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export class UI {
  constructor() {
    this.screens = ['title', 'pause', 'settings', 'help', 'newworld', 'inventory', 'device', 'death', 'multiplayer'];
    this.mp = null;
    this.chatLines = [];
    this.newWorld = { mode: 'survival', difficulty: 'normal' };
    this.current = null;
    this.stack = [];
    this.handlers = {};
    this.toastTimer = null;
    this.nameTimer = null;
    this.icons = null;
    this.settingsTab = 'graphics';
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.bindButtons();
    this.refreshLanguage();
  }

  on(name, fn) {
    this.handlers[name] = fn;
  }

  emit(name, ...args) {
    if (this.handlers[name]) this.handlers[name](...args);
  }

  bindButtons() {
    const click = (id, ev) => $(id).addEventListener('click', () => { this.emit('click'); this.emit(ev); });
    click('btn-play', 'play');
    click('btn-new', 'openNewWorld');
    click('btn-settings', 'openSettings');
    click('btn-help', 'openHelp');
    click('btn-device', 'openDevice');
    click('btn-resume', 'resume');
    click('btn-pause-settings', 'openSettings');
    click('btn-pause-help', 'openHelp');
    click('btn-title', 'toTitle');
    click('btn-settings-done', 'back');
    click('btn-help-done', 'back');
    click('btn-newworld-cancel', 'back');
    click('btn-device-done', 'back');
    click('btn-respawn', 'respawn');
    click('btn-multi', 'openMultiplayer');
    click('btn-mp-cancel', 'back');
    click('btn-mic', 'toggleMic');
    const join = () => {
      if ($('btn-mp-join').disabled) return;
      this.emit('click');
      this.emit('joinServer', { address: $('mp-address').value.trim(), name: $('mp-name').value.trim(), password: $('mp-password').value });
    };
    $('btn-mp-join').addEventListener('click', join);
    for (const id of ['mp-address', 'mp-name', 'mp-password']) {
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') join();
        if (e.key === 'Escape') this.emit('back');
        e.stopPropagation();
      });
    }
    for (const b of $('voice-mode').querySelectorAll('button')) b.addEventListener('click', () => { this.emit('click'); this.emit('voiceMode', b.dataset.v); });
    $('chat-form').addEventListener('submit', (e) => { e.preventDefault(); this.emit('chatSubmit', $('chat-input').value); });
    $('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.emit('chatCancel'); }
      e.stopPropagation();
    });
    // tapping or clicking back into the game closes the chat
    $('chat-input').addEventListener('blur', () => setTimeout(() => { if ($('chat').classList.contains('open')) this.emit('chatCancel'); }, 150));
    click('btn-death-title', 'toTitle');
    $('btn-newworld-create').addEventListener('click', () => {
      this.emit('click');
      this.emit('createWorld', $('seed-input').value.trim(), { ...this.newWorld });
    });
    $('seed-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.emit('createWorld', $('seed-input').value.trim(), { ...this.newWorld });
      e.stopPropagation();
    });
    // new world: game mode and difficulty
    const seg = (id, key, after) => {
      for (const b of $(id).querySelectorAll('button')) {
        b.addEventListener('click', () => {
          this.emit('click');
          this.newWorld[key] = b.dataset.v;
          this.syncNewWorld();
          if (after) after();
        });
      }
    };
    seg('new-mode', 'mode');
    seg('new-diff', 'difficulty');
    for (const b of document.querySelectorAll('.lang-toggle button')) {
      b.addEventListener('click', () => { this.emit('click'); this.emit('setLanguage', b.dataset.lang); });
    }
  }

  syncNewWorld() {
    const nw = this.newWorld;
    for (const b of $('new-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === nw.mode));
    for (const b of $('new-diff').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === nw.difficulty));
    const desc = $('new-mode-desc');
    desc.dataset.i18n = 'mode.' + nw.mode + '.desc';
    desc.textContent = t(desc.dataset.i18n);
  }

  // ------------------------------------------------------------ multiplayer
  setHostServer(info) {
    this.hostServer = info;
  }

  showMultiplayerForm(prefs, host) {
    $('mp-address').value = prefs.address || '';
    $('mp-name').value = prefs.name || '';
    $('mp-password').value = '';
    const hint = $('mp-hint');
    hint.dataset.i18n = host ? 'mp.hintHere' : 'mp.hint';
    hint.textContent = t(hint.dataset.i18n, { server: host ? host.name : '' });
    $('mp-address').placeholder = host ? t('mp.here', { server: host.name }) : t('mp.addressPlaceholder');
    this.setMpError(null);
    setTimeout(() => { const el = $('mp-name').value ? $('btn-mp-join') : $('mp-name'); el.focus({ preventScroll: true }); }, 40);
  }

  setMpBusy(busy) {
    const b = $('btn-mp-join');
    b.disabled = busy;
    b.textContent = t(busy ? 'mp.connecting' : 'mp.join');
  }

  setMpError(msg) {
    const el = $('mp-error');
    el.hidden = !msg;
    el.textContent = msg || '';
  }

  // info = { server } while on a server, null otherwise
  setMultiplayer(info) {
    this.mp = info;
    $('chat').hidden = !info;
    $('mp-panel').hidden = !info;
    $('pause').querySelector('.sheet').classList.toggle('has-mp', !!info);
    $('voice-hud').hidden = true;
    $('btn-title').textContent = t(info ? 'mp.leave' : 'pause.toTitle');
    if (!info) {
      this.chatLines = [];
      $('chat-log').innerHTML = '';
      $('nametags').innerHTML = '';
    }
  }

  // name null: a notice from the game
  addChat(name, text) {
    const log = $('chat-log');
    const line = document.createElement('p');
    line.className = 'chat-line' + (name ? '' : ' notice');
    if (name) {
      const who = document.createElement('b');
      who.textContent = name;
      line.appendChild(who);
    }
    line.appendChild(document.createTextNode(text));
    log.appendChild(line);
    while (log.children.length > 40) log.firstChild.remove();
    // lines fade after a while unless the chat is open
    setTimeout(() => line.classList.add('old'), 12000);
    log.scrollTop = log.scrollHeight;
  }

  openChat() {
    $('chat').classList.add('open');
    $('chat-form').hidden = false;
    const input = $('chat-input');
    input.value = '';
    setTimeout(() => input.focus({ preventScroll: true }), 0);
    $('chat-log').scrollTop = $('chat-log').scrollHeight;
  }

  closeChat() {
    $('chat').classList.remove('open');
    $('chat-form').hidden = true;
    $('chat-input').blur();
  }

  createNameTag(name) {
    const tag = document.createElement('div');
    tag.className = 'nametag';
    tag.hidden = true;
    const n = document.createElement('span');
    n.textContent = name;
    tag.appendChild(n);
    tag.insertAdjacentHTML('beforeend', '<i class="nt-voice" aria-hidden="true"></i>');
    $('nametags').appendChild(tag);
    return tag;
  }

  // state = { server, ping, players: [{ name, me, voice: { on, muted }, speaking }], mic, muted, mode }
  renderMpPanel(state) {
    this.mpPanelState = state;
    $('mp-server').textContent = state.server;
    $('mp-ping').textContent = t('mp.players', { n: state.players.length }) + (state.ping ? ' · ' + state.ping + ' ms' : '');
    $('mp-players').innerHTML = state.players.map((p) => {
      const v = p.voice && p.voice.on ? (p.voice.muted ? 'muted' : p.speaking ? 'speaking' : 'on') : 'off';
      return `<li class="${p.me ? 'me' : ''}"><span>${escapeHtml(p.name)}${p.me ? ` <em>(${escapeHtml(t('mp.you'))})</em>` : ''}</span><i class="mic-dot ${v}" title="${escapeHtml(t('voice.state.' + v))}"></i></li>`;
    }).join('');
    $('btn-mic').textContent = t(!state.mic ? 'voice.micOff' : state.muted ? 'voice.unmute' : 'voice.mute');
    for (const b of $('voice-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === state.mode));
  }

  // state = { mic, muted, level, speaking: [names] }
  setVoiceHud(state) {
    const el = $('voice-hud');
    const show = state.mic || state.speaking.length > 0;
    el.hidden = !show;
    if (!show) return;
    const me = state.mic ? `<span class="vh-mic ${state.muted ? 'muted' : state.level > 0.03 ? 'live' : ''}">${escapeHtml(t(state.muted ? 'voice.muted' : 'voice.micOn'))}</span>` : '';
    const who = state.speaking.length ? `<span class="vh-who">${escapeHtml(t('voice.speaking', { names: state.speaking.join('、') }))}</span>` : '';
    const html = me + who;
    if (el.innerHTML !== html) el.innerHTML = html;
  }

  // Re-render everything that carries text after the language changes.
  refreshLanguage() {
    applyI18n(document);
    const lang = getLanguage();
    for (const b of document.querySelectorAll('.lang-toggle button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    $('quick-keys').innerHTML = keyRows(QUICK);
    this.buildHelp();
    if (this.titleMeta) this.setTitleMeta(this.titleMeta);
    if (this.playLabelKey) this.setPlayLabel(this.playLabelKey);
    if (this.icons) this.buildInventory(this.icons);
    if (this.settingsRef && this.current === 'settings') this.buildSettings(this.settingsRef, this.onSettingChange);
    if (this.hotbarState) this.renderHotbar(...this.hotbarState);
    if (this.invState) this.renderInventory(...this.invState);
    if (this.vitalsState) { const v = this.vitalsState; this.vitalsState = null; this.setVitals(v); }
    if (this.deathCause) this.showDeath(this.deathCause);
    if (this.mp) $('btn-title').textContent = t('mp.leave');
    if (this.mpPanelState) this.renderMpPanel(this.mpPanelState);
    if (this.deviceInfo) this.showDevice(this.deviceInfo);
  }

  setPadStyle(style) {
    if (!GLYPHS[style] || style === padStyle) return;
    padStyle = style;
    this.buildHelp();
  }

  buildHelp() {
    $('help-body').innerHTML = HELP.map((sec) => `<section class="help-sec"><h3>${escapeHtml(t(sec.title))}</h3>
      <dl class="keys">${keyRows(sec.rows)}</dl>${sec.note ? `<p class="hint">${escapeHtml(t(sec.note))}</p>` : ''}</section>`).join('') +
      `<section class="help-sec"><h3>${escapeHtml(t('help.adventure'))}</h3>${['bed', 'farm', 'armor', 'nether', 'end'].map((k) => `<p class="hint">${escapeHtml(t('adv.' + k))}</p>`).join('')}</section>`;
  }

  show(name, focusEl) {
    for (const s of this.screens) $(s).hidden = s !== name;
    this.current = name;
    if (name) {
      const first = focusEl || $(name).querySelector('.btn.primary') || $(name).querySelector('button');
      if (first && name !== 'inventory') setTimeout(() => { if (this.current === name) first.focus({ preventScroll: true }); }, 30);
    }
    this.emit('screen', name);
  }

  push(name) {
    if (this.current) {
      this.stack.push(this.current);
      // come back to the button that opened the sub-screen
      this.focusMemory = this.focusMemory || {};
      this.focusMemory[this.current] = document.activeElement;
    }
    this.show(name);
  }

  pop() {
    const prev = this.stack.pop() || null;
    const mem = this.focusMemory && prev ? this.focusMemory[prev] : null;
    this.show(prev, mem && mem.isConnected && $(prev) && $(prev).contains(mem) ? mem : null);
    return prev;
  }

  clearStack() {
    this.stack = [];
  }

  setHud(visible) {
    $('hud').hidden = !visible;
  }

  setLockHint(v, key) {
    const el = $('lockhint');
    if (key) el.textContent = t(key);
    el.hidden = !v;
  }

  // meta = { seed, saved }
  setTitleMeta(meta) {
    this.titleMeta = meta;
    $('title-meta').textContent = t('title.meta', { seed: meta.seed, state: t(meta.saved ? 'title.savedWorld' : 'title.newWorld') });
  }

  setPlayLabel(key) {
    this.playLabelKey = key;
    $('btn-play').textContent = t(key);
  }

  // ------------------------------------------------------------ loading
  setLoading(progress, text) {
    const el = $('loading');
    if (progress === null) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector('.fill').style.width = Math.round(progress * 100) + '%';
    if (text) $('loading-sub').textContent = text;
  }

  showError(msg, device) {
    $('error').hidden = false;
    $('error-text').textContent = msg;
    const list = $('error-device');
    if (device && list) {
      list.innerHTML = deviceRows(device.rows);
      list.hidden = false;
    }
  }

  // ------------------------------------------------------------ toasts
  toast(text, ms = 2200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  showBlockName(name) {
    const el = $('blockname');
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(this.nameTimer);
    this.nameTimer = setTimeout(() => el.classList.remove('show'), 1400);
  }

  setDebug(text) {
    const el = $('debug');
    if (text === null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
  }

  // ------------------------------------------------------------ vitals
  // v = { health, max, air, maxAir, underwater } or null (creative: no hearts)
  setVitals(v) {
    const box = $('vitals');
    if (!v) { box.hidden = true; this.vitalsState = null; return; }
    const prev = this.vitalsState;
    this.vitalsState = { ...v };
    box.hidden = false;
    const hearts = $('hearts');
    const n = Math.ceil(v.max / 2);
    if (hearts.children.length !== n) hearts.innerHTML = '<i class="heart"></i>'.repeat(n);
    const hp = Math.max(0, Math.ceil(v.health));
    if (!prev || Math.ceil(prev.health) !== hp || prev.max !== v.max || !hearts.getAttribute('aria-label')) {
      for (let i = 0; i < n; i++) hearts.children[i].className = 'heart' + (hp >= (i + 1) * 2 ? ' full' : hp === i * 2 + 1 ? ' half' : '');
      hearts.classList.toggle('low', hp <= 4 && hp > 0);
      hearts.setAttribute('aria-label', t('hud.health', { n: hp, max: v.max }));
      if (prev && hp < Math.ceil(prev.health)) {
        hearts.classList.remove('hit');
        void hearts.offsetWidth; // restart the flash animation
        hearts.classList.add('hit');
      }
    }
    // armour: ten chestplates above the hearts, two points each
    const bar = $('armorbar');
    const pts = Math.round(v.armor || 0);
    bar.hidden = pts <= 0;
    if (pts > 0 && (!prev || prev.armor !== v.armor || !bar.children.length)) {
      if (bar.children.length !== 10) bar.innerHTML = '<i class="armor-pip"></i>'.repeat(10);
      for (let i = 0; i < 10; i++) bar.children[i].className = 'armor-pip' + (pts >= (i + 1) * 2 ? ' full' : pts === i * 2 + 1 ? ' half' : '');
      bar.setAttribute('aria-label', t('hud.armor', { n: pts }));
    }
    const bubbles = $('bubbles');
    const showAir = v.underwater || v.air < v.maxAir - 0.01;
    bubbles.hidden = !showAir;
    if (showAir) {
      const m = Math.round(v.maxAir);
      if (bubbles.children.length !== m) bubbles.innerHTML = '<i class="bubble"></i>'.repeat(m);
      const a = Math.ceil(v.air - 0.001);
      for (let i = 0; i < m; i++) bubbles.children[i].classList.toggle('gone', i >= a);
      bubbles.setAttribute('aria-label', t('hud.air'));
    }
  }

  // Asleep: { fade 0..1, sleepers: { n, m } | null }, or null when awake.
  setSleep(st) {
    const el = $('sleep');
    if (!st) { el.hidden = true; return; }
    if (el.hidden) {
      el.hidden = false;
      const b = $('btn-wake');
      if (!b.dataset.bound) { b.dataset.bound = '1'; b.addEventListener('click', () => this.emit('wake')); }
    }
    el.style.setProperty('--fade', (st.fade * 0.92).toFixed(3));
    const s = st.sleepers;
    const text = s && s.m > 1 ? t('bed.sleepers', { n: s.n, m: s.m }) : t('bed.sleeping');
    const tx = $('sleep-text');
    if (tx.textContent !== text) tx.textContent = text;
  }

  // The purple swirl while standing in a nether portal (0..1).
  setPortal(amount) {
    const v = String(Math.max(0, Math.min(1, amount)) * 0.9);
    const el = $('portalfx');
    if (el.style.opacity !== v) el.style.opacity = v;
  }

  // The boss bar: { name, frac } or null.
  setBoss(b) {
    const el = $('bossbar');
    if (!b) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    $('boss-name').textContent = b.name;
    const w = (Math.max(0, Math.min(1, b.frac)) * 100).toFixed(1) + '%';
    const fill = $('boss-fill');
    if (fill.style.width !== w) fill.style.width = w;
    fill.parentElement.setAttribute('aria-valuenow', String(Math.round(b.frac * 100)));
  }

  // Red vignette after taking damage (0..1).
  setHurt(amount) {
    const el = $('hurt');
    el.style.opacity = String(Math.max(0, Math.min(1, amount)));
  }

  showDeath(cause) {
    this.deathCause = cause;
    const key = 'death.' + cause;
    const text = t(key);
    $('death-cause').textContent = text === key ? t('death.other') : text;
  }

  // ------------------------------------------------------------ hotbar
  // slots: [{ id, count, wear } | null] x 9; counts and wear bars only matter in survival
  renderHotbar(slots, selected, showCounts = false) {
    this.hotbarState = [slots, selected, showCounts];
    const bar = $('hotbar');
    if (bar.children.length !== slots.length) {
      bar.innerHTML = '';
      slots.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = SLOT_HTML(i + 1);
        // touch and drag-to-look players can pick a slot straight from the HUD
        s.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && document.pointerLockElement) return;
          e.preventDefault();
          e.stopPropagation();
          this.emit('selectSlot', i);
        });
        bar.appendChild(s);
      });
    }
    slots.forEach((slot, i) => {
      const el = bar.children[i];
      el.classList.toggle('sel', i === selected);
      this.fillSlot(el, slot, showCounts);
    });
    this.renderInvHotbar(slots, selected, showCounts);
  }

  fillSlot(el, slot, showCounts) {
    const id = slot ? slot.id : 0;
    const d = id ? itemDef(id) : null;
    const img = el.querySelector('img');
    const src = (d && this.icons && this.icons.get(id)) || '';
    if (src) { if (img.getAttribute('src') !== src) img.setAttribute('src', src); img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
    const name = d ? itemName(d) : '';
    img.alt = name;
    el.title = name;
    const c = el.querySelector('.count');
    c.textContent = showCounts && slot && slot.count > 1 ? String(slot.count) : '';
    const w = el.querySelector('.wear');
    const dur = d && d.durability;
    if (dur && slot && slot.wear > 0) {
      const f = Math.max(0, 1 - slot.wear / dur);
      w.hidden = false;
      w.firstChild.style.width = (f * 100).toFixed(1) + '%';
      w.firstChild.style.background = `hsl(${Math.round(f * 110)} 75% 50%)`;
    } else w.hidden = true;
    return name;
  }

  // ------------------------------------------------------------ inventory
  // The screen works like the familiar one: click a stack to pick it up (right click: half of it),
  // click a slot to put it down (right click: one), drag it with the mouse, shift-click to send it
  // across (armour onto the body). Touch taps pick up and put down; a long press takes half.
  // Controllers: A picks up / puts down, X sends across. Events: invClick(ref, button),
  // invQuick(ref), invOutside(), invTrash(), palettePick(id, button, shift), craft(i).
  buildInventory(icons) {
    this.icons = icons;
    this.invTab = this.invTab || 'all';
    const tabs = $('inv-tabs');
    tabs.innerHTML = '';
    for (const tab of PALETTE_TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-tab';
      b.setAttribute('role', 'tab');
      b.dataset.tab = tab;
      b.textContent = t('inv.tab.' + tab);
      b.setAttribute('aria-selected', String(tab === this.invTab));
      b.addEventListener('click', () => this.setPaletteTab(tab));
      tabs.appendChild(b);
    }
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const add = (d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-slot';
      b.title = itemName(d);
      b.dataset.item = String(d.id);
      b.dataset.tab = paletteTab(d);
      b.dataset.search = (d.name + ' ' + d.zh + ' ' + d.key).toLowerCase();
      b.setAttribute('aria-label', itemName(d));
      b.innerHTML = `<img alt="" src="${icons.get(d.id)}">`;
      this.bindPalette(b, d.id);
      grid.appendChild(b);
    };
    for (const d of BLOCKS) if (d.inventory && icons.has(d.id)) add(itemDef(d.id));
    for (const d of ITEMS) if (icons.has(d.id)) add(d);
    const search = $('inv-search');
    if (!search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => this.filterPalette());
      // typing a name must not reach the game's keys (E would close the screen)
      search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') search.blur(); });
    }
    this.filterPalette();
    this.bindInventoryScreen();
  }

  setPaletteTab(tab) {
    this.invTab = tab;
    for (const b of $('inv-tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.filterPalette();
  }

  switchPaletteTab(dir) {
    const i = PALETTE_TABS.indexOf(this.invTab || 'all');
    this.setPaletteTab(PALETTE_TABS[(i + dir + PALETTE_TABS.length) % PALETTE_TABS.length]);
  }

  filterPalette() {
    const q = $('inv-search').value.trim().toLowerCase();
    for (const b of $('inv-grid').children) {
      b.hidden = q ? !b.dataset.search.includes(q) : this.invTab !== 'all' && b.dataset.tab !== this.invTab;
    }
  }

  // One-time listeners on the whole screen: the drag, the cursor stack following the pointer,
  // dropping outside the sheet, number keys over a slot, no context menu.
  bindInventoryScreen() {
    if (this.invBound) return;
    this.invBound = true;
    const screen = $('inventory');
    const cursorEl = $('inv-cursor');
    this.drag = null;
    screen.addEventListener('contextmenu', (e) => e.preventDefault());
    const place = (x, y) => {
      this.cursorAt = [x, y];
      cursorEl.style.transform = `translate(${x}px, ${y}px)`;
    };
    screen.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') place(e.clientX, e.clientY);
      const d = this.drag;
      if (d && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      $('inv-trash').classList.toggle('hot', !!(d && d.moved && over && over.closest('#inv-trash')));
    });
    const finishDrag = (e) => {
      const d = this.drag;
      this.drag = null;
      $('inv-trash').classList.remove('hot');
      for (const el of screen.querySelectorAll('.drag-src')) el.classList.remove('drag-src');
      if (!d || !d.moved) return;
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const slot = over && over.closest('[data-ref]');
      if (slot) {
        if (slot.dataset.ref === 'trash') this.emit('invTrash');
        else this.emit('invClick', Number(slot.dataset.ref), 0);
      } else if (!over || !over.closest('.inv-sheet')) this.emit('invOutside');
      else if (d.ref !== null) this.emit('invClick', d.ref, 0); // let go over the sheet: it goes back
    };
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', () => { this.drag = null; });
    // a click on the dimmed backdrop throws the held stack away (or drops it, in survival)
    screen.addEventListener('pointerdown', (e) => {
      if (e.target === screen && !this.drag) this.emit('invOutside');
    });
    // 1-9 over a slot swaps it with that hotbar slot
    document.addEventListener('keydown', (e) => {
      if (this.current !== 'inventory' || (e.target && e.target.tagName === 'INPUT')) return;
      const m = /^Digit([1-9])$/.exec(e.code);
      if (!m) return;
      const el = document.querySelector('#inventory [data-ref]:hover') || document.activeElement;
      if (!el || !el.dataset || el.dataset.ref === undefined || el.dataset.ref === 'trash') return;
      e.preventDefault();
      e.stopPropagation();
      this.emit('invSwap', Number(el.dataset.ref), Number(m[1]) - 1);
    });
    screen.addEventListener('focusin', (e) => {
      if (this.lastPointer === 'mouse') return;
      const r = e.target.getBoundingClientRect();
      place(r.right - 6, r.bottom - 6);
    });
  }

  // Pointer handling shared by every slot of the inventory screen.
  bindSlot(el, ref) {
    el.dataset.ref = String(ref);
    let pressTimer = 0, longPressed = false;
    el.addEventListener('pointerdown', (e) => {
      this.lastPointer = e.pointerType;
      if (e.pointerType === 'touch') {
        longPressed = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => { longPressed = true; this.emit('click'); this.emit('invClick', ref, 2); }, 480);
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      this.emit('click');
      if (ref === 'trash') { this.emit('invTrash'); return; }
      if (e.shiftKey) { this.emit('invQuick', ref); return; }
      const hadCursor = !!(this.invState && this.invState[0].cursor);
      this.emit('invClick', ref, e.button);
      // picking a stack up starts a drag: letting go over another slot puts it there
      if (!hadCursor && this.invState && this.invState[0].cursor) {
        this.drag = { ref, x: e.clientX, y: e.clientY, moved: false };
        el.classList.add('drag-src');
      }
    });
    el.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') clearTimeout(pressTimer); });
    el.addEventListener('pointerleave', () => clearTimeout(pressTimer));
    // taps, and A / Enter on a focused slot, arrive as clicks
    el.addEventListener('click', (e) => {
      if (this.lastPointer === 'mouse' && e.detail > 0) return;
      if (longPressed) { longPressed = false; return; }
      this.emit('click');
      if (ref === 'trash') this.emit('invTrash');
      else this.emit('invClick', ref, 0);
      if (e.detail === 0) this.lastPointer = 'keys';
    });
  }

  bindPalette(el, id) {
    el.addEventListener('pointerdown', (e) => {
      this.lastPointer = e.pointerType;
      if (e.pointerType === 'touch' || (e.button !== 0 && e.button !== 2)) return;
      e.preventDefault();
      this.emit('click');
      this.emit('palettePick', id, e.button, e.shiftKey);
      if (!e.shiftKey && this.invState && this.invState[0].cursor) this.drag = { ref: null, x: e.clientX, y: e.clientY, moved: false };
    });
    el.addEventListener('click', (e) => {
      if (this.lastPointer === 'mouse' && e.detail > 0) return;
      this.emit('click');
      this.emit('palettePick', id, 0, false);
      if (e.detail === 0) this.lastPointer = 'keys';
    });
  }

  // inv: the Inventory (slots, armor, cursor); creative shows the palette instead of recipes
  renderInventory(inv, selected, creative, canCraft) {
    this.invState = [inv, selected, creative, canCraft];
    const title = $('inv-title'), hint = $('inv-hint');
    title.dataset.i18n = creative ? 'inv.title' : 'inv.survivalTitle';
    hint.dataset.i18n = creative ? 'inv.hint' : 'inv.survivalHint';
    title.textContent = t(title.dataset.i18n);
    hint.textContent = t(hint.dataset.i18n);
    $('inv-creative').hidden = !creative;
    $('inv-survival').hidden = creative;
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    const build = (host, refs, cls = 'slot') => {
      if (host.children.length === refs.length) return;
      host.innerHTML = '';
      for (const ref of refs) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.dataset.key = 'slot:' + ref;
        b.innerHTML = SLOT_HTML(ref < 9 ? ref + 1 : '');
        this.bindSlot(b, ref);
        host.appendChild(b);
      }
    };
    const bagRefs = [];
    for (let i = 9; i < inv.slots.length; i++) bagRefs.push(i);
    build($('inv-bag'), bagRefs);
    build($('inv-hotbar'), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    build($('inv-armor'), [ARMOR_REF, ARMOR_REF + 1, ARMOR_REF + 2, ARMOR_REF + 3]);
    const trash = $('inv-trash');
    if (!trash.dataset.bound) { trash.dataset.bound = '1'; this.bindSlot(trash, 'trash'); }
    const fill = (el, slot, label) => {
      const name = this.fillSlot(el, slot, true);
      el.setAttribute('aria-label', name ? (slot.count > 1 ? `${name} ×${slot.count}` : name) : label);
    };
    for (const el of $('inv-bag').children) fill(el, inv.slots[Number(el.dataset.ref)], t('inv.bag'));
    for (const el of $('inv-hotbar').children) {
      const i = Number(el.dataset.ref);
      el.classList.toggle('sel', i === selected);
      fill(el, inv.slots[i], String(i + 1));
    }
    [...$('inv-armor').children].forEach((el, k) => {
      const slot = inv.armor[k];
      fill(el, slot, t('inv.armorSlot.' + k));
      if (slot) el.removeAttribute('data-empty'); else el.dataset.empty = String(k);
    });
    const av = inv.armorValues();
    $('inv-armor-pts').textContent = av.points ? t('inv.armorPts', { n: av.points }) : '';
    // the stack on the cursor
    const cursorEl = $('inv-cursor');
    const c = inv.cursor;
    cursorEl.hidden = !c;
    if (c) {
      const img = cursorEl.querySelector('img');
      const src = (this.icons && this.icons.get(c.id)) || '';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      cursorEl.querySelector('.count').textContent = c.count > 1 ? String(c.count) : '';
      if (!this.cursorAt && active && active.getBoundingClientRect) {
        const r = active.getBoundingClientRect();
        cursorEl.style.transform = `translate(${r.right - 6}px, ${r.bottom - 6}px)`;
      }
    }
    if (!creative) this.renderRecipes(canCraft, focusKey, selected);
  }

  renderRecipes(canCraft, focusKey, selected) {
    // recipes: what can be made now first, then the rest (dimmed, not focusable)
    const list = $('inv-recipes');
    const ready = [], later = [];
    RECIPES.forEach((r, i) => (canCraft(r) ? ready : later).push(i));
    const key = ready.join(',') + '|' + getLanguage();
    if (key !== this.recipeKey || !list.children.length) {
      this.recipeKey = key;
      const recipeHtml = (i, ok) => {
        const [out, n, ings] = RECIPES[i];
        const d = itemDef(out);
        const ingHtml = ings.map(([id, c]) => {
          const isPlanks = id === 'planks';
          const icon = this.icons.get(isPlanks ? BLOCK.OAK_PLANKS : id) || '';
          const nm = isPlanks ? t('inv.planks') : itemName(itemDef(id));
          return `<span class="ing" title="${escapeHtml(nm)}"><img alt="" src="${icon}"><b>${c}</b></span>`;
        }).join('');
        const label = `${itemName(d)}${n > 1 ? ' ×' + n : ''}`;
        return `<button type="button" class="recipe${ok ? '' : ' no'}" data-key="recipe:${i}" data-i="${i}" ${ok ? '' : 'disabled'} aria-label="${escapeHtml(label)}">
          <span class="out"><img alt="" src="${this.icons.get(out) || ''}">${n > 1 ? `<b>${n}</b>` : ''}</span>
          <span class="rname">${escapeHtml(itemName(d))}</span>
          <span class="ings">${ingHtml}</span></button>`;
      };
      list.innerHTML = (ready.length ? ready.map((i) => recipeHtml(i, true)).join('') : `<p class="hint">${escapeHtml(t('inv.noRecipes'))}</p>`) +
        (later.length ? `<p class="inv-sub">${escapeHtml(t('inv.more'))}</p>` + later.map((i) => recipeHtml(i, false)).join('') : '');
      for (const b of list.querySelectorAll('button.recipe')) {
        b.addEventListener('click', () => { this.emit('click'); this.emit('craft', Number(b.dataset.i)); });
      }
    }
    if (focusKey && this.current === 'inventory') {
      let el = document.querySelector(`#inventory [data-key="${focusKey}"]:not([disabled])`);
      if (!el && focusKey.startsWith('recipe:')) el = list.querySelector('button.recipe:not([disabled])') || $('inv-hotbar').children[selected];
      if (el && el !== document.activeElement) el.focus({ preventScroll: true });
    }
  }

  renderInvHotbar() {
    // the inventory screen draws its own hotbar row (see renderInventory)
  }

  // ------------------------------------------------------------ settings
  buildSettings(settings, onChange) {
    this.settingsRef = settings;
    this.onSettingChange = onChange;
    const tabs = $('settings-tabs');
    tabs.innerHTML = '';
    for (const g of SCHEMA) {
      const tb = document.createElement('button');
      tb.type = 'button';
      tb.className = 'tab';
      tb.id = 'tab-' + g.tab;
      tb.setAttribute('role', 'tab');
      tb.textContent = t('tab.' + g.tab);
      tb.setAttribute('aria-selected', String(g.tab === this.settingsTab));
      tb.addEventListener('click', () => { this.settingsTab = g.tab; this.buildSettings(this.settingsRef, this.onSettingChange); tb.focus(); });
      tabs.appendChild(tb);
    }
    const body = $('settings-body');
    body.innerHTML = '';
    const group = SCHEMA.find((g) => g.tab === this.settingsTab) || SCHEMA[1];
    for (const it of group.items) {
      if (it.touch && !this.isTouch) continue;
      body.appendChild(this.buildSetting(it, settings));
    }
  }

  switchSettingsTab(dir) {
    const i = SCHEMA.findIndex((g) => g.tab === this.settingsTab);
    this.settingsTab = SCHEMA[(i + dir + SCHEMA.length) % SCHEMA.length].tab;
    this.buildSettings(this.settingsRef, this.onSettingChange);
    const tb = $('tab-' + this.settingsTab);
    if (tb) tb.focus({ preventScroll: true });
  }

  buildSetting(it, settings) {
    const row = document.createElement('div');
    row.className = 'setting' + (it.full ? ' full' : '');
    const id = 'set-' + it.key;
    const label = escapeHtml(t(it.label));
    const desc = it.desc ? `<p class="desc">${escapeHtml(t(it.desc))}</p>` : '';
    if (it.type === 'range') {
      const v = settings[it.key];
      row.innerHTML = `<div class="setting-top"><label for="${id}">${label}</label><span class="value">${it.fmt(v)}</span></div>
        <input id="${id}" type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}">${desc}`;
      const input = row.querySelector('input');
      const val = row.querySelector('.value');
      input.addEventListener('input', () => {
        const nv = parseFloat(input.value);
        val.textContent = it.fmt(nv);
        this.onSettingChange(it.key, nv, it.live);
      });
      input.addEventListener('keydown', (e) => e.stopPropagation());
    } else if (it.type === 'toggle') {
      row.innerHTML = `<label class="toggle" for="${id}"><span class="label">${label}</span><input id="${id}" type="checkbox" ${settings[it.key] ? 'checked' : ''}><span class="sw"></span></label>${desc}`;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        this.onSettingChange(it.key, input.checked);
        if (PRESET_KEYS.includes(it.key)) this.markPreset('custom');
      });
    } else if (it.type === 'choice') {
      const cur = String(settings[it.key]);
      row.innerHTML = `<div class="setting-top"><span class="label">${label}</span></div>
        <div class="seg" role="group" aria-label="${label}" style="--cols:${it.options.length}">${it.options.map(([v, l]) => `<button type="button" id="${id}-${v}" data-v="${v}" aria-pressed="${cur === String(v)}">${escapeHtml(it.raw ? l : t(l))}</button>`).join('')}</div>${desc}`;
      row.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
        const v = it.num ? Number(b.dataset.v) : b.dataset.v;
        row.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        this.onSettingChange(it.key, v);
      }));
    } else if (it.type === 'preset') {
      row.innerHTML = `<div class="setting-top"><span class="label">${label}</span><span class="value" id="preset-value">${escapeHtml(t('preset.' + settings.preset))}</span></div>
        <div class="seg" role="group" aria-label="${label}" style="--cols:${PRESET_ORDER.length}">${PRESET_ORDER.map((o) => `<button type="button" id="preset-${o}" data-v="${o}" aria-pressed="${settings.preset === o}">${escapeHtml(t('preset.' + o))}</button>`).join('')}</div>${desc}`;
      row.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
        this.onSettingChange('preset', b.dataset.v);
        this.buildSettings(this.settingsRef, this.onSettingChange);
        const again = $('preset-' + b.dataset.v);
        if (again) again.focus({ preventScroll: true });
      }));
    }
    return row;
  }

  markPreset(name) {
    const v = document.getElementById('preset-value');
    if (v) v.textContent = t('preset.' + name);
    document.querySelectorAll('[id^="preset-"]').forEach((b) => { if (b.dataset.v) b.setAttribute('aria-pressed', String(b.dataset.v === name)); });
  }

  refreshLive(key, value) {
    const input = document.getElementById('set-' + key);
    if (!input || document.activeElement === input) return;
    input.value = value;
    const it = SCHEMA.flatMap((g) => g.items).find((x) => x.key === key);
    const val = input.closest('.setting').querySelector('.value');
    if (it && val) val.textContent = it.fmt(value);
  }

  // ------------------------------------------------------------ device check
  // info: [[labelKey, value, ok?]], recommend: preset name
  showDevice(info) {
    this.deviceInfo = info;
    $('device-list').innerHTML = deviceRows(info.rows);
    $('device-recommend').textContent = info.recommend ? t('dev.recommend', { preset: t('preset.' + info.recommend) }) : '';
  }
}
