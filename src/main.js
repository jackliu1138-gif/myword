// Entry point.
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';
import { setLanguage, detectLanguage } from './ui/i18n.js';
import { loadSettings } from './game/save.js';
import { collectDeviceInfo } from './game/device.js';

const FONTS = 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Pixelify+Sans:wght@500;700&display=swap';

// Web fonts are loaded from script so that a font host which is slow or unreachable
// (common on some networks) never holds up the first paint; the UI falls back to system fonts.
function loadFonts() {
  try {
    if (document.querySelector('link[data-fonts]')) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONTS;
    l.dataset.fonts = '1';
    document.head.appendChild(l);
  } catch (e) { /* ignore */ }
}

function params() {
  const out = {};
  try {
    for (const [k, v] of new URLSearchParams(location.search)) out[k] = v;
  } catch (e) { /* ignore */ }
  return out;
}

async function boot(hotData) {
  loadFonts();
  const q = params();
  const saved = loadSettings();
  setLanguage(q.lang || (saved && saved.language) || detectLanguage());
  const ui = new UI();
  const canvas = document.getElementById('view');
  const opts = {};
  // test hooks: ?seed=123&preset=low&fresh=1&lang=zh
  if (q.seed !== undefined) opts.seed = parseInt(q.seed, 10) | 0;
  if (q.fresh) opts.freshWorld = true;
  if (q.preset) opts.settingsOverride = { preset: q.preset };
  if (q.lang) opts.settingsOverride = { ...(opts.settingsOverride || {}), language: q.lang };
  const game = new Game(canvas, ui, opts);
  window.__lumen = game;
  try {
    await game.start();
    if (q.preset) {
      game.changeSetting('preset', q.preset);
    }
    if (hotData && hotData.player && game.player) {
      game.player.pos = hotData.player.pos;
      game.player.yaw = hotData.player.yaw;
      game.player.pitch = hotData.player.pitch;
    }
  } catch (err) {
    console.error(err);
    ui.showError(err && err.message ? err.message : String(err), collectDeviceInfo(null));
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(() => ({ player: game.player ? { pos: game.player.pos, yaw: game.player.yaw, pitch: game.player.pitch } : null }));
  }
}

const hot = window.claude && window.claude.hot;
if (hot && hot.ready) hot.ready(boot);
else boot(hot && hot.data ? hot.data : null);
