// The F-22's head-up display, drawn over the view in its green: the circle in the middle (where
// we look, so where it flies and the cannon aims), the nose's mark banked as it banks, the flight
// path marker (where it is really going), the pitch ladder, the heading tape along the top, the
// bank scale, speed (km/h, Mach, g) on the left, height (metres, and over the ground) on the right,
// the engines and gear, the weapons and their firepower, the box round what the missiles lock onto,
// and the warnings (Auto-GCAS pulling up, a stall). Built once as SVG; each frame only moves it.

import { t } from './i18n.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
};
const DEG = 180 / Math.PI;
const pad2 = (n) => String(n).padStart(2, '0');

export class JetHud {
  constructor(root) {
    this.root = root;
    this.svg = el('svg', { class: 'jet-hud', 'aria-hidden': 'true' });
    root.appendChild(this.svg);
    this.w = 0; this.h = 0;
    this.shownAt = 0;
    this.touch = false;
    this.build();
  }

  // Everything, laid out for the window's size (again whenever it changes); on a touch screen the
  // engines' and weapons' lines go up to the top corners, clear of the buttons.
  build(touch = this.touch) {
    const W = Math.max(320, window.innerWidth), H = Math.max(240, window.innerHeight);
    this.w = W; this.h = H; this.touch = touch;
    const s = this.svg;
    while (s.firstChild) s.removeChild(s.firstChild);
    s.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const cx = W / 2, cy = H / 2;
    const u = Math.min(W, H) / 100; // (one unit: a hundredth of the shorter side)
    this.u = u;
    const defs = el('defs', {}, s);
    // ---- the pitch ladder: a rung every 10 degrees, solid above the horizon, dashed below
    this.ladder = el('g', { class: 'jh-ladder' }, s);
    this.rungs = [];
    const half = Math.min(W * 0.16, 30 * u), gap = Math.min(W * 0.05, 9 * u);
    for (let a = -90; a <= 90; a += 10) {
      const g = el('g', {}, this.ladder);
      if (a === 0) {
        el('path', { d: `M${-half * 1.9} 0H${-gap}M${gap} 0H${half * 1.9}` }, g);
      } else {
        const tick = a > 0 ? 1.4 * u : -1.4 * u;
        el('path', { d: `M${-half} ${tick}V0H${-gap}M${gap} 0H${half}V${tick}`, 'stroke-dasharray': a < 0 ? `${1.6 * u} ${1.1 * u}` : 'none' }, g);
        for (const x of [-half - 1.2 * u, half + 1.2 * u]) {
          const tx = el('text', { x, y: 0.5 * u, 'text-anchor': x < 0 ? 'end' : 'start', class: 'jh-small' }, g);
          tx.textContent = String(Math.abs(a));
        }
      }
      this.rungs.push({ a, g });
    }
    // ---- the heading tape along the top
    const tapeW = Math.min(W * 0.34, 64 * u), tapeY = Math.max(5.5 * u, 34);
    this.pxDeg = tapeW / 50;
    const clip = el('clipPath', { id: 'jh-hclip' }, defs);
    el('rect', { x: cx - tapeW / 2, y: tapeY - 4 * u, width: tapeW, height: 7 * u }, clip);
    const hwrap = el('g', { 'clip-path': 'url(#jh-hclip)' }, s);
    this.htape = el('g', {}, hwrap);
    let d = '';
    for (let a = -40; a <= 400; a += 5) {
      const x = a * this.pxDeg;
      d += `M${x} ${tapeY}V${tapeY + (a % 10 === 0 ? 1.6 * u : 0.9 * u)}`;
      if (a % 10 === 0) {
        const tx = el('text', { x, y: tapeY - 0.8 * u, 'text-anchor': 'middle', class: 'jh-small' }, this.htape);
        tx.textContent = pad2((((a / 10) % 36) + 36) % 36);
      }
    }
    el('path', { d }, this.htape);
    this.hx0 = cx;
    el('path', { d: `M${cx} ${tapeY + 2.1 * u}l${-1 * u} ${1.5 * u}h${2 * u}z`, class: 'jh-fill' }, s);
    el('rect', { x: cx - 4.2 * u, y: tapeY + 3.8 * u, width: 8.4 * u, height: 3.4 * u, class: 'jh-box' }, s);
    this.hdg = el('text', { x: cx, y: tapeY + 6.4 * u, 'text-anchor': 'middle', class: 'jh-num' }, s);
    // ---- the bank scale: an arc above the middle, its ticks at 10, 20, 30, 45 and 60 degrees
    const br = Math.min(H * 0.3, 34 * u);
    this.bankR = br;
    let bd = '';
    for (const b of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r0 = br, r1 = br + (b % 30 === 0 ? 2.2 * u : 1.3 * u);
      const q = (b - 90) / DEG;
      bd += `M${cx + Math.cos(q) * r0} ${cy + Math.sin(q) * r0}L${cx + Math.cos(q) * r1} ${cy + Math.sin(q) * r1}`;
    }
    el('path', { d: bd, class: 'jh-thin' }, s);
    this.bankPtr = el('path', { d: `M0 ${-br}l${-0.9 * u} ${1.6 * u}h${1.8 * u}z`, class: 'jh-fill' }, s);
    // ---- the circle in the middle: where we look, where it goes, where the cannon aims
    const R = Math.max(14, 3.4 * u);
    el('circle', { cx, cy, r: R }, s);
    el('circle', { cx, cy, r: 1.6, class: 'jh-fill' }, s);
    el('path', { d: `M${cx - R - 1.4 * u} ${cy}h${1.1 * u}M${cx + R + 0.3 * u} ${cy}h${1.1 * u}M${cx} ${cy - R - 1.4 * u}v${1.1 * u}` }, s);
    // ---- the nose's mark (the waterline), banked as the jet banks
    this.nose = el('path', { d: `M${-3.6 * u} 0H${-1.8 * u}L${-0.9 * u} ${1.2 * u}L0 0L${0.9 * u} ${1.2 * u}L${1.8 * u} 0H${3.6 * u}` }, s);
    // ---- the flight path marker: where it is really going
    this.fpm = el('path', { d: `M${-1.1 * u} 0a${1.1 * u} ${1.1 * u} 0 1 0 ${2.2 * u} 0a${1.1 * u} ${1.1 * u} 0 1 0 ${-2.2 * u} 0M${-1.1 * u} 0H${-2.8 * u}M${1.1 * u} 0H${2.8 * u}M0 ${-1.1 * u}V${-2.3 * u}` }, s);
    // ---- speed on the left, height on the right: a number in a box, and what goes with it
    const sideX = Math.min(W * 0.3, 52 * u);
    const box = (x, anchor) => {
      el('rect', { x: anchor === 'end' ? x - 11 * u : x, y: cy - 2.2 * u, width: 11 * u, height: 4.4 * u, class: 'jh-box' }, s);
      return el('text', { x: anchor === 'end' ? x - 1 * u : x + 1 * u, y: cy + 1.3 * u, 'text-anchor': anchor, class: 'jh-num' }, s);
    };
    this.spd = box(cx - sideX + 11 * u, 'end');
    this.alt = box(cx + sideX - 11 * u, 'start');
    const label = (x, y, anchor, cls = 'jh-small') => el('text', { x, y, 'text-anchor': anchor, class: cls }, s);
    this.spdUnit = label(cx - sideX + 11 * u, cy - 3.2 * u, 'end');
    this.mach = label(cx - sideX + 11 * u, cy + 5.6 * u, 'end');
    this.gload = label(cx - sideX + 11 * u, cy + 8.6 * u, 'end');
    this.altUnit = label(cx + sideX - 11 * u, cy - 3.2 * u, 'start');
    this.agl = label(cx + sideX - 11 * u, cy + 5.6 * u, 'start');
    this.vs = label(cx + sideX - 11 * u, cy + 8.6 * u, 'start');
    // ---- engines and gear (lower left), weapons (lower right)
    const lowY = touch ? Math.max(tapeY + 12 * u, 64 + 3 * u) : cy + Math.min(H * 0.25, 30 * u);
    this.mode = label(cx - sideX, lowY, 'start', 'jh-text');
    this.thr = label(cx - sideX, lowY + 3.4 * u, 'start', 'jh-text');
    this.thrBar = el('rect', { x: cx - sideX, y: lowY + 4.6 * u, width: 0, height: 0.9 * u, class: 'jh-fill' }, s);
    el('rect', { x: cx - sideX, y: lowY + 4.6 * u, width: 16 * u, height: 0.9 * u, class: 'jh-thin' }, s);
    this.gear = label(cx - sideX, lowY + 8.6 * u, 'start', 'jh-text');
    this.gun = label(cx + sideX, lowY, 'end', 'jh-text');
    this.msl = label(cx + sideX, lowY + 3.4 * u, 'end', 'jh-text');
    this.fp = label(cx + sideX, lowY + 6.8 * u, 'end', 'jh-text');
    this.hp = label(cx + sideX, lowY + 10.2 * u, 'end', 'jh-text');
    // ---- the lock box
    this.lock = el('g', {}, s);
    this.lockBox = el('rect', { x: -2.8 * u, y: -2.8 * u, width: 5.6 * u, height: 5.6 * u }, this.lock);
    this.lockText = el('text', { x: 0, y: -3.6 * u, 'text-anchor': 'middle', class: 'jh-small' }, this.lock);
    // ---- the warnings, and a line of help at first
    this.warn = el('text', { x: cx, y: cy + Math.min(H * 0.17, 20 * u), 'text-anchor': 'middle', class: 'jh-warn' }, s);
    this.help = el('text', { x: cx, y: H - Math.max(9 * u, 70), 'text-anchor': 'middle', class: 'jh-help' }, s);
  }

