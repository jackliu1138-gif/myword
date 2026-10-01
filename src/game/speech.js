// Villagers' voices: the device's own speech synthesis (Web Speech), a voice per villager (pitch,
// speed, a man's or a woman's voice where the device has both), quieter the further away they are.
// And, where the browser can, talking to them out loud (speech recognition). Neither needs a
// server; on a device without them the villagers' words just appear above their heads.
//
// Phones and tablets are particular about speaking:
//  - iOS speaks only once an utterance has been started inside a tap, a click or a key press, and
//    a tap that was really a drag doesn't count: every one tries until speaking has really begun;
//  - cancel() straight before speak() can leave it silent: a short pause between them;
//  - utterances are kept referenced until they end (some browsers drop them half way through),
//    and long lines go a sentence or so at a time (Chrome cuts long utterances off);
//  - a voice the device lists but can't speak with is not used again, and a line that never starts
//    means speaking is blocked again: the next tap unlocks it;
//  - many in-app browsers (WeChat, QQ...) and Android WebViews have no speech synthesis at all.
// (An iPhone's silent switch or an iPad's silent mode would mute it too: see audiosession.js.)

// voice names that are a woman's or a man's (Windows, macOS and iOS, Android, Edge's online voices)
const FEMALE = /huihui|yaoyao|xiaoxiao|xiaoyi|tingting|ting-ting|meijia|mei-jia|sinji|sin-ji|lili|yu-shu|yushu|flo\b|sandy|shelley|grandma|female|woman|女|samantha|victoria|karen|zira|susan|serena|moira|fiona|tessa|veena/i;
const MALE = /kangkang|yunxi|yunyang|yunjian|liang|li-mu|limu|eddy|reed|rocko|grandpa|male|man\b|男|daniel|alex|fred|david|mark|george|rishi|aaron|arthur|oliver|thomas/i;

const ENDS = '。！？!?；;…\n';

// A line in pieces of about a sentence (at most `max` characters, cut at a comma or a space when a
// sentence is longer), short sentences kept together.
export function splitSpeech(text, max = 60) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  const sentences = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    cur += s[i];
    if (ENDS.includes(s[i]) || (s[i] === '.' && (i + 1 >= s.length || s[i + 1] === ' '))) { sentences.push(cur); cur = ''; }
  }
  if (cur) sentences.push(cur);
  const out = [];
  const push = (p) => { p = p.trim(); if (p) out.push(p); };
  let acc = '';
  for (let sen of sentences) {
    while (sen.length > max) {
      let cut = -1;
      for (const c of '，,、 ') { const k = sen.lastIndexOf(c, max - 1); if (k + 1 > max * 0.4) cut = Math.max(cut, k + 1); }
      if (cut < 0) cut = max;
      push(acc); acc = '';
      push(sen.slice(0, cut));
      sen = sen.slice(cut);
    }
    if ((acc + sen).length > max) { push(acc); acc = ''; }
    acc += sen;
  }
  push(acc);
  return out;
}

export class Speech {
  // (win: the window, or a stand-in in the tests)
  constructor(win = typeof window !== 'undefined' ? window : null, { now = () => Date.now(), later = (f, ms) => setTimeout(f, ms) } = {}) {
    this.win = win;
    this.now = now;
    this.later = later;
    this.ok = !!(win && win.speechSynthesis && typeof win.SpeechSynthesisUtterance === 'function');
    this.enabled = true;
    this.volume = 1;
    this.voices = [];
    this.cache = new Map();
    this.bad = new Set(); // voices that failed
    this.live = new Set(); // utterances queued or speaking
    this.unlocked = false;
    this.unlockAt = -1e9;
    this.spoken = 0;
    this.failed = 0;
    this.lastError = '';
    if (this.ok) {
      this.loadVoices();
      try { win.speechSynthesis.addEventListener('voiceschanged', () => this.loadVoices()); } catch (e) { /* old browsers */ }
    }
  }

  synth() { return this.win.speechSynthesis; }

