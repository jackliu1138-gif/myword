// A flying saucer's sound, all synthesised: the engines (a deep rumble felt as much as heard, the
// roar of the fire, its crackle at full thrust, the whine of the turbines and the saucer's own
// wavering hum), the engines winding up before lift-off, the boom of ignition rolling away like
// thunder, and the thud of its weight coming down on its legs. It goes through a compressor of its
// own, so it can be loud without clipping, and a long echo for the booms. In space it is heard only
// through the hull, deep and muffled; another's, quieter and duller the further off it is.
// Installed on Audio.prototype (see audio.js).

// soft clipping: drives a low tone into harmonics a small speaker can play
function driveCurve(amount) {
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  return curve;
}

// noise deeper than white (each sample a step from the last): the roar
function brownNoise(c, secs) {
  const n = Math.floor(c.sampleRate * secs);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let v = 0;
  for (let i = 0; i < n; i++) { v = (v + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = v * 3.5; }
  return buf;
}

// sharp little pops at random, some close together: the crackle of a rocket's fire
function crackleNoise(c, secs) {
  const sr = c.sampleRate, n = Math.floor(sr * secs);
  const buf = c.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n;) {
    i += Math.floor(sr * (0.0004 + Math.random() * Math.random() * 0.012));
    const a = (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.75);
    const len = 8 + Math.floor(Math.random() * 40);
    for (let k = 0; k < len && i + k < n; k++) d[i + k] += a * Math.exp(-k / (len * 0.25)) * (k & 1 ? -0.6 : 1);
  }
  return buf;
}

// the echo: a few seconds of noise dying away, its highs sooner than its lows
function echoImpulse(c, secs) {
  const sr = c.sampleRate, n = Math.floor(sr * secs);
  const buf = c.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const k = Math.min(0.96, 0.2 + t * 0.4);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = (lp / Math.sqrt((1 - k) / (1 + k))) * Math.exp(-t * 1.5) * Math.min(1, t / 0.012);
    }
  }
  return buf;
}

