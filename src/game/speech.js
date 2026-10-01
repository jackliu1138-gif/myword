// Villagers' voices: the device's own speech synthesis (Web Speech), a voice per villager (pitch,
// speed, a man's or a woman's voice where the device has both), quieter the further away they are.
// And, where the browser can, talking to them out loud (speech recognition). Neither needs a
// server; on a device without them the villagers' words just appear above their heads.

const FEMALE = /huihui|yaoyao|xiaoxiao|xiaoyi|tingting|ting-ting|meijia|mei-jia|sinji|sin-ji|lili|female|woman|女|samantha|victoria|karen|zira|susan|serena|moira|fiona|tessa|veena/i;
const MALE = /kangkang|yunxi|yunyang|yunjian|liang|male|man\b|男|daniel|alex|fred|david|mark|george|rishi|aaron|arthur|oliver|thomas/i;

export class Speech {
  constructor() {
    this.ok = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
    this.enabled = true;
    this.volume = 1;
    this.voices = [];
    this.unlocked = false;
    if (this.ok) {
      this.loadVoices();
      try { window.speechSynthesis.addEventListener('voiceschanged', () => this.loadVoices()); } catch (e) { /* old browsers */ }
    }
  }

  loadVoices() {
    try { this.voices = window.speechSynthesis.getVoices() || []; } catch (e) { this.voices = []; }
    this.cache = new Map();
  }

  // iOS speaks only after a first utterance started by a tap: called from the first tap.
  unlock() {
    if (!this.ok || this.unlocked) return;
    this.unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      window.speechSynthesis.speak(u);
    } catch (e) { /* fine */ }
  }

  // The best voice for a language and (if the device offers a choice) a man or a woman.
  voiceFor(lang, gender) {
    const key = lang + ':' + gender;
    if (this.cache && this.cache.has(key)) return this.cache.get(key);
    const want = lang === 'zh' ? /^(zh|cmn)/i : /^en/i;
    let list = this.voices.filter((v) => want.test(v.lang || ''));
    if (lang === 'zh') {
      // Mandarin as spoken on the mainland first, then Taiwan, then Cantonese
      const rank = (v) => (/CN|Hans|cmn/i.test(v.lang) ? 0 : /TW/i.test(v.lang) ? 1 : 2);
      list.sort((a, b) => rank(a) - rank(b));
    }
    // local voices first: they work offline and in mainland China (online ones may be Google's)
    list.sort((a, b) => (b.localService ? 1 : 0) - (a.localService ? 1 : 0));
    const match = gender === 'male' ? MALE : FEMALE;
    const best = list.find((v) => match.test(v.name)) || list[0] || null;
    if (!this.cache) this.cache = new Map();
    this.cache.set(key, best);
    return best;
  }

  // Say something: { lang, pitch, rate, volume (0..1 by distance), gender }. A villager speaking
  // again interrupts nobody else; the queue is kept short so old words don't pile up.
  speak(text, { lang = 'zh', pitch = 1, rate = 1, volume = 1, gender = 'female' } = {}) {
    if (!this.ok || !this.enabled || !text || volume * this.volume < 0.03) return false;
    try {
      const s = window.speechSynthesis;
      if (s.pending && this.queued > 1) s.cancel();
      const u = new SpeechSynthesisUtterance(String(text).slice(0, 220));
      u.lang = lang === 'zh' ? 'zh-CN' : 'en-GB';
      const v = this.voiceFor(lang, gender);
      if (v) { u.voice = v; u.lang = v.lang; }
      // with only one voice to go round, a lower or higher pitch tells the men from the women; a
      // voice that already is a man's or a woman's needs only half of it
      const single = !v || !(gender === 'male' ? MALE : FEMALE).test(v.name);
      u.pitch = Math.max(0.1, Math.min(2, single ? pitch : 1 + (pitch - 1) * 0.5));
      u.rate = Math.max(0.5, Math.min(1.6, rate));
      u.volume = Math.max(0, Math.min(1, volume * this.volume));
      this.queued = (this.queued || 0) + 1;
      u.onend = u.onerror = () => { this.queued = Math.max(0, (this.queued || 1) - 1); };
      s.speak(u);
      return true;
    } catch (e) { return false; }
  }

  stop() {
    if (!this.ok) return;
    try { window.speechSynthesis.cancel(); } catch (e) { /* fine */ }
    this.queued = 0;
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
