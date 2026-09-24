// Procedural sound: block break/place/step per material, splashes and ambience.
// Everything is synthesised with WebAudio, no sample files.

const MATERIAL = {
  stone: { f: 1700, q: 1.1, decay: 0.13, thump: 110, gain: 0.55 },
  grass: { f: 950, q: 0.6, decay: 0.2, thump: 80, gain: 0.5, crunch: true },
  gravel: { f: 1300, q: 0.7, decay: 0.22, thump: 90, gain: 0.55, crunch: true },
  wood: { f: 650, q: 2.6, decay: 0.12, thump: 190, gain: 0.6, knock: true },
  sand: { f: 2600, q: 0.45, decay: 0.2, thump: 60, gain: 0.35 },
  glass: { f: 3800, q: 5, decay: 0.28, thump: 0, gain: 0.5, ring: [2200, 3500, 5200] },
  cloth: { f: 700, q: 0.5, decay: 0.1, thump: 70, gain: 0.4 },
  snow: { f: 1100, q: 0.4, decay: 0.16, thump: 50, gain: 0.35, crunch: true },
  metal: { f: 2400, q: 4, decay: 0.3, thump: 140, gain: 0.45, ring: [620, 1180, 1870] },
  water: { f: 600, q: 0.5, decay: 0.3, thump: 0, gain: 0.4 },
};

