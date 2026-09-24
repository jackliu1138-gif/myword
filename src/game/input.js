// Keyboard, mouse (pointer lock with a drag-to-look fallback) and touch input.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed since last frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.clicked = new Set(); // mouse buttons pressed since last frame
    this.wheel = 0;
    this.locked = false;
    this.lockFailed = false;
    this.dragging = false;
    this.enabled = false; // only capture while playing
    this.onLockChange = null;
    this.touch = { active: false, move: [0, 0], jump: false, sneak: false, breakHeld: false, breakBtn: false, tap: false, toggleFly: false, menu: false, inventory: false };
    this.lastSpace = 0;
    this.doubleSpace = false;
    this.lastW = 0;
    this.doubleW = false;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => {
      this.buttons.delete(e.button);
      if (e.button === 0 || e.button === 2) this.dragging = false;
    });
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    canvas.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.everLocked = false;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.everLocked = true;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      // A first failure means the frame doesn't allow pointer lock: fall back to drag-to-look.
      // Later failures are usually "re-locked too soon after Esc" and can be retried with a click.
      if (!this.everLocked) this.lockFailed = true;
      if (this.onLockError) this.onLockError();
    });
  }

  requestLock() {
    if (this.lockFailed || !this.canvas.requestPointerLock) return false;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => {
          // retry without unadjustedMovement (unsupported on some platforms)
          try {
            const p2 = this.canvas.requestPointerLock();
            if (p2 && p2.catch) p2.catch(() => { if (!this.everLocked) this.lockFailed = true; });
          } catch (err) { if (!this.everLocked) this.lockFailed = true; }
        });
      }
      return true;
    } catch (err) {
      this.lockFailed = true;
      return false;
    }
  }

  exitLock() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  onKey(e, down) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const code = e.code;
    if (down) {
      if (!this.keys.has(code)) {
        this.pressed.add(code);
        const now = performance.now();
        if (code === 'Space') {
          if (now - this.lastSpace < 300) this.doubleSpace = true;
          this.lastSpace = now;
        }
        if (code === 'KeyW') {
          if (now - this.lastW < 280) this.doubleW = true;
          this.lastW = now;
        }
      }
      this.keys.add(code);
    } else {
      this.keys.delete(code);
    }
    if (this.enabled) {
      // keep the page from scrolling / browser shortcuts stealing game keys
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3', 'Tab', 'Slash', 'Quote'].includes(code)) e.preventDefault();
    }
  }

  onMouseDown(e) {
    if (!this.enabled) return;
    this.buttons.add(e.button);
    this.clicked.add(e.button);
    if (!this.locked) this.dragging = true;
    e.preventDefault();
  }

  onMouseMove(e) {
    if (!this.enabled) return;
    if (this.locked) {
      // guard against spurious huge jumps some browsers report
      if (Math.abs(e.movementX) < 400 && Math.abs(e.movementY) < 400) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    } else if (this.dragging && this.lockFailed) {
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    }
  }

  down(code) {
    return this.keys.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  consumeFrame() {
    const r = { dx: this.mouseDX, dy: this.mouseDY, wheel: this.wheel, doubleSpace: this.doubleSpace, doubleW: this.doubleW };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.doubleSpace = false;
    this.doubleW = false;
    return r;
  }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
  }
}

