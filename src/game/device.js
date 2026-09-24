// Device capabilities: the first-run quality preset and the rows of the Device check screen.

import { t } from '../ui/i18n.js';

function gpuInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return { webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const info = {
      webgl2: true,
      renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
      floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
      halfTargets: !!gl.getExtension('EXT_color_buffer_half_float'),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return info;
  } catch (e) {
    return { webgl2: false };
  }
}

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
}

// TVs, projectors and set-top boxes (Android TV, Fire TV, most projector systems).
export function isTvDevice() {
  const ua = navigator.userAgent || '';
  return /\bTV\b|SmartTV|SMART-TV|Android TV|GoogleTV|AFT[A-Z]|BRAVIA|HbbTV|NetCast|Tizen|Web0S|WebOS|Dangbei|DBOS|MiBOX|MiTV/i.test(ua);
}

export function detectPreset() {
  if (isTvDevice()) return 'lite';
  const touch = isTouchDevice();
  const small = Math.min(screen.width, screen.height) < 700;
  if (touch && small) return 'lite';
  const g = gpuInfo();
  const r = g.renderer || '';
  if (!g.webgl2 || /swiftshader|llvmpipe|software/i.test(r)) return 'lite';
  // phone, tablet and TV chips
  if (/mali|adreno|powervr|videocore|vivante|imagination/i.test(r)) return touch ? 'lite' : 'low';
  if (/apple gpu/i.test(r)) return touch ? 'low' : 'medium';
  if (/intel|uhd|iris/i.test(r)) return 'medium';
  return 'high';
}

function browserName() {
  const ua = navigator.userAgent || '';
  const brands = navigator.userAgentData && navigator.userAgentData.brands;
  if (brands && brands.length) {
    const b = brands.find((x) => !/not.?a.?brand|chromium/i.test(x.brand)) || brands[0];
    return `${b.brand} ${b.version}`;
  }
  const m = ua.match(/(Edg|OPR|Firefox|Chrome|CriOS|FxiOS|Version)\/([\d.]+)/);
  if (m) return `${m[1] === 'Version' ? 'Safari' : m[1] === 'Edg' ? 'Edge' : m[1]} ${m[2]}`;
  return ua.slice(0, 60);
}

// game may be null (when the renderer could not start).
export function collectDeviceInfo(game) {
  const yes = t('dev.yes'), no = t('dev.no');
  const g = gpuInfo();
  const rows = [];
  rows.push(['dev.browser', browserName()]);
  rows.push(['dev.screen', `${screen.width}×${screen.height} @${(window.devicePixelRatio || 1).toFixed(2)}x · ${window.innerWidth}×${window.innerHeight}`]);
  rows.push(['dev.gpu', g.renderer ? g.renderer.slice(0, 90) : '—']);
  rows.push(['dev.webgl2', g.webgl2 ? yes : no, !!g.webgl2]);
  if (g.webgl2) {
    rows.push(['dev.floatTargets', g.floatTargets ? yes : g.halfTargets ? 'half float' : no, !!(g.floatTargets || g.halfTargets)]);
    rows.push(['dev.maxTexture', String(g.maxTexture)]);
  }
  rows.push(['dev.cores', String(navigator.hardwareConcurrency || '?')]);
  if (navigator.deviceMemory) rows.push(['dev.memory', `${navigator.deviceMemory} GB`]);
  rows.push(['dev.touch', isTouchDevice() ? `${yes} (${navigator.maxTouchPoints || 1})` : no]);
  let pads = [];
  try { pads = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); } catch (e) { /* ignore */ }
  rows.push(['dev.gamepads', pads.length ? pads.map((p) => `${p.id.slice(0, 48)}${p.mapping === 'standard' ? '' : ' (non-standard)'}`).join(' · ') : t('dev.gamepadsNone'), pads.length ? true : undefined]);
  rows.push(['dev.audio', window.AudioContext || window.webkitAudioContext ? yes : no]);
  let storage = false;
  try { storage = !!window.indexedDB || !!window.localStorage; } catch (e) { /* ignore */ }
  rows.push(['dev.storage', storage ? yes : no, storage]);
  if (game && game.renderer) {
    rows.push(['dev.fps', game.fps ? `${game.fps.toFixed(0)} fps` : '—']);
    rows.push(['dev.preset', t('preset.' + game.settings.preset)]);
    const tg = game.renderer.targets;
    if (tg) rows.push(['dev.resolution', `${tg.w}×${tg.h} (${Math.round(game.renderer.settings.renderScale * 100)}%)`]);
  }
  return { rows, recommend: detectPreset() };
}
