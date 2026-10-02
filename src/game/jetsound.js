// The F-22's sound, all synthesised: its two engines (the turbines' whine climbing with the
// throttle, the roar of the exhaust, its deep rumble, and with the afterburner lit the thunder and
// crackle of the fire), the rush of the air at speed, the M61 cannon's tearing buzz (a hundred
// rounds a second, too fast to hear one by one), a missile dropping from its bay and its motor
// lighting, the boom of what they hit (heard as late as sound travels: a blast a kilometre off
// takes three seconds to arrive), the seeker's tones as it locks on, and Auto-GCAS's warning.
// Through the saucer's bus (saucersound.js): its compressor, limiter and echo.
// Installed on Audio.prototype (see audio.js).

const SOUND_SPEED = 340; // blocks (metres) a second

// noise deeper than white: the roar
function brownNoise(c, secs) {
  const n = Math.floor(c.sampleRate * secs);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < n; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; }
  return buf;
}

// sharp pops at random: the crackle of the afterburner's fire
function crackle(c, secs) {
  const sr = c.sampleRate, n = Math.floor(sr * secs);
  const buf = c.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n;) {
    i += Math.floor(sr * (0.0006 + Math.random() * Math.random() * 0.02));
    const a = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.7);
    const len = 10 + Math.floor(Math.random() * 60);
    for (let k = 0; k < len && i + k < n; k++) d[i + k] += a * Math.exp(-k / (len * 0.3)) * (k & 1 ? -0.5 : 1);
  }
  return buf;
}

