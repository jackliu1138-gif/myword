// DOM user interface: screens, settings, hotbar, inventory, toasts, debug overlay.

import { BLOCKS } from '../world/blocks.js';

const $ = (id) => document.getElementById(id);

const PRESET_KEYS = ['shadows', 'clouds', 'volumetric', 'ssao', 'ssr', 'bloom', 'taa'];

const SCHEMA = [
  {
    tab: 'Graphics',
    items: [
      { key: 'preset', type: 'preset', label: 'Quality preset', full: true, desc: 'Ultra doubles shadow resolution and renders at full display density. Pick Low for integrated graphics.' },
      { key: 'renderDistance', type: 'range', label: 'Render distance', min: 4, max: 16, step: 1, fmt: (v) => v + ' chunks' },
      { key: 'renderScale', type: 'range', label: 'Resolution scale', min: 0.5, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'shadows', type: 'toggle', label: 'Soft shadows', desc: 'Sun and moon shadows with contact hardening.' },
      { key: 'clouds', type: 'toggle', label: 'Volumetric clouds', desc: 'Raymarched cumulus that also shade the ground.' },
      { key: 'volumetric', type: 'toggle', label: 'God rays', desc: 'Light shafts through leaves, fog and water.' },
      { key: 'ssr', type: 'toggle', label: 'Water reflections', desc: 'Screen-space reflections of terrain on water.' },
      { key: 'ssao', type: 'toggle', label: 'Ambient occlusion', desc: 'Extra contact shading between plants and blocks.' },
      { key: 'bloom', type: 'toggle', label: 'Bloom', desc: 'Glow around the sun, torches and bright sky.' },
      { key: 'taa', type: 'toggle', label: 'Temporal anti-aliasing', desc: 'Smooth edges and stable shimmer; off uses FXAA.' },
    ],
  },
  {
    tab: 'World',
    items: [
      { key: 'weather', type: 'choice', label: 'Weather', full: true, options: [['auto', 'Changing'], ['clear', 'Clear'], ['rain', 'Rain'], ['storm', 'Storm']], desc: 'Changing brings rain now and then, with the odd thunderstorm. Deserts stay dry; cold biomes get snow.' },
      { key: 'timeOfDay', type: 'range', label: 'Time of day', min: 0, max: 1, step: 0.005, fmt: (v) => clockText(v), live: true },
      { key: 'dayLength', type: 'range', label: 'Day length', min: 2, max: 60, step: 1, fmt: (v) => v + ' min' },
      { key: 'cloudCoverage', type: 'range', label: 'Cloud cover', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'brightness', type: 'range', label: 'Brightness', min: 0.5, max: 2, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
    ],
  },
  {
    tab: 'Controls',
    items: [
      { key: 'fov', type: 'range', label: 'Field of view', min: 50, max: 110, step: 1, fmt: (v) => v + '°' },
      { key: 'sensitivity', type: 'range', label: 'Mouse sensitivity', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
      { key: 'invertY', type: 'toggle', label: 'Invert vertical look' },
      { key: 'viewBobbing', type: 'toggle', label: 'View bobbing' },
      { key: 'autoJump', type: 'toggle', label: 'Auto-jump', desc: 'Step up single blocks while walking into them.' },
    ],
  },
  {
    tab: 'Sound',
    items: [
      { key: 'volume', type: 'range', label: 'Volume', min: 0, max: 1, step: 0.05, fmt: (v) => Math.round(v * 100) + '%' },
      { key: 'ambience', type: 'toggle', label: 'Ambient sounds', desc: 'Wind, birds by day, crickets at night.' },
    ],
  },
];

export function clockText(t) {
  // dayTime 0 = 06:00 sunrise
  const mins = Math.round(((t * 24 + 6) % 24) * 60);
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

export class UI {
  constructor() {
    this.screens = ['title', 'pause', 'settings', 'help', 'newworld', 'inventory'];
    this.current = null;
    this.stack = [];
    this.handlers = {};
    this.toastTimer = null;
    this.nameTimer = null;
    this.icons = null;
    this.settingsTab = 'Graphics';
    this.bindButtons();
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
    click('btn-resume', 'resume');
    click('btn-pause-settings', 'openSettings');
    click('btn-pause-help', 'openHelp');
    click('btn-title', 'toTitle');
    click('btn-settings-done', 'back');
    click('btn-help-done', 'back');
    click('btn-newworld-cancel', 'back');
    $('btn-newworld-create').addEventListener('click', () => {
      this.emit('click');
      this.emit('createWorld', $('seed-input').value.trim());
    });
    $('seed-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.emit('createWorld', $('seed-input').value.trim());
      e.stopPropagation();
    });
  }

  show(name) {
    for (const s of this.screens) $(s).hidden = s !== name;
    this.current = name;
    if (name) {
      const first = $(name).querySelector('.btn.primary, button');
      if (first && name !== 'inventory') setTimeout(() => first.focus({ preventScroll: true }), 30);
    }
  }

  push(name) {
    if (this.current) this.stack.push(this.current);
    this.show(name);
  }

  pop() {
    const prev = this.stack.pop() || null;
    this.show(prev);
    return prev;
  }

  clearStack() {
    this.stack = [];
  }

  setHud(visible) {
    $('hud').hidden = !visible;
  }

  setLockHint(v) {
    $('lockhint').hidden = !v;
  }

  setTitleMeta(text) {
    $('title-meta').textContent = text;
  }

  setPlayLabel(text) {
    $('btn-play').textContent = text;
  }

  // ------------------------------------------------------------ loading
  setLoading(progress, text) {
    const el = $('loading');
    if (progress === null) { el.hidden = true; return; }
    el.hidden = false;
    el.querySelector('.fill').style.width = Math.round(progress * 100) + '%';
    if (text) $('loading-sub').textContent = text;
  }

  showError(msg) {
    $('error').hidden = false;
    $('error-text').textContent = msg;
  }

  // ------------------------------------------------------------ toasts
  toast(text, ms = 2200) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), ms);
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
    const bar = $('hotbar');
    if (bar.children.length !== slots.length) {
      bar.innerHTML = '';
      slots.forEach((_, i) => {
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="">`;
        bar.appendChild(s);
      });
    }
    slots.forEach((id, i) => {
      const s = bar.children[i];
      s.classList.toggle('sel', i === selected);
      const img = s.querySelector('img');
      const src = this.icons.get(id) || '';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
      img.alt = BLOCKS[id] ? BLOCKS[id].name : '';
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
      b.title = d.name;
      b.setAttribute('aria-label', d.name);
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
        const s = document.createElement('div');
        s.className = 'slot';
        s.innerHTML = `<span class="num">${i + 1}</span><img alt="">`;
        s.addEventListener('click', () => this.emit('selectSlot', i));
        bar.appendChild(s);
      });
    }
    slots.forEach((id, i) => {
      const s = bar.children[i];
      s.classList.toggle('sel', i === selected);
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
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tab';
      t.id = 'tab-' + g.tab.toLowerCase();
      t.setAttribute('role', 'tab');
      t.textContent = g.tab;
      t.setAttribute('aria-selected', String(g.tab === this.settingsTab));
      t.addEventListener('click', () => { this.settingsTab = g.tab; this.buildSettings(this.settingsRef, this.onSettingChange); });
      tabs.appendChild(t);
    }
    const body = $('settings-body');
    body.innerHTML = '';
    const group = SCHEMA.find((g) => g.tab === this.settingsTab);
    for (const it of group.items) body.appendChild(this.buildSetting(it, settings));
  }

  buildSetting(it, settings) {
    const row = document.createElement('div');
    row.className = 'setting' + (it.full ? ' full' : '');
    const id = 'set-' + it.key;
    if (it.type === 'range') {
      const v = settings[it.key];
      row.innerHTML = `<div class="setting-top"><label for="${id}">${it.label}</label><span class="value">${it.fmt(v)}</span></div>
        <input id="${id}" type="range" min="${it.min}" max="${it.max}" step="${it.step}" value="${v}">`;
      const input = row.querySelector('input');
      const val = row.querySelector('.value');
      input.addEventListener('input', () => {
        const nv = parseFloat(input.value);
        val.textContent = it.fmt(nv);
        this.onSettingChange(it.key, nv, it.live);
      });
      input.addEventListener('keydown', (e) => e.stopPropagation());
    } else if (it.type === 'toggle') {
      row.innerHTML = `<label class="toggle" for="${id}"><span class="label">${it.label}</span><input id="${id}" type="checkbox" ${settings[it.key] ? 'checked' : ''}><span class="sw"></span></label>
        ${it.desc ? `<p class="desc">${it.desc}</p>` : ''}`;
      const input = row.querySelector('input');
      input.addEventListener('change', () => {
        this.onSettingChange(it.key, input.checked);
        if (PRESET_KEYS.includes(it.key)) this.markPreset('custom');
      });
    } else if (it.type === 'choice') {
      row.innerHTML = `<div class="setting-top"><span class="label">${it.label}</span></div>
        <div class="seg" role="group" aria-label="${it.label}">${it.options.map(([v, l]) => `<button type="button" id="${id}-${v}" data-v="${v}" aria-pressed="${settings[it.key] === v}">${l}</button>`).join('')}</div>
        ${it.desc ? `<p class="desc">${it.desc}</p>` : ''}`;
      row.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
        this.onSettingChange(it.key, b.dataset.v);
        row.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      }));
    } else if (it.type === 'preset') {
      const opts = ['low', 'medium', 'high', 'ultra'];
      row.innerHTML = `<div class="setting-top"><span class="label">${it.label}</span><span class="value" id="preset-value">${settings.preset}</span></div>
        <div class="seg" role="group" aria-label="${it.label}">${opts.map((o) => `<button type="button" id="preset-${o}" data-v="${o}" aria-pressed="${settings.preset === o}">${o[0].toUpperCase() + o.slice(1)}</button>`).join('')}</div>
        <p class="desc">${it.desc}</p>`;
      row.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
        this.onSettingChange('preset', b.dataset.v);
        this.buildSettings(this.settingsRef, this.onSettingChange);
      }));
    }
    return row;
  }

  markPreset(name) {
    const v = document.getElementById('preset-value');
    if (v) v.textContent = name;
    document.querySelectorAll('[id^="preset-"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === name)));
  }

  refreshLive(key, value) {
    const input = document.getElementById('set-' + key);
    if (!input || document.activeElement === input) return;
    input.value = value;
    const it = SCHEMA.flatMap((g) => g.items).find((x) => x.key === key);
    const val = input.closest('.setting').querySelector('.value');
    if (it && val) val.textContent = it.fmt(value);
  }
}
