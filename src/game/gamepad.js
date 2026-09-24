// Game controllers through the Gamepad API (standard mapping: Xbox, PlayStation, Switch Pro and
// most Android / TV pads). Polled once per frame; exposes sticks with dead zones, held buttons and
// buttons pressed since the last frame, plus rumble.

export const PAD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11,
  UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16,
};

const DEAD = 0.18;

function radial(x, y) {
  const len = Math.hypot(x, y);
  if (len < DEAD) return [0, 0];
  const k = Math.min(1, (len - DEAD) / (1 - DEAD)) / len;
  return [x * k, y * k];
}

export function padStyle(id) {
  const s = String(id || '').toLowerCase();
  // (Xbox pads also call themselves "Wireless Controller", like the DualShock 4)
  if (/xbox|xinput|045e/.test(s)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense|wireless controller/.test(s)) return 'ps';
  if (/057e|nintendo|pro controller|joy-con/.test(s)) return 'nintendo';
  return 'xbox';
}

// Face-button names per controller family, for on-screen hints.
export const GLYPHS = {
  xbox: { A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LB', RB: 'RB', LT: 'LT', RT: 'RT' },
  ps: { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2' },
  nintendo: { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR' },
};

export class Gamepads {
  constructor() {
    this.index = -1;
    this.id = '';
    this.style = 'xbox';
    this.buttons = new Float32Array(17);
    this.prev = new Float32Array(17);
    this.left = [0, 0];
    this.right = [0, 0];
    this.connected = false;
    this.lastActive = 0;
    this.onConnect = null;
    this.onDisconnect = null;
    this.repeat = new Map(); // button/direction -> next repeat time, for menu navigation
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', (e) => {
        if (this.onConnect) this.onConnect(e.gamepad);
      });
      window.addEventListener('gamepaddisconnected', (e) => {
        if (e.gamepad.index === this.index) {
          this.index = -1;
          this.connected = false;
          this.buttons.fill(0);
          this.left = [0, 0];
          this.right = [0, 0];
          if (this.onDisconnect) this.onDisconnect(e.gamepad);
        }
      });
    }
  }

  poll() {
    this.prev.set(this.buttons);
    let pads = [];
    try { pads = navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { pads = []; }
    // follow whichever pad was used last
    let pad = this.index >= 0 ? pads[this.index] : null;
    for (const p of pads) {
      if (!p || !p.connected || p === pad) continue;
      if (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5)) { pad = p; break; }
    }
    if (!pad || !pad.connected) {
      this.connected = false;
      this.buttons.fill(0);
      this.left = [0, 0];
      this.right = [0, 0];
      return this;
    }
    if (pad.index !== this.index) {
      this.index = pad.index;
      this.id = pad.id;
      this.style = padStyle(pad.id);
    }
    this.connected = true;
    this.pad = pad;
    for (let i = 0; i < 17; i++) {
      const b = pad.buttons[i];
      this.buttons[i] = b ? (typeof b === 'object' ? (b.pressed ? Math.max(b.value, 0.5) : b.value) : b) : 0;
    }
    this.left = radial(pad.axes[0] || 0, pad.axes[1] || 0);
    this.right = radial(pad.axes[2] || 0, pad.axes[3] || 0);
    const active = this.buttons.some((v) => v > 0.3) || Math.hypot(...this.left) > 0 || Math.hypot(...this.right) > 0;
    if (active) this.lastActive = performance.now();
    return this;
  }

  down(b) {
    return this.buttons[b] > 0.35;
  }

  pressed(b) {
    return this.buttons[b] > 0.35 && this.prev[b] <= 0.35;
  }

  released(b) {
    return this.buttons[b] <= 0.35 && this.prev[b] > 0.35;
  }

  // Menu navigation direction with key-repeat: 'up' | 'down' | 'left' | 'right' | null.
  navDirection() {
    const now = performance.now();
    const dirs = {
      up: this.down(PAD.UP) || this.left[1] < -0.55,
      down: this.down(PAD.DOWN) || this.left[1] > 0.55,
      left: this.down(PAD.LEFT) || this.left[0] < -0.55,
      right: this.down(PAD.RIGHT) || this.left[0] > 0.55,
    };
    let out = null;
    for (const [d, on] of Object.entries(dirs)) {
      if (!on) { this.repeat.delete(d); continue; }
      const next = this.repeat.get(d);
      if (next === undefined) { this.repeat.set(d, now + 380); out = out || d; }
      else if (now >= next) { this.repeat.set(d, now + 110); out = out || d; }
    }
    return out;
  }

  rumble(strong, weak, ms) {
    const a = this.pad && this.pad.vibrationActuator;
    if (!a || !a.playEffect) return;
    try { a.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch (e) { /* ignore */ }
  }
}