export function installJetSound(Audio) {
  const P = Audio.prototype;

  P.buildJetEngine = function buildJetEngine() {
    const c = this.ctx, bus = this.saucerBus();
    const out = c.createGain();
    out.gain.value = 0;
    // (past the saucers' muffle, which is theirs: into the compressor, a little into the echo)
    out.connect(bus.comp);
    const send = c.createGain(); send.gain.value = 0.12;
    out.connect(send).connect(bus.echo);
    const sources = [];
    // the roar of the exhaust: noise, brighter as the throttle opens
    const roarLp = c.createBiquadFilter(); roarLp.type = 'lowpass'; roarLp.frequency.value = 700; roarLp.Q.value = 0.6;
    const roarGain = c.createGain(); roarGain.gain.value = 0;
    const white = c.createBufferSource(); white.buffer = this.noiseBuf; white.loop = true;
    white.connect(roarLp).connect(roarGain).connect(out);
    sources.push([white, Math.random()]);
    // its depth: brown noise, its bass lifted and driven
    const deep = brownNoise(c, 4);
    const rumLp = c.createBiquadFilter(); rumLp.type = 'lowpass'; rumLp.frequency.value = 160;
    const rumEq = c.createBiquadFilter(); rumEq.type = 'peaking'; rumEq.frequency.value = 70; rumEq.gain.value = 8; rumEq.Q.value = 0.9;
    const rumGain = c.createGain(); rumGain.gain.value = 0;
    rumLp.connect(rumEq).connect(this.saucerDrive(2)).connect(rumGain).connect(out);
    for (const [pan, rate] of [[-0.4, 0.95], [0.4, 1.05]]) {
      const s = c.createBufferSource(); s.buffer = deep; s.loop = true; s.playbackRate.value = rate;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; s.connect(p).connect(rumLp); } else s.connect(rumLp);
      sources.push([s, Math.random() * 3]);
    }
    // the turbines: a high whine with its harmonics, and the lower howl of the compressors
    const wh = [];
    const whBp = c.createBiquadFilter(); whBp.type = 'bandpass'; whBp.frequency.value = 2400; whBp.Q.value = 2.2;
    const whGain = c.createGain(); whGain.gain.value = 0;
    whBp.connect(whGain).connect(out);
    for (const [mul, type, g] of [[1, 'sawtooth', 0.6], [1.5, 'square', 0.25], [2.02, 'sawtooth', 0.35]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = 900 * mul;
      const og = c.createGain(); og.gain.value = g;
      o.connect(og).connect(whBp);
      wh.push([o, mul]);
    }
    const howl = c.createOscillator(); howl.type = 'triangle'; howl.frequency.value = 300;
    const howlLfo = c.createOscillator(); howlLfo.frequency.value = 3.1;
    const howlLg = c.createGain(); howlLg.gain.value = 6;
    howlLfo.connect(howlLg).connect(howl.frequency);
    const howlGain = c.createGain(); howlGain.gain.value = 0;
    howl.connect(howlGain).connect(out);
    // the afterburner: a thunder of low noise, and its crackle
    const abLp = c.createBiquadFilter(); abLp.type = 'lowpass'; abLp.frequency.value = 420; abLp.Q.value = 0.7;
    const abGain = c.createGain(); abGain.gain.value = 0;
    abLp.connect(this.saucerDrive(2.6)).connect(abGain).connect(out);
    const abSrc = c.createBufferSource(); abSrc.buffer = deep; abSrc.loop = true; abSrc.playbackRate.value = 1.6;
    abSrc.connect(abLp);
    sources.push([abSrc, Math.random() * 3]);
    const cr = c.createBufferSource(); cr.buffer = crackle(c, 3); cr.loop = true;
    const crHp = c.createBiquadFilter(); crHp.type = 'highpass'; crHp.frequency.value = 450;
    const crGain = c.createGain(); crGain.gain.value = 0;
    cr.connect(crHp).connect(crGain).connect(out);
    sources.push([cr, 0]);
    // the air rushing past (louder the faster, loudest in the cockpit)
    const windBp = c.createBiquadFilter(); windBp.type = 'bandpass'; windBp.frequency.value = 900; windBp.Q.value = 0.5;
    const windGain = c.createGain(); windGain.gain.value = 0;
    const wn = c.createBufferSource(); wn.buffer = this.noiseBuf; wn.loop = true; wn.playbackRate.value = 0.7;
    wn.connect(windBp).connect(windGain).connect(out);
    sources.push([wn, Math.random()]);
    // the cannon: a tearing buzz, the rounds a hundred a second
    const gun = c.createOscillator(); gun.type = 'sawtooth'; gun.frequency.value = 100;
    const gunN = c.createBufferSource(); gunN.buffer = this.noiseBuf; gunN.loop = true;
    const gunBp = c.createBiquadFilter(); gunBp.type = 'bandpass'; gunBp.frequency.value = 1300; gunBp.Q.value = 0.7;
    const gunAm = c.createGain(); gunAm.gain.value = 0;
    gun.connect(gunAm.gain); // (the noise chopped a hundred times a second)
    gunN.connect(gunBp).connect(gunAm);
    const gunTone = c.createGain(); gunTone.gain.value = 0.6;
    gun.connect(gunTone);
    const gunMix = c.createGain(); gunMix.gain.value = 1;
    gunAm.connect(gunMix); gunTone.connect(gunMix);
    const gunGain = c.createGain(); gunGain.gain.value = 0;
    gunMix.connect(this.saucerDrive(2.2)).connect(gunGain).connect(bus.out);
    const gunWet = c.createGain(); gunWet.gain.value = 0.3;
    gunGain.connect(gunWet).connect(bus.echo);
    sources.push([gunN, Math.random()]);
    // Auto-GCAS's warning: two tones turn about
    const warn = c.createOscillator(); warn.type = 'square'; warn.frequency.value = 820;
    const warnLp = c.createBiquadFilter(); warnLp.type = 'lowpass'; warnLp.frequency.value = 2500;
    const warnGain = c.createGain(); warnGain.gain.value = 0;
    warn.connect(warnLp).connect(warnGain).connect(bus.out);
    for (const o of [howl, howlLfo, gun, warn, ...wh.map((w) => w[0])]) o.start();
    for (const [s, at] of sources) s.start(0, at);
    return { out, roarLp, roarGain, rumGain, wh, whBp, whGain, howl, howlGain, abLp, abGain, crGain, windBp, windGain, gun, gunGain, warn, warnGain, warnOn: false };
  };

  // The engines: level 0..1 (0: quiet); o: { ab 0..1 (the afterburner), inside (from the cockpit),
  // gun (firing), gcas (pulling up), speed (blocks a second) }.
  P.setJet = function setJet(level, o = {}) {
    if (!this.ctx) return;
    if (!this.jeng && level > 0.01) this.jeng = this.buildJetEngine();
    const e = this.jeng;
    if (!e) return;
    const c = this.ctx, t = c.currentTime;
    const L = Math.max(0, Math.min(1, level));
    const ab = Math.max(0, Math.min(1, o.ab || 0));
    const inside = !!o.inside;
    const sp = Math.max(0, o.speed || 0);
    // (heard from the cockpit: the whine and the air louder, the exhaust's roar behind us duller)
    e.roarGain.gain.setTargetAtTime(L * L * (inside ? 0.28 : 0.55) + ab * 0.25, t, 0.15);
    e.roarLp.frequency.setTargetAtTime((inside ? 500 : 700) + 3800 * L * L + 2200 * ab, t, 0.2);
    e.rumGain.gain.setTargetAtTime(0.15 * L + 0.5 * L * L + 0.5 * ab, t, 0.2);
    const spin = 850 + 2600 * L; // (the turbines' speed)
    for (const [osc, mul] of e.wh) osc.frequency.setTargetAtTime(spin * mul, t, 0.7);
    e.whBp.frequency.setTargetAtTime(spin * 1.6, t, 0.7);
    e.whGain.gain.setTargetAtTime(L > 0.01 ? (inside ? 0.05 : 0.032) * (0.4 + L) : 0, t, 0.3);
    e.howl.frequency.setTargetAtTime(180 + 420 * L, t, 0.6);
    e.howlGain.gain.setTargetAtTime(L > 0.01 ? 0.022 + 0.02 * L : 0, t, 0.3);
    e.abGain.gain.setTargetAtTime(ab * 0.85, t, ab > 0.5 ? 0.08 : 0.3);
    e.abLp.frequency.setTargetAtTime(300 + 600 * ab, t, 0.2);
    e.crGain.gain.setTargetAtTime(ab * 0.26, t, 0.1);
    const w = Math.min(1, sp / 220);
    e.windGain.gain.setTargetAtTime(L > 0.01 ? w * w * (inside ? 0.32 : 0.12) : 0, t, 0.3);
    e.windBp.frequency.setTargetAtTime(500 + 1600 * w, t, 0.4);
    // (a little under the saucer's: the cannon and the blasts must cut through it)
    e.out.gain.setTargetAtTime(L > 0.01 ? (inside ? 0.55 : 0.68) : 0, t, L > 0.01 ? 0.25 : 0.5);
    // the cannon, for as long as it fires (and its barrels spinning down after)
    e.gunGain.gain.setTargetAtTime(o.gun ? 0.55 : 0, t, o.gun ? 0.012 : 0.06);
    e.gun.frequency.setTargetAtTime(o.gun ? 100 : 70, t, o.gun ? 0.03 : 0.25);
    // the warning, in turns of two tones
    const warnOn = !!o.gcas;
    if (warnOn) {
      const ph = Math.floor(t / 0.16) % 2;
      e.warn.frequency.setValueAtTime(ph ? 1180 : 820, t);
    }
    e.warnGain.gain.setTargetAtTime(warnOn ? 0.09 : 0, t, 0.02);
  };

  // The engines spooling up for take-off: a whine rising and a roar building.
  P.jetSpool = function jetSpool() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = this.saucerOut(0.25);
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(500, t); o.frequency.exponentialRampToValueAtTime(3400, t + 1.6);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(5200, t + 1.6);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.09, t + 1.2); og.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(bp).connect(og).connect(g); o.start(t); o.stop(t + 2.5);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(300, t); nf.frequency.exponentialRampToValueAtTime(4000, t + 1.5);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.4, t + 1.4); ng.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + 3.1);
  };

  // A missile away: the clunk of its bay's ejector, then its motor lighting and roaring off.
  P.jetMissile = function jetMissile() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = this.saucerOut(0.5);
    // the clunk
    const k = c.createOscillator(); k.type = 'triangle';
    k.frequency.setValueAtTime(220, t); k.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    const kg = c.createGain();
    kg.gain.setValueAtTime(0.5, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    k.connect(kg).connect(g); k.start(t); k.stop(t + 0.2);
    // the motor: a hard hiss that roars away
    const t1 = t + 0.24;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.Q.value = 0.6;
    nf.frequency.setValueAtTime(2600, t1); nf.frequency.exponentialRampToValueAtTime(380, t1 + 2.6);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t1); ng.gain.linearRampToValueAtTime(0.85, t1 + 0.03); ng.gain.exponentialRampToValueAtTime(0.001, t1 + 3.2);
    n.connect(this.saucerDrive(1.6)).connect(nf).connect(ng).connect(g); n.start(t1, Math.random()); n.stop(t1 + 3.3);
    const r = c.createOscillator(); r.type = 'sawtooth';
    r.frequency.setValueAtTime(140, t1); r.frequency.exponentialRampToValueAtTime(60, t1 + 2.2);
    const rl = c.createBiquadFilter(); rl.type = 'lowpass'; rl.frequency.value = 500;
    const rg = c.createGain();
    rg.gain.setValueAtTime(0, t1); rg.gain.linearRampToValueAtTime(0.25, t1 + 0.04); rg.gain.exponentialRampToValueAtTime(0.001, t1 + 2.4);
    r.connect(rl).connect(rg).connect(g); r.start(t1); r.stop(t1 + 2.5);
  };

  // A blast `dist` blocks away (power 3..12): late by as long as its sound takes to get here; a
  // crack, a deep boom, the fire, and the rumble rolling on.
  P.jetBoom = function jetBoom(dist, power = 6) {
    if (!this.ctx) return;
    const c = this.ctx;
    const d = Math.max(0, dist || 0);
    const t = c.currentTime + Math.min(3, d / SOUND_SPEED);
    const s = Math.min(1.3, (0.45 + power / 12) * Math.min(1, 60 / (d + 25)) * 1.6);
    if (s < 0.01) return;
    const near = Math.exp(-d / 220); // (far off, the highs are gone)
    const g = this.saucerOut(0.85);
    const k = c.createBufferSource(); k.buffer = this.noiseBuf;
    const kf = c.createBiquadFilter(); kf.type = 'lowpass'; kf.frequency.value = 1200 + 7000 * near;
    const kg = c.createGain();
    kg.gain.setValueAtTime(0.9 * s * (0.3 + 0.7 * near), t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    k.connect(kf).connect(kg).connect(g); k.start(t, Math.random()); k.stop(t + 0.27);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(100 + power * 3, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.6);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(1.2 * s, t + 0.01); og.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    o.connect(this.saucerDrive(4)).connect(og).connect(g); o.start(t); o.stop(t + 2.7);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.7;
    nf.frequency.setValueAtTime(600 + 4400 * near, t); nf.frequency.exponentialRampToValueAtTime(120, t + 3.5);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.9 * s, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.001, t + 3.8 + power * 0.1);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + 4.2 + power * 0.1);
  };

  // A cannon round's hit `dist` blocks off (a few a second at most: in a burst they run together).
  P.jetHitSound = function jetHitSound(dist) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    if (now - (this.lastImpact || 0) < 0.07) return;
    this.lastImpact = now;
    const d = Math.max(0, dist || 0);
    const s = Math.min(0.7, 40 / (d + 30));
    if (s < 0.02) return;
    const t = now + Math.min(2, d / SOUND_SPEED);
    const g = this.saucerOut(0.4);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 900 + 3000 * Math.exp(-d / 120);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.7 * s, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + 0.24);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.2);
    const og = c.createGain();
    og.gain.setValueAtTime(0.6 * s, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(og).connect(g); o.start(t); o.stop(t + 0.27);
  };

  // Someone else's burst, `dist` blocks off (a quarter of a second of it).
  P.jetGunFar = function jetGunFar(dist) {
    if (!this.ctx) return;
    const c = this.ctx;
    const d = Math.max(0, dist || 0);
    const s = Math.min(0.5, 60 / (d + 40));
    if (s < 0.02) return;
    const t = c.currentTime + Math.min(2, d / SOUND_SPEED);
    const g = this.saucerOut(0.4);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + 900 * Math.exp(-d / 200); bp.Q.value = 0.8;
    const am = c.createGain(); am.gain.value = 0;
    o.connect(am.gain);
    n.connect(bp).connect(am);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(s, t + 0.01); og.gain.setValueAtTime(s, t + 0.2); og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    am.connect(og).connect(g);
    o.start(t); n.start(t, Math.random()); o.stop(t + 0.32); n.stop(t + 0.32);
  };

  // The seeker: two short tones finding something, a high warble once it is locked.
  P.jetLock = function jetLock(locked) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const g = this.saucerOut(0);
    if (!locked) {
      for (let i = 0; i < 2; i++) this.jetBeep(g, t + i * 0.12, 980, 0.07, 0.06);
    } else {
      for (let i = 0; i < 6; i++) this.jetBeep(g, t + i * 0.09, i % 2 ? 1750 : 1950, 0.085, 0.07);
    }
  };

  P.jetBeep = function jetBeep(g, t, f, len, gain) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
    const og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(gain, t + 0.005); og.gain.setValueAtTime(gain, t + len - 0.01); og.gain.linearRampToValueAtTime(0, t + len);
    o.connect(lp).connect(og).connect(g); o.start(t); o.stop(t + len + 0.02);
  };

  // The nearest of the others' jets: { dist, ab } or null.
  P.setJetFar = function setJetFar(far) {
    if (!this.ctx) return;
    if (!this.jfar && far) {
      const c = this.ctx, bus = this.saucerBus();
      const out = c.createGain(); out.gain.value = 0; out.connect(bus.comp);
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
      lp.connect(out);
      const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
      const ng = c.createGain(); ng.gain.value = 0.6;
      n.connect(ng).connect(lp);
      const deep = brownNoise(c, 3);
      const b = c.createBufferSource(); b.buffer = deep; b.loop = true;
      const bg = c.createGain(); bg.gain.value = 0.9;
      b.connect(this.saucerDrive(2)).connect(bg).connect(lp);
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 2600;
      const og = c.createGain(); og.gain.value = 0.03;
      o.connect(og).connect(lp);
      n.start(0, Math.random()); b.start(0, Math.random()); o.start();
      this.jfar = { out, lp, bg };
    }
    const f = this.jfar;
    if (!f) return;
    const t = this.ctx.currentTime;
    if (!far) { f.out.gain.setTargetAtTime(0, t, 0.5); return; }
    const d = Math.max(1, far.dist);
    f.out.gain.setTargetAtTime(Math.min(0.9, 50 / (d + 30)) * (far.ab ? 1.4 : 1), t, 0.3);
    f.lp.frequency.setTargetAtTime(300 + 5000 * Math.exp(-d / 180), t, 0.3);
    f.bg.gain.setTargetAtTime(far.ab ? 1.6 : 0.9, t, 0.3);
  };
}
