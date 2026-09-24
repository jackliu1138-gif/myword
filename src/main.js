// Entry point.
import { Game } from './game/game.js';
import { UI } from './ui/ui.js';

function params() {
  const out = {};
  try {
    for (const [k, v] of new URLSearchParams(location.search)) out[k] = v;
  } catch (e) { /* ignore */ }
  return out;
}

async function boot(hotData) {
  const ui = new UI();
  const canvas = document.getElementById('view');
  const q = params();
  const opts = {};
  // test hooks: ?seed=123&preset=low&fresh=1
  if (q.seed !== undefined) opts.seed = parseInt(q.seed, 10) | 0;
  if (q.fresh) opts.freshWorld = true;
  if (q.preset) opts.settingsOverride = { preset: q.preset };
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
    ui.showError(err && err.message ? err.message : String(err));
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(() => ({ player: game.player ? { pos: game.player.pos, yaw: game.player.yaw, pitch: game.player.pitch } : null }));
  }
}

const hot = window.claude && window.claude.hot;
if (hot && hot.ready) hot.ready(boot);
else boot(hot && hot.data ? hot.data : null);