  loadVoices() {
    try { this.voices = this.synth().getVoices() || []; } catch (e) { this.voices = []; }
    this.cache.clear();
  }

  // Called from every tap, click and key press until speaking has really begun once.
  unlock() {
    if (!this.ok || this.unlocked) return;
    const t = this.now();
    if (t - this.unlockAt < 1000) return; // (one try at a time)
    this.unlockAt = t;
    try {
      const s = this.synth();
      if (s.paused) s.resume();
      const u = new this.win.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.blank = true;
      this.live.add(u);
      // (a blocked speak() is dropped without a word: no events, and the next tap tries again)
      u.onstart = () => { this.unlocked = true; };
      u.onend = () => { this.unlocked = true; this.live.delete(u); };
      u.onerror = () => { this.live.delete(u); };
      s.speak(u);
    } catch (e) { /* fine */ }
  }

  // The best voice for a language and (if the device offers a choice) a man or a woman.
  voiceFor(lang, gender) {
    if (!this.voices.length) this.loadVoices(); // (some browsers fill the list late, without telling)
    const key = lang + ':' + gender;
    if (this.cache.has(key)) return this.cache.get(key);
    const want = lang === 'zh' ? /^(zh|cmn)/i : /^en/i;
    const list = this.voices.filter((v) => want.test(v.lang || '') && !this.bad.has(v.voiceURI || v.name));
    if (lang === 'zh') {
      // Mandarin as spoken on the mainland first, then Taiwan, then Cantonese
      const rank = (v) => (/CN|Hans|cmn/i.test(v.lang) ? 0 : /TW/i.test(v.lang) ? 1 : 2);
      list.sort((a, b) => rank(a) - rank(b));
    }
    // local voices first: they work offline and in mainland China (online ones may be Google's)
    list.sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
    const match = gender === 'male' ? MALE : FEMALE;
    const best = list.find((v) => match.test(v.name)) || list[0] || null;
    if (this.voices.length) this.cache.set(key, best);
    return best;
  }

  // How many of our lines' pieces are still waiting to be spoken.
  waiting() {
    let n = 0;
    for (const u of this.live) if (!u.started && !u.blank) n++;
    return n;
  }

  // Something of ours being said or waiting (not counting the blanks that unlock speaking).
  busy() {
    for (const u of this.live) if (!u.blank) return true;
    return false;
  }

  // Say something: { lang, pitch, rate, volume (0..1 by distance), gender }. A villager speaking
  // again interrupts nobody else; the queue is kept short so old words don't pile up.
  speak(text, opts = {}) {
    const o = { lang: 'zh', pitch: 1, rate: 1, volume: 1, gender: 'female', ...opts };
    if (!this.ok || !this.enabled || !text || o.volume * this.volume < 0.03) return false;
    const pieces = splitSpeech(String(text).slice(0, 400));
    if (!pieces.length) return false;
    const go = () => { for (const p of pieces) this.say(p, o); };
    try {
      if (this.waiting() > 3) {
        // (cancel, then a moment's pause before speaking: iOS stays silent otherwise)
        this.stop();
        this.later(go, 80);
      } else go();
      return true;
    } catch (e) { return false; }
  }