  hide() {
    this.svg.style.display = 'none';
    this.shownAt = 0;
  }

  // info: see Game.jetHudInfo.
  show(info) {
    if (Math.abs(window.innerWidth - this.w) > 1 || Math.abs(window.innerHeight - this.h) > 1 || !!info.touch !== this.touch) this.build(!!info.touch);
    if (this.svg.style.display === 'none' || !this.shownAt) { this.svg.style.display = ''; this.shownAt = performance.now(); }
    const W = this.w, H = this.h, u = this.u, cx = W / 2, cy = H / 2;
    const at = (p) => (p ? [p[0] * W, p[1] * H] : null);
    // the pitch ladder, where the camera looks
    const th = Math.tan(info.fov / 2);
    for (const r of this.rungs) {
      const da = (r.a / DEG) - info.camPitch;
      if (Math.abs(da) > 1.3) { r.g.style.display = 'none'; continue; }
      const y = cy - (H / 2) * (Math.tan(da) / th);
      // (the ladder keeps to the middle of the view, clear of the speed, height and weapons)
      if (Math.abs(y - cy) > H * 0.27) { r.g.style.display = 'none'; continue; }
      r.g.style.display = '';
      r.g.setAttribute('transform', `translate(${cx} ${y.toFixed(1)})`);
    }
    // heading
    const hdg = ((Math.round(info.heading) % 360) + 360) % 360;
    this.htape.setAttribute('transform', `translate(${(this.hx0 - info.heading * this.pxDeg).toFixed(1)} 0)`);
    this.hdg.textContent = String(hdg).padStart(3, '0');
    // bank
    const bank = Math.max(-70, Math.min(70, info.bank * DEG));
    // (a bank to the right, its right wing down: the pointer and the nose's mark turn clockwise)
    this.bankPtr.setAttribute('transform', `translate(${cx} ${cy}) rotate(${bank.toFixed(1)})`);
    // the nose and the flight path
    const n = at(info.nose);
    if (n) { this.nose.style.display = ''; this.nose.setAttribute('transform', `translate(${n[0].toFixed(1)} ${n[1].toFixed(1)}) rotate(${(info.bank * DEG).toFixed(1)})`); }
    else this.nose.style.display = 'none';
    const f = at(info.fpm);
    if (f && info.speed > 20) { this.fpm.style.display = ''; this.fpm.setAttribute('transform', `translate(${f[0].toFixed(1)} ${f[1].toFixed(1)})`); }
    else this.fpm.style.display = 'none';
    // speed and height
    this.spd.textContent = String(info.speed);
    this.spdUnit.textContent = 'KM/H';
    this.mach.textContent = 'M ' + (info.speed / 1225).toFixed(2);
    this.gload.textContent = 'G ' + info.g.toFixed(1);
    this.alt.textContent = String(info.alt);
    this.altUnit.textContent = 'M';
    this.agl.textContent = 'R ' + Math.max(0, info.agl);
    this.vs.textContent = (info.vs >= 0 ? '↑ ' : '↓ ') + Math.abs(Math.round(info.vs)) + ' M/S';
    // engines and gear
    this.mode.textContent = t('jet.hud.' + info.mode);
    this.thr.textContent = t('jet.hud.thr', { n: Math.round(info.throttle * 100) }) + (info.ab > 0.5 ? '  AB' : '');
    this.thrBar.setAttribute('width', (16 * u * Math.max(0, Math.min(1, info.throttle))).toFixed(1));
    this.thr.classList.toggle('jh-hot', info.ab > 0.5);
    this.gear.textContent = info.gear ? t('jet.hud.gear') : '';
    // weapons
    this.gun.textContent = 'GUN ' + (info.ammo === null ? '∞' : info.ammo);
    const m = info.missiles;
    this.msl.textContent = m === null ? 'AIM-120 ∞  AIM-9 ∞' : `AIM-120 ${Math.max(0, m - 2)}  AIM-9 ${Math.min(2, m)}`;
    this.fp.textContent = t('jet.hud.fp') + ' ' + '▮'.repeat(info.firepower) + '▯'.repeat(5 - info.firepower) + ' ' + info.firepower;
    this.hp.textContent = 'HP ' + info.hp + '%';
    this.hp.classList.toggle('jh-hot', info.hp < 35);
    // the lock
    const L = info.lock && at(info.lock.at);
    if (L) {
      this.lock.style.display = '';
      this.lock.setAttribute('transform', `translate(${L[0].toFixed(1)} ${L[1].toFixed(1)})`);
      this.lock.classList.toggle('jh-locked', !!info.lock.locked);
      this.lockBox.setAttribute('stroke-dasharray', info.lock.locked ? 'none' : `${1.2 * u} ${0.9 * u}`);
      this.lockText.textContent = info.lock.locked ? 'LOCK ' + (info.lock.dist >= 1000 ? (info.lock.dist / 1000).toFixed(1) + ' KM' : Math.round(info.lock.dist) + ' M') : '';
    } else this.lock.style.display = 'none';
    // warnings: blinking
    const blink = Math.floor(performance.now() / 280) % 2 === 0;
    const w = info.gcas ? 'PULL UP' : info.stall ? 'STALL' : info.lowAmmo ? '' : '';
    this.warn.textContent = w && blink ? w : '';
    const fresh = performance.now() - this.shownAt < 14000;
    this.help.textContent = fresh ? t(info.touch ? 'jet.help.touch' : 'jet.help.keys') : '';
  }
}