export function installSaucerSound(Audio) {
  const P = Audio.prototype;

  P.saucerDrive = function saucerDrive(amount) {
    const ws = this.ctx.createWaveShaper();
    this.driveCurves = this.driveCurves || new Map();
    if (!this.driveCurves.has(amount)) this.driveCurves.set(amount, driveCurve(amount));
    ws.curve = this.driveCurves.get(amount);
    ws.oversample = '2x';
    return ws;
  };

  // Everything a saucer makes goes through here: the engines through a compressor (with the
  // filter that muffles them in space and far off), the booms past it, so they stand out, and all
  // of it through a limiter at the end, so nothing clips; and the echo. Made the first time one is
  // heard.
  P.saucerBus = function saucerBus() {
    if (this.sbus) return this.sbus;
    const c = this.ctx;
    const limit = c.createDynamicsCompressor();
    limit.threshold.value = -2; limit.knee.value = 0; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.12;
    limit.connect(this.master);
    const out = c.createGain();
    out.connect(limit);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10; comp.knee.value = 6; comp.ratio.value = 3.5; comp.attack.value = 0.003; comp.release.value = 0.35;
    comp.connect(out);
    const rev = c.createConvolver();
    rev.buffer = echoImpulse(c, 4);
    const echo = c.createGain();
    echo.connect(rev).connect(comp);
    const eng = c.createGain();
    const muffle = c.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 9000; muffle.Q.value = 0.5;
    eng.connect(muffle).connect(comp);
    const send = c.createGain();
    send.gain.value = 0.2;
    muffle.connect(send).connect(echo);
    this.sbus = { out, comp, echo, eng, muffle, send };
    return this.sbus;
  };

  // A one-shot's way out: past the compressor to the limiter, and some of it into the echo.
  P.saucerOut = function saucerOut(wet) {
    const c = this.ctx, bus = this.saucerBus();
    const g = c.createGain();
    g.connect(bus.out);
    const w = c.createGain();
    w.gain.value = wet;
    g.connect(w).connect(bus.echo);
    return g;
  };

  P.buildSaucerEngine = function buildSaucerEngine() {
    const c = this.ctx, bus = this.saucerBus();
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(bus.eng);
    // the deep rumble: two low tones, slowly wavering, driven hard
    const sub1 = c.createOscillator(); sub1.type = 'sine'; sub1.frequency.value = 32;
    const sub2 = c.createOscillator(); sub2.type = 'triangle'; sub2.frequency.value = 47;
    const wob = c.createOscillator(); wob.frequency.value = 0.7;
    const wobG = c.createGain(); wobG.gain.value = 1.6;
    wob.connect(wobG).connect(sub1.frequency);
    const subMix = c.createGain(); subMix.gain.value = 0.7;
    sub1.connect(subMix); sub2.connect(subMix);
    const subLp = c.createBiquadFilter(); subLp.type = 'lowpass'; subLp.frequency.value = 260;
    const subGain = c.createGain(); subGain.gain.value = 0;
    subMix.connect(this.saucerDrive(3)).connect(subLp).connect(subGain).connect(out);
    // the roar: deep noise, two of it a little apart for width, its bass lifted and driven
    const roarLp = c.createBiquadFilter(); roarLp.type = 'lowpass'; roarLp.frequency.value = 200; roarLp.Q.value = 0.7;
    const roarEq = c.createBiquadFilter(); roarEq.type = 'peaking'; roarEq.frequency.value = 85; roarEq.gain.value = 9; roarEq.Q.value = 0.8;
    const roarGain = c.createGain(); roarGain.gain.value = 0;
    roarLp.connect(roarEq).connect(this.saucerDrive(1.8)).connect(roarGain).connect(out);
    const deep = brownNoise(c, 4);
    const sources = [];
    for (const [pan, rate] of [[-0.45, 0.93], [0.45, 1.07]]) {
      const s = c.createBufferSource(); s.buffer = deep; s.loop = true; s.playbackRate.value = rate;
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; s.connect(p).connect(roarLp); } else s.connect(roarLp);
      sources.push([s, Math.random() * 3]);
    }
    // the crackle of the fire at full thrust
    const cr = c.createBufferSource(); cr.buffer = crackleNoise(c, 3); cr.loop = true;
    const crHp = c.createBiquadFilter(); crHp.type = 'highpass'; crHp.frequency.value = 600;
    const crGain = c.createGain(); crGain.gain.value = 0;
    cr.connect(crHp).connect(crGain).connect(out);
    sources.push([cr, 0]);
    // the turbines' whine, rising with the thrust
    const wh1 = c.createOscillator(); wh1.type = 'sawtooth'; wh1.frequency.value = 260;
    const wh2 = c.createOscillator(); wh2.type = 'square'; wh2.frequency.value = 390;
    const whBp = c.createBiquadFilter(); whBp.type = 'bandpass'; whBp.frequency.value = 700; whBp.Q.value = 1.4;
    const whGain = c.createGain(); whGain.gain.value = 0;
    wh1.connect(whBp); wh2.connect(whBp);
    whBp.connect(whGain).connect(out);
    // the saucer's own hum, wavering
    const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 70;
    const lfo = c.createOscillator(); lfo.frequency.value = 5.5;
    const lg = c.createGain(); lg.gain.value = 3;
    lfo.connect(lg).connect(hum.frequency);
    const humLp = c.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 340;
    const humGain = c.createGain(); humGain.gain.value = 0;
    hum.connect(humLp).connect(humGain).connect(out);
    for (const o of [sub1, sub2, wob, wh1, wh2, hum, lfo]) o.start();
    for (const [s, at] of sources) s.start(0, at);
    return { out, sub1, sub2, subGain, roarLp, roarGain, crGain, wh1, wh2, whBp, whGain, hum, humGain };
  };

  // The engines: thrust 0..1 (the roar), hum 0..1 (the saucer's own sound while it is running);
  // opts: { space (heard through the hull alone), inside (aboard it), dist (someone else's: how far
  // off) }. Both 0: quiet.
  P.setEngine = function setEngine(thrust, hum = 0, opts = {}) {
    if (!this.ctx) return;
    if (!this.eng && (thrust > 0.01 || hum > 0.01)) this.eng = this.buildSaucerEngine();
    const e = this.eng;
    if (!e) return;
    const c = this.ctx, t = c.currentTime, bus = this.saucerBus();
    const th = Math.max(0, Math.min(1, thrust));
    // (for a few seconds after lift-off: louder still, brighter and rougher)
    const boost = this.igniteAt !== undefined ? Math.exp(-Math.max(0, t - this.igniteAt) / 5) * (this.igniteStrength || 1) : 0;
    e.subGain.gain.setTargetAtTime((0.12 * hum + 0.62 * th * th) * (1 + 0.5 * boost), t, 0.15);
    e.sub1.frequency.setTargetAtTime(30 + 12 * th, t, 0.5);
    e.sub2.frequency.setTargetAtTime(45.5 + 17 * th, t, 0.5);
    e.roarGain.gain.setTargetAtTime(Math.pow(th, 1.8) * 0.8 * (1 + 0.6 * boost), t, 0.12);
    e.roarLp.frequency.setTargetAtTime(180 + 1500 * th + 1800 * boost, t, 0.2);
    e.crGain.gain.setTargetAtTime(Math.pow(Math.max(0, th - 0.3) / 0.7, 2) * 0.3 * (1 + boost), t, 0.1);
    const whine = 240 + 620 * th;
    e.wh1.frequency.setTargetAtTime(whine, t, 0.6);
    e.wh2.frequency.setTargetAtTime(whine * 1.502, t, 0.6);
    e.whBp.frequency.setTargetAtTime(whine * 2.2, t, 0.6);
    e.whGain.gain.setTargetAtTime(0.014 * hum + 0.035 * th, t, 0.3);
    e.humGain.gain.setTargetAtTime(Math.min(0.09, hum * 0.09), t, 0.3);
    e.hum.frequency.setTargetAtTime(62 + hum * 26 + th * 46, t, 0.4);
    // where it is heard from
    const space = !!opts.space, inside = !!opts.inside, dist = opts.dist || 0;
    bus.muffle.frequency.setTargetAtTime(space ? 380 : inside ? 7000 : Math.max(320, 9000 * Math.exp(-dist / 140)), t, 0.3);
    e.out.gain.setTargetAtTime(space ? 0.6 : inside ? 1 : 1 / (1 + dist / 60), t, 0.2);
    bus.send.gain.setTargetAtTime(space ? 0.04 : 0.2, t, 0.5);
  };

  // Before lift-off (secs from now): the engines winding up, a whine rising, a rumble and a roar
  // building to the moment of ignition.
  P.saucerSpool = function saucerSpool(secs = 3) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime, T = Math.max(0.5, secs);
    const g = this.saucerOut(0.35);
    for (const [f0, f1, type, gain] of [[90, 1100, 'sawtooth', 0.1], [135, 1650, 'square', 0.035]]) {
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + T);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      bp.frequency.setValueAtTime(f0 * 2, t); bp.frequency.exponentialRampToValueAtTime(f1 * 2, t + T);
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(gain, t + T); og.gain.linearRampToValueAtTime(0, t + T + 0.25);
      o.connect(bp).connect(og).connect(g); o.start(t); o.stop(t + T + 0.3);
    }
    const s = c.createOscillator(); s.type = 'triangle';
    s.frequency.setValueAtTime(22, t); s.frequency.linearRampToValueAtTime(44, t + T);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.32, t + T); sg.gain.linearRampToValueAtTime(0, t + T + 0.4);
    s.connect(this.saucerDrive(3)).connect(sg).connect(g); s.start(t); s.stop(t + T + 0.5);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass';
    nf.frequency.setValueAtTime(150, t); nf.frequency.exponentialRampToValueAtTime(1800, t + T);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.18, t + T); ng.gain.linearRampToValueAtTime(0, t + T + 0.3);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + T + 0.4);
  };

  // Ignition: a crack, a deep boom you feel, the fire bursting out (bright, then darkening) and
  // the echo rolling away; and the engines louder for a while after (see setEngine).
  P.saucerIgnite = function saucerIgnite(strength = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.igniteAt = t;
    this.igniteStrength = Math.max(0.3, Math.min(1, strength));
    const s = Math.max(0.2, Math.min(1.2, strength));
    const g = this.saucerOut(0.75);
    // the crack
    const k = c.createBufferSource(); k.buffer = this.noiseBuf;
    const kf = c.createBiquadFilter(); kf.type = 'highpass'; kf.frequency.value = 900;
    const kg = c.createGain();
    kg.gain.setValueAtTime(0.75 * s, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    k.connect(kf).connect(kg).connect(g); k.start(t, Math.random()); k.stop(t + 0.22);
    // the boom: a deep falling tone, driven into harmonics
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(115, t); o.frequency.exponentialRampToValueAtTime(26, t + 1.5);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(1.1 * s, t + 0.012); og.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    o.connect(this.saucerDrive(4)).connect(og).connect(g); o.start(t); o.stop(t + 2.5);
    // the blast of fire
    const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.Q.value = 0.8;
    nf.frequency.setValueAtTime(5200, t); nf.frequency.exponentialRampToValueAtTime(150, t + 3.4);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.95 * s, t + 0.02); ng.gain.exponentialRampToValueAtTime(0.001, t + 4.8);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + 4.9);
    // the ground shaking after it: a low throb dying away
    const r = c.createOscillator(); r.type = 'triangle'; r.frequency.value = 38;
    const trem = c.createOscillator(); trem.frequency.value = 7;
    const tg = c.createGain();
    tg.gain.setValueAtTime(0.35 * s, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 3.6);
    const rg = c.createGain();
    rg.gain.setValueAtTime(0, t + 0.15); rg.gain.linearRampToValueAtTime(0.5 * s, t + 0.4); rg.gain.exponentialRampToValueAtTime(0.001, t + 3.6);
    trem.connect(tg).connect(rg.gain);
    r.connect(this.saucerDrive(2.5)).connect(rg).connect(g);
    r.start(t); trem.start(t); r.stop(t + 3.7); trem.stop(t + 3.7);
  };

  // Its weight coming down on its legs (landing, or a bump): a deep thud, a burst of dust and the
  // clank of the legs' metal.
  P.saucerThud = function saucerThud(strength = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = Math.max(0.15, Math.min(1.2, strength));
    const g = this.saucerOut(0.45);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.7);
    const og = c.createGain();
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.9 * s, t + 0.01); og.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(this.saucerDrive(3)).connect(og).connect(g); o.start(t); o.stop(t + 1.2);
    const n = c.createBufferSource(); n.buffer = this.noiseBuf;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 500;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.6 * s, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(nf).connect(ng).connect(g); n.start(t, Math.random()); n.stop(t + 0.7);
    for (const [f, d] of [[180, 0.5], [267, 0.4], [433, 0.3]]) {
      const m = c.createOscillator(); m.type = 'triangle'; m.frequency.value = f;
      const mg = c.createGain();
      mg.gain.setValueAtTime(0, t + 0.03); mg.gain.linearRampToValueAtTime(0.09 * s, t + 0.035); mg.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + d);
      m.connect(mg).connect(g); m.start(t + 0.03); m.stop(t + 0.05 + d);
    }
  };
}