// On-screen controls for touch devices: a floating stick on the left, drag-to-look anywhere else,
// tap to place / hold to break on the view itself, plus buttons for players who prefer them.
const ICONS = {
  jump: '<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sneak: '<svg viewBox="0 0 24 24"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  break: '<svg viewBox="0 0 24 24"><path d="M5.5 19.5l9.5-9.5" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="M7.5 6.2c4.6-3.3 10.4-2.4 13.3 1.9.3.5-.3 1-.8.7-2.7-1.6-6.2-1.6-9 .1z" fill="currentColor"/><path d="M13 6.4l4.4 4.4" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  place: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  inventory: '<svg viewBox="0 0 24 24"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  fly: '<svg viewBox="0 0 24 24"><path d="M12 13c-2-4.5-5.6-7-9.5-7.5 1 4.2 3.8 7.4 7.8 8.4M12 13c2-4.5 5.6-7 9.5-7.5-1 4.2-3.8 7.4-7.8 8.4M12 13v7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

export class TouchControls {
  // opts: { settings: () => settings object, t: translate }
  constructor(root, input, opts = {}) {
    this.input = input;
    this.root = root;
    this.opts = opts;
    this.stickId = null;
    this.lookId = null;
    this.lookLast = null;
    this.lookStart = null;
    this.lookStartTime = 0;
    this.holdTimer = null;
    const el = document.createElement('div');
    el.className = 'touch-ui';
    const btn = (cls, key, icon, label) => `<button type="button" class="touch-btn ${cls}" data-key="${key}" data-label="${label}">${icon}</button>`;
    el.innerHTML = `
      <div class="touch-stick"><div class="touch-knob"></div></div>
      ${btn('touch-jump', 'jump', ICONS.jump, 'touch.jump')}
      ${btn('touch-sneak', 'sneak', ICONS.sneak, 'touch.sneak')}
      ${btn('touch-break', 'breakBtn', ICONS.break, 'touch.break')}
      ${btn('touch-place', 'placeBtn', ICONS.place, 'touch.place')}
      ${btn('touch-fly', 'toggleFly', ICONS.fly, 'touch.fly')}
      <div class="touch-top">
        ${btn('touch-full', 'fullscreen', ICONS.fullscreen, 'touch.fullscreen')}
        ${btn('touch-inv', 'inventory', ICONS.inventory, 'touch.inventory')}
        ${btn('touch-menu', 'menu', ICONS.pause, 'touch.pause')}
      </div>
      <div class="touch-rotate" hidden></div>`;
    root.appendChild(el);
    this.el = el;
    this.stick = el.querySelector('.touch-stick');
    this.knob = el.querySelector('.touch-knob');
    this.rotateHint = el.querySelector('.touch-rotate');
    const fsOk = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (!fsOk) el.querySelector('.touch-full').hidden = true;

    // buttons: hold keys stay down while touched, the others fire once per press
    const holdKeys = new Set(['jump', 'sneak', 'breakBtn']);
    for (const b of el.querySelectorAll('.touch-btn')) {
      const key = b.dataset.key;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!this.input.enabled && key !== 'fullscreen') return;
        b.classList.add('down');
        this.input.touch.active = true;
        if (holdKeys.has(key)) input.touch[key] = true;
        else if (key === 'placeBtn') input.touch.tap = true;
        else if (key === 'fullscreen') this.toggleFullscreen();
        else input.touch[key] = true;
      };
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('down');
        if (holdKeys.has(key)) input.touch[key] = false;
      };
      b.addEventListener('touchstart', down, { passive: false });
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    const canvas = input.canvas;
    canvas.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    // iOS pinch-zoom and callouts
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.layout());
    this.refreshLabels();
    this.applySettings();
  }

  get settings() {
    return this.opts.settings ? this.opts.settings() : {};
  }

  applySettings() {
    const s = this.settings;
    this.el.style.setProperty('--touch-scale', String(s.touchSize || 1));
    this.el.style.setProperty('--touch-alpha', String(s.touchOpacity ?? 0.7));
    this.layout();
  }

  refreshLabels() {
    const t = this.opts.t || ((k) => k);
    for (const b of this.el.querySelectorAll('.touch-btn')) b.setAttribute('aria-label', t(b.dataset.label));
    this.rotateHint.textContent = t('touch.rotate');
  }

  layout() {
    const portrait = window.innerHeight > window.innerWidth * 1.1;
    this.el.classList.toggle('portrait', portrait);
    this.rotateHint.hidden = !(portrait && Math.min(window.innerWidth, window.innerHeight) < 700);
  }

  show(v) {
    this.el.classList.toggle('visible', v);
    if (!v) this.release();
  }

  setFlyVisible(v) {
    this.el.querySelector('.touch-fly').hidden = !v;
  }

  // drop every held control (menus opened, focus lost)
  release() {
    const tc = this.input.touch;
    tc.move = [0, 0];
    tc.jump = tc.sneak = tc.breakBtn = tc.breakHeld = false;
    this.stickId = null;
    this.lookId = null;
    this.knob.style.transform = '';
    this.stick.classList.remove('floating');
    this.stick.style.left = this.stick.style.top = '';
    clearTimeout(this.holdTimer);
    for (const b of this.el.querySelectorAll('.touch-btn.down')) b.classList.remove('down');
  }

  toggleFullscreen() {
    const d = document;
    const el = d.documentElement;
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
      else {
        const p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
        const lock = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* ignore */ } };
        if (p && p.then) p.then(lock).catch(() => {}); else lock();
      }
    } catch (e) { /* not available */ }
  }

  vibrate(ms) {
    if (!this.settings.touchHaptics || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  onStart(e) {
    if (!this.input.enabled) return;
    e.preventDefault();
    this.input.touch.active = true;
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.42 && t.clientY > window.innerHeight * 0.25;
      if (left && this.stickId === null) {
        this.stickId = t.identifier;
        // the stick appears under the thumb, kept fully on screen
        const r = this.stick.getBoundingClientRect();
        const half = r.width / 2;
        const cx = Math.max(half + 8, Math.min(window.innerWidth * 0.42, t.clientX));
        const cy = Math.max(half + 8, Math.min(window.innerHeight - half - 8, t.clientY));
        this.stick.classList.add('floating');
        this.stick.style.left = (cx - half) + 'px';
        this.stick.style.top = (cy - half) + 'px';
        this.stickCenter = [cx, cy];
        this.stickRadius = half * 0.78;
        this.updateStick(t);
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLast = [t.clientX, t.clientY];
        this.lookStart = [t.clientX, t.clientY];
        this.lookStartTime = performance.now();
        this.moved = false;
        clearTimeout(this.holdTimer);
        this.holdTimer = setTimeout(() => { if (!this.moved) this.input.touch.breakHeld = true; }, 320);
      }
    }
  }

  updateStick(t) {
    const dx = t.clientX - this.stickCenter[0], dy = t.clientY - this.stickCenter[1];
    const max = this.stickRadius || 46;
    const len = Math.hypot(dx, dy);
    const k = len > max ? max / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    this.input.touch.move = [(dx * k) / max, (dy * k) / max];
    this.stick.classList.toggle('sprint', -this.input.touch.move[1] > 0.92);
  }

  onMove(e) {
    if (!this.input.enabled) return;
    e.preventDefault();
    const sens = 2.2 * (this.settings.touchSensitivity || 1);
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.updateStick(t);
      else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookLast[0], dy = t.clientY - this.lookLast[1];
        this.lookLast = [t.clientX, t.clientY];
        if (Math.hypot(t.clientX - this.lookStart[0], t.clientY - this.lookStart[1]) > 12) this.moved = true;
        this.input.mouseDX += dx * sens;
        this.input.mouseDY += dy * sens;
      }
    }
  }

  onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.knob.style.transform = '';
        this.stick.classList.remove('floating', 'sprint');
        this.stick.style.left = this.stick.style.top = '';
        this.input.touch.move = [0, 0];
      } else if (t.identifier === this.lookId) {
        this.lookId = null;
        clearTimeout(this.holdTimer);
        const quick = performance.now() - this.lookStartTime < 280;
        if (!this.moved && quick && !this.input.touch.breakHeld) this.input.touch.tap = true;
        this.input.touch.breakHeld = false;
      }
    }
  }
}
