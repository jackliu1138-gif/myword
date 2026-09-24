// DOM user interface: screens, settings, hotbar, inventory, toasts, help, device check, debug overlay.

import { BLOCKS } from '../world/blocks.js';
import { t, blockName, applyI18n, getLanguage } from './i18n.js';
import { GLYPHS } from '../game/gamepad.js';

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

export function clockText(tm) {
  // dayTime 0 = 06:00 sunrise
  const mins = Math.round(((tm * 24 + 6) % 24) * 60);
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export class UI {
  constructor() {
    this.screens = ['title', 'pause', 'settings', 'help', 'newworld', 'inventory', 'device'];
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
    $('btn-newworld-create').addEventListener('click', () => {
      this.emit('click');
      this.emit('createWorld', $('seed-input').value.trim());
    });
    $('seed-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.emit('createWorld', $('seed-input').value.trim());
      e.stopPropagation();
    });
    for (const b of document.querySelectorAll('.lang-toggle button')) {
      b.addEventListener('click', () => { this.emit('click'); this.emit('setLanguage', b.dataset.lang); });
    }
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
    if (this.deviceInfo) this.showDevice(this.deviceInfo);
  }

  setPadStyle(style) {
    if (!GLYPHS[style] || style === padStyle) return;
    padStyle = style;
    this.buildHelp();
  }

  buildHelp() {
    $('help-body').innerHTML = HELP.map((sec) => `<section class="help-sec"><h3>${escapeHtml(t(sec.title))}</h3>
      <dl class="keys">${keyRows(sec.rows)}</dl>${sec.note ? `<p class="hint">${escapeHtml(t(sec.note))}</p>` : ''}</section>`).join('');
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

  // ------------------------------------------------------------ hotbar
  renderHotbar(slots, selected) {
    this.hotbarState = [slots, selected];
    const bar = $('hotbar');
    if (bar.children.length !== slots.length) {
      bar.innerHTML = '';
      slots.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="">`;
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
    slots.forEach((id, i) => {
      const s = bar.children[i];
      s.classList.toggle('sel', i === selected);
      const img = s.querySelector('img');
      const src = this.icons.get(id) || '';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.alt = BLOCKS[id] ? blockName(BLOCKS[id]) : '';
    });
    this.renderInvHotbar(slots, selected);
  }

  // ------------------------------------------------------------ inventory
  buildInventory(icons) {
    this.icons = icons;
    const grid = $('inv-grid');
    grid.innerHTML = '';
    for (const d of BLOCKS) {
      if (!d.inventory || !icons.has(d.id)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'inv-slot';
      b.title = blockName(d);
      b.setAttribute('aria-label', blockName(d));
      b.innerHTML = `<img alt="" src="${icons.get(d.id)}">`;
      b.addEventListener('click', () => this.emit('pickBlock', d.id));
      grid.appendChild(b);
    }
  }

  renderInvHotbar(slots, selected) {
    const bar = $('inv-hotbar');
    if (!bar) return;
    if (bar.children.length !== slots.length) {
      bar.innerHTML = '';
      slots.forEach((_, i) => {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="">`;
        s.addEventListener('click', () => this.emit('selectSlot', i));
        bar.appendChild(s);
      });
    }
    slots.forEach((id, i) => {
      const s = bar.children[i];
      s.classList.toggle('sel', i === selected);
      s.setAttribute('aria-label', `${i + 1} ${BLOCKS[id] ? blockName(BLOCKS[id]) : ''}`);
      const img = s.querySelector('img');
      const src = this.icons.get(id) || '';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
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
