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
    this.touch = { active: false, move: [0, 0], jump: false, sneak: false, breakHeld: false, tap: false, toggleFly: false, menu: false, inventory: false };
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

// On-screen controls for touch devices.
export class TouchControls {
  constructor(root, input) {
    this.input = input;
    this.root = root;
    this.stickId = null;
    this.lookId = null;
    this.lookLast = null;
    this.lookStart = null;
    this.lookStartTime = 0;
    this.holdTimer = null;
    const el = document.createElement('div');
    el.className = 'touch-ui';
    el.innerHTML = `
      <div class="touch-stick"><div class="touch-knob"></div></div>
      <button class="touch-btn touch-jump" aria-label="Jump">&#9650;</button>
      <button class="touch-btn touch-sneak" aria-label="Sneak or fly down">&#9660;</button>
      <button class="touch-btn touch-fly" aria-label="Toggle flying">FLY</button>
      <button class="touch-btn touch-inv" aria-label="Inventory">&#9638;</button>
      <button class="touch-btn touch-menu" aria-label="Pause">II</button>`;
    root.appendChild(el);
    this.el = el;
    this.stick = el.querySelector('.touch-stick');
    this.knob = el.querySelector('.touch-knob');
    const hold = (sel, key) => {
      const b = el.querySelector(sel);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.touch[key] = true; }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); input.touch[key] = false; }, { passive: false });
    };
    hold('.touch-jump', 'jump');
    hold('.touch-sneak', 'sneak');
    el.querySelector('.touch-fly').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.touch.toggleFly = true; }, { passive: false });
    el.querySelector('.touch-inv').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.touch.inventory = true; }, { passive: false });
    el.querySelector('.touch-menu').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); input.touch.menu = true; }, { passive: false });

    const canvas = input.canvas;
    canvas.addEventListener('touchstart', (e) => this.onStart(e), { passive: false });
    canvas.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    canvas.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
    canvas.addEventListener('touchcancel', (e) => this.onEnd(e), { passive: false });
    this.stick.addEventListener('touchstart', (e) => this.onStart(e, true), { passive: false });
    this.stick.addEventListener('touchmove', (e) => this.onMove(e), { passive: false });
    this.stick.addEventListener('touchend', (e) => this.onEnd(e), { passive: false });
  }

  show(v) {
    this.el.classList.toggle('visible', v);
  }

  onStart(e, fromStick = false) {
    if (!this.input.enabled) return;
    e.preventDefault();
    this.input.touch.active = true;
    for (const t of e.changedTouches) {
      const left = t.clientX < window.innerWidth * 0.4;
      if ((fromStick || left) && this.stickId === null) {
        this.stickId = t.identifier;
        const r = this.stick.getBoundingClientRect();
        this.stickCenter = [r.left + r.width / 2, r.top + r.height / 2];
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
    const max = 46;
    const len = Math.hypot(dx, dy);
    const k = len > max ? max / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    this.input.touch.move = [(dx * k) / max, (dy * k) / max];
  }

  onMove(e) {
    if (!this.input.enabled) return;
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) this.updateStick(t);
      else if (t.identifier === this.lookId) {
        const dx = t.clientX - this.lookLast[0], dy = t.clientY - this.lookLast[1];
        this.lookLast = [t.clientX, t.clientY];
        if (Math.hypot(t.clientX - this.lookStart[0], t.clientY - this.lookStart[1]) > 12) this.moved = true;
        this.input.mouseDX += dx * 2.2;
        this.input.mouseDY += dy * 2.2;
      }
    }
  }

  onEnd(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === this.stickId) {
        this.stickId = null;
        this.knob.style.transform = '';
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
