// Spatial focus navigation for menus: lets a controller's D-pad / stick or a TV remote's arrow keys
// move between buttons, tabs, toggles, sliders and inventory slots on whatever screen is open.

const FOCUSABLE = 'button, input, [tabindex="0"]';

function visible(el) {
  if (el.disabled || el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

export class FocusNav {
  constructor() {
    this.root = null;
  }

  setRoot(el) {
    this.root = el;
  }

  candidates() {
    if (!this.root) return [];
    return Array.from(this.root.querySelectorAll(FOCUSABLE)).filter((el) => {
      // checkboxes are reached through their (visible) toggle label
      if (el.type === 'checkbox') return visible(el.closest('.toggle') || el);
      return visible(el);
    });
  }

  current() {
    const a = document.activeElement;
    return a && this.root && this.root.contains(a) && a !== this.root ? a : null;
  }

  focus(el) {
    if (!el) return;
    document.documentElement.classList.add('pad-nav');
    el.focus({ preventScroll: true });
    const box = el.type === 'checkbox' ? el.closest('.toggle') || el : el;
    box.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  rectOf(el) {
    const box = el.type === 'checkbox' ? el.closest('.toggle') || el : el;
    return box.getBoundingClientRect();
  }

  // dir: 'up' | 'down' | 'left' | 'right'
  move(dir) {
    const list = this.candidates();
    if (!list.length) return false;
    const cur = this.current();
    if (!cur) { this.focus(this.root.querySelector('.btn.primary') || list[0]); return true; }
    const r = this.rectOf(cur);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const q = this.rectOf(el);
      const qx = q.left + q.width / 2, qy = q.top + q.height / 2;
      const dx = qx - cx, dy = qy - cy;
      let along, across;
      if (dir === 'up') { along = -dy; across = Math.abs(dx); if (q.bottom > r.top + 2) continue; }
      else if (dir === 'down') { along = dy; across = Math.abs(dx); if (q.top < r.bottom - 2) continue; }
      else if (dir === 'left') { along = -dx; across = Math.abs(dy); if (q.right > r.left + 2) continue; }
      else { along = dx; across = Math.abs(dy); if (q.left < r.right - 2) continue; }
      if (along <= 0) continue;
      // overlapping rows / columns are strongly preferred
      const overlap = dir === 'up' || dir === 'down'
        ? Math.min(q.right, r.right) - Math.max(q.left, r.left)
        : Math.min(q.bottom, r.bottom) - Math.max(q.top, r.top);
      const score = along + across * (overlap > 0 ? 0.5 : 2.5);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { this.focus(best); return true; }
    return false;
  }

  // A / OK on the focused control.
  activate() {
    const el = this.current();
    if (!el) { this.move('down'); return; }
    if (el.type === 'range') return;
    el.click();
  }

  // Left / right on a slider changes its value; returns true when it did.
  adjust(sign) {
    const el = this.current();
    if (!el || el.type !== 'range') return false;
    const step = parseFloat(el.step) || 1;
    const v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), parseFloat(el.value) + sign * step));
    if (v === parseFloat(el.value)) return true;
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
}