  // One piece of a line; `plain`: in the language's own default voice (after a voice failed).
  say(text, o, plain = false, onStart = null) {
    const s = this.synth();
    if (s.paused) { try { s.resume(); } catch (e) { /* fine */ } }
    const u = new this.win.SpeechSynthesisUtterance(text);
    u.lang = o.lang === 'zh' ? 'zh-CN' : 'en-GB';
    const v = plain ? null : this.voiceFor(o.lang, o.gender);
    if (v) { u.voice = v; u.lang = v.lang; }
    // with only one voice to go round, a lower or higher pitch tells the men from the women; a
    // voice that already is a man's or a woman's needs only half of it
    const single = !v || !(o.gender === 'male' ? MALE : FEMALE).test(v.name);
    u.pitch = Math.max(0.1, Math.min(2, single ? o.pitch : 1 + (o.pitch - 1) * 0.5));
    u.rate = Math.max(0.5, Math.min(1.6, o.rate));
    u.volume = Math.max(0, Math.min(1, o.volume * this.volume));
    u.started = false;
    this.live.add(u);
    u.onstart = () => {
      u.started = true;
      this.unlocked = true;
      this.spoken++;
      this.lastError = '';
      if (onStart) onStart('ok');
    };
    u.onend = () => { this.live.delete(u); };
    u.onerror = (e) => {
      this.live.delete(u);
      const err = (e && e.error) || 'error';
      if (err === 'interrupted' || err === 'canceled') return;
      this.failed++;
      this.lastError = err;
      if (err === 'not-allowed') { this.unlocked = false; if (onStart) onStart(err); return; }
      // a voice the device lists but can't speak with: never again, and this piece without it
      if (v && !u.started) {
        this.bad.add(v.voiceURI || v.name);
        this.cache.clear();
        this.say(text, o, true, onStart);
      } else if (onStart) onStart(err);
    };
    s.speak(u);
    // never started, and nothing else being said or waiting: the device dropped it (blocked)
    this.later(() => {
      if (u.started || !this.live.has(u) || s.speaking || s.pending) return;
      this.live.delete(u);
      this.unlocked = false;
      if (!this.lastError) this.lastError = 'blocked';
      if (onStart) onStart('silent');
    }, 2500);
    return u;
  }

  // Say a line straight away (from a tap: the settings' voice test). Resolves with 'ok' once it is
  // being spoken, or why not: 'unsupported', 'silent' (nothing happened), or the browser's error.
  test(text, lang = 'zh') {
    return new Promise((resolve) => {
      if (!this.ok) { resolve('unsupported'); return; }
      let done = false;
      const end = (r) => { if (!done) { done = true; resolve(r); } };
      const go = () => this.say(text, { lang, pitch: 1, rate: 1, volume: 1 / Math.max(this.volume, 0.05), gender: 'female' }, false, end);
      try {
        // straight away, inside the tap (that is what lets iOS speak); after a pause if a villager
        // has to be cut off first
        if (this.busy()) { this.stop(); this.later(go, 80); } else go();
        this.later(() => end('silent'), 5000);
      } catch (e) { end('error'); }
    });
  }

  // What this device can do, for the settings: voices for the language and the one in use.
  status(lang = 'zh') {
    if (!this.ok) return { ok: false };
    this.loadVoices();
    const want = lang === 'zh' ? /^(zh|cmn)/i : /^en/i;
    const v = this.voiceFor(lang, 'female');
    return {
      ok: true, total: this.voices.length, matching: this.voices.filter((x) => want.test(x.lang || '')).length,
      voice: v ? v.name : '', unlocked: this.unlocked, spoken: this.spoken, failed: this.failed, lastError: this.lastError,
    };
  }

  stop() {
    if (!this.ok) return;
    try { this.synth().cancel(); } catch (e) { /* fine */ }
    this.live.clear();
  }
}

// ---------------------------------------------------------------- talking to them out loud
export function canListen() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Listen for one sentence: resolves with what was heard ('' if nothing), rejects with the
// browser's reason ('not-allowed', 'network': e.g. Chrome's recogniser can't be reached, ...).
export function listenOnce(lang, { onPartial } = {}) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  return new Promise((resolve, reject) => {
    let r;
    try { r = new R(); } catch (e) { reject(new Error('unsupported')); return; }
    r.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
    r.interimResults = !!onPartial;
    r.maxAlternatives = 1;
    let heard = '', failed = null;
    r.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      heard = text;
      if (onPartial) onPartial(text);
    };
    r.onerror = (e) => { failed = e.error || 'error'; };
    r.onend = () => (failed && failed !== 'no-speech' && failed !== 'aborted' ? reject(new Error(failed)) : resolve(heard.trim()));
    try { r.start(); } catch (e) { reject(new Error('busy')); return; }
    listenOnce.current = r;
  });
}
export function stopListening() {
  try { if (listenOnce.current) listenOnce.current.stop(); } catch (e) { /* fine */ }
}