export class Audio {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.ambientOn = true;
    this.noiseBuf = null;
    this.ambient = null;
    this.nextBird = 0;
    this.nextCricket = 0;
    this.nextDrip = 0;
  }

  // Must be called from a user gesture.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startAmbient();
    } catch (e) {
      this.ctx = null;
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  noise(t, dur, filterType, freq, q, gain, dest = this.master) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, dur + 0.05);
    return { f, g };
  }

  tone(t, freq, dur, gain, type = 'sine', slideTo = null) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  play(kind, material = 'stone', volume = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const m = MATERIAL[material] || MATERIAL.stone;
    const t = this.ctx.currentTime + 0.005;
    const pitch = 0.85 + Math.random() * 0.3;
    if (kind === 'break') {
      this.noise(t, m.decay * 1.6, 'bandpass', m.f * pitch, m.q, m.gain * volume);
      if (m.crunch) for (let i = 1; i < 4; i++) this.noise(t + i * 0.035, 0.06, 'bandpass', m.f * 1.6 * pitch, 1.2, m.gain * 0.35 * volume);
      if (m.thump) this.tone(t, m.thump * pitch, 0.12, 0.35 * volume, 'sine', m.thump * 0.5);
      if (m.knock) this.tone(t, 240 * pitch, 0.08, 0.25 * volume, 'triangle', 120);
      if (m.ring) m.ring.forEach((f, i) => this.tone(t + i * 0.01, f * pitch, 0.35 - i * 0.06, 0.07 * volume, 'sine'));
    } else if (kind === 'place') {
      this.noise(t, m.decay, 'bandpass', m.f * 0.8 * pitch, m.q, m.gain * 0.7 * volume);
      if (m.thump) this.tone(t, m.thump * 1.1 * pitch, 0.09, 0.4 * volume, 'sine', m.thump * 0.6);
      if (m.knock) this.tone(t, 200 * pitch, 0.07, 0.3 * volume, 'triangle', 110);
    } else if (kind === 'step') {
      this.noise(t, m.decay * 0.7, 'bandpass', m.f * 0.9 * pitch, m.q * 0.8, m.gain * 0.22 * volume);
      if (m.thump) this.tone(t, m.thump * 0.8 * pitch, 0.06, 0.1 * volume, 'sine');
    } else if (kind === 'splash') {
      const n = this.noise(t, 0.6, 'lowpass', 2400, 0.6, 0.5 * volume);
      n.f.frequency.exponentialRampToValueAtTime(300, t + 0.6);
    } else if (kind === 'swim') {
      const n = this.noise(t, 0.35, 'lowpass', 900, 0.8, 0.14 * volume);
      n.f.frequency.exponentialRampToValueAtTime(250, t + 0.35);
    } else if (kind === 'click') {
      this.tone(t, 900, 0.05, 0.08, 'triangle', 600);
    } else if (kind === 'pop') {
      this.tone(t, 500, 0.08, 0.12, 'sine', 900);
    } else if (kind === 'thunder') {
      // a sharp crack for close strikes, then a long rolling rumble
      const v = Math.max(0.15, volume);
      if (v > 0.8) this.noise(t, 0.35, 'bandpass', 1400, 0.6, 0.5 * v);
      const rumble = this.noise(t + 0.05, 3.8, 'lowpass', 260, 0.9, 0.9 * v);
      rumble.f.frequency.setValueAtTime(420, t);
      rumble.f.frequency.exponentialRampToValueAtTime(90, t + 3.5);
      for (let i = 1; i < 4; i++) this.noise(t + 0.4 * i + Math.random() * 0.3, 1.6, 'lowpass', 180, 0.8, 0.45 * v / i);
    }
  }

  startAmbient() {
    const c = this.ctx;
    // wind: filtered looping noise with slow gusts
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    lp.Q.value = 0.4;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    // rain: bright hiss plus a softer low patter, both on looping noise
    const rs = c.createBufferSource();
    rs.buffer = this.noiseBuf;
    rs.loop = true;
    rs.playbackRate.value = 0.9;
    const rf = c.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 2600;
    rf.Q.value = 0.35;
    const rl = c.createBiquadFilter();
    rl.type = 'lowpass';
    rl.frequency.value = 9000;
    const rg = c.createGain();
    rg.gain.value = 0;
    rs.connect(rf).connect(rl).connect(rg).connect(this.master);
    rs.start();
    this.ambient = { wind: g, windFilter: lp, rain: rg, rainFilter: rl };
  }

  // Called every frame with the environment around the player.
  update(env) {
    if (!this.ctx || !this.ambient || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const on = this.ambientOn ? 1 : 0;
    const outdoor = env.skyLight;
    const gust = 0.5 + 0.5 * Math.sin(t * 0.21) * Math.sin(t * 0.13 + 1.3);
    const windTarget = on * (0.018 + 0.05 * gust) * outdoor * outdoor * (1 + Math.max(0, env.altitude - 80) / 40) * (env.underwater ? 0.2 : 1);
    this.ambient.wind.gain.setTargetAtTime(windTarget, t, 0.5);
    this.ambient.windFilter.frequency.setTargetAtTime(env.underwater ? 180 : 300 + gust * 400, t, 0.5);
    // rain is muffled indoors and under water
    const rain = env.rain || 0;
    this.ambient.rain.gain.setTargetAtTime(on * rain * (0.05 + 0.13 * outdoor) * (env.underwater ? 0.3 : 1), t, 0.6);
    this.ambient.rainFilter.frequency.setTargetAtTime(env.underwater ? 500 : 1200 + 7800 * outdoor * outdoor, t, 0.4);
    if (!on || env.underwater) return;
    if (rain > 0.3) return; // birds and crickets keep quiet in the rain
    // birds by day in the open
    if (env.day > 0.5 && outdoor > 0.7 && t > this.nextBird) {
      this.nextBird = t + 2 + Math.random() * 7;
      const base = 2400 + Math.random() * 1800;
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const tt = t + i * (0.09 + Math.random() * 0.06);
        this.tone(tt, base * (0.9 + Math.random() * 0.25), 0.07 + Math.random() * 0.05, 0.018, 'sine', base * (1.1 + Math.random() * 0.4));
      }
    }
    // crickets at night
    if (env.day < 0.3 && outdoor > 0.6 && t > this.nextCricket) {
      this.nextCricket = t + 0.8 + Math.random() * 2.5;
      const f = 4200 + Math.random() * 600;
      for (let i = 0; i < 3; i++) this.tone(t + i * 0.06, f, 0.04, 0.008, 'sine');
    }
    // cave drips
    if (outdoor < 0.2 && t > this.nextDrip) {
      this.nextDrip = t + 3 + Math.random() * 9;
      this.tone(t, 1400 + Math.random() * 900, 0.12, 0.03, 'sine', 700);
    }
  }
}

export function materialOf(block) {
  return block && block.sound ? block.sound : 'stone';
}
