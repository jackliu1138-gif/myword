// The villagers' voices on fussy devices: iOS dropping speech until a tap it counts, voices that
// are listed but fail, browsers without speech at all, long lines in pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Speech, splitSpeech } from '../src/game/speech.js';

const VOICES = [
  { name: 'Tingting', lang: 'zh-CN', localService: true, voiceURI: 'tt' },
  { name: 'Li-mu', lang: 'zh-CN', localService: true, voiceURI: 'lm' },
  { name: 'Meijia', lang: 'zh-TW', localService: true, voiceURI: 'mj' },
  { name: 'Samantha', lang: 'en-US', localService: true, voiceURI: 'sa' },
];

// A speech engine like WebKit's on iOS: until an utterance is spoken during a tap it counts,
// speak() drops utterances without a word (no events). run() speaks what is queued.
function device({ needsTap = false, voices = VOICES, broken = [] } = {}) {
  const queue = [];
  const synth = {
    speaking: false, pending: false, paused: false, tap: false, allowed: !needsTap, said: [], cancels: 0,
    getVoices: () => voices,
    addEventListener() {},
    speak(u) {
      if (!this.allowed) { if (!this.tap) return; this.allowed = true; }
      queue.push(u);
      this.pending = true;
    },
    cancel() { this.cancels++; for (const u of queue.splice(0)) if (u.onerror) u.onerror({ error: 'canceled' }); this.pending = this.speaking = false; },
    resume() { this.paused = false; },
    run() {
      while (queue.length) {
        const u = queue.shift();
        if (u.voice && broken.includes(u.voice.name)) { u.onerror({ error: 'voice-unavailable' }); continue; }
        this.speaking = true;
        if (u.onstart) u.onstart();
        if (u.text.trim()) this.said.push({ text: u.text, voice: u.voice ? u.voice.name : null, lang: u.lang, volume: u.volume, pitch: u.pitch });
        if (u.onend) u.onend();
      }
      this.speaking = this.pending = false;
    },
  };
  class Utterance { constructor(text) { this.text = text; } }
  return { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance };
}

function speechOn(win) {
  let t = 0;
  const timers = [];
  const sp = new Speech(win, { now: () => t, later: (f, ms) => timers.push({ f, at: t + ms }) });
  const clock = (ms) => {
    t += ms;
    for (const tm of timers.splice(0)) { if (tm.at <= t) tm.f(); else timers.push(tm); }
  };
  return { sp, clock, synth: win.speechSynthesis };
}

test('a long line goes a sentence or so at a time, nothing lost', () => {
  const zh = '哎呀，你可算来了！今天地里的麦子长得特别好，我一大早就去看过了。你要不要带点面包回去？我这里还有好多呢，都是刚烤出来的，香得很。';
  const parts = splitSpeech(zh, 30);
  assert.ok(parts.length >= 3, parts.join(' | '));
  assert.ok(parts.every((p) => p.length <= 30), parts.join(' | '));
  assert.equal(parts.join(''), zh);
  const en = splitSpeech('Hello there. The wheat is doing well this year! Would you like some bread?', 40);
  assert.deepEqual(en, ['Hello there.', 'The wheat is doing well this year!', 'Would you like some bread?']);
  // a sentence longer than a piece is cut at a comma
  const long = splitSpeech('我跟你说，从前有一个村子，村子里住着一个铁匠，铁匠每天打铁，打出来的剑又快又亮', 16);
  assert.ok(long.every((p) => p.length <= 16), long.join(' | '));
  assert.equal(long.join(''), '我跟你说，从前有一个村子，村子里住着一个铁匠，铁匠每天打铁，打出来的剑又快又亮');
});

test('iOS: speaking starts only after a tap it counts, and keeps trying until one does', () => {
  const win = device({ needsTap: true });
  const { sp, clock, synth } = speechOn(win);
  // a drag on the joystick: not a tap iOS counts, nothing happens
  sp.unlock();
  synth.run();
  assert.equal(sp.unlocked, false);
  // a villager talks before any real tap: dropped, and known to be (blocked)
  assert.equal(sp.speak('你好呀！', { lang: 'zh' }), true);
  clock(3000);
  assert.equal(sp.unlocked, false);
  assert.equal(sp.lastError, 'blocked');
  // a real tap (a second later): this time it counts
  synth.tap = true;
  sp.unlock();
  synth.tap = false;
  synth.run();
  assert.equal(sp.unlocked, true);
  // from now on villagers speak whenever they talk, with no tap
  sp.speak('今天天气真好。', { lang: 'zh', gender: 'female' });
  synth.run();
  assert.deepEqual(synth.said.map((s) => s.text), ['今天天气真好。']);
  assert.equal(synth.said[0].voice, 'Tingting');
});

test('a voice the device lists but cannot use is dropped, and the line is still said', () => {
  const win = device({ broken: ['Tingting'] });
  const { sp, synth } = speechOn(win);
  sp.speak('你好！', { lang: 'zh', gender: 'female' });
  synth.run();
  assert.deepEqual(synth.said.map((s) => [s.text, s.voice]), [['你好！', null]]);
  assert.equal(sp.lastError, '');
  // next time another voice
  sp.speak('再见！', { lang: 'zh', gender: 'female' });
  synth.run();
  assert.notEqual(synth.said[1].voice, 'Tingting');
  // men get a man's voice where there is one
  sp.speak('我是铁匠。', { lang: 'zh', gender: 'male' });
  synth.run();
  assert.equal(synth.said[2].voice, 'Li-mu');
});

test('old words that piled up are cancelled, with a pause before the new ones', () => {
  const win = device();
  const { sp, clock, synth } = speechOn(win);
  for (let i = 0; i < 5; i++) sp.speak('第' + i + '句话。', { lang: 'zh' });
  assert.ok(synth.cancels >= 1, 'cancelled');
  const before = synth.said.length;
  synth.run();
  assert.equal(synth.said.length, before, 'nothing spoken in the same moment as the cancel');
  clock(100);
  synth.run();
  assert.ok(synth.said.length >= 1 && synth.said.at(-1).text === '第4句话。');
});

test('the voice test: what works, and a browser with no speech at all', async () => {
  const win = device();
  const { sp, synth } = speechOn(win);
  sp.volume = 0.2; // (the test speaks at full volume whatever the villagers' volume)
  const p = sp.test('你好！我是村民，你能听到我说话吗？', 'zh');
  synth.run();
  assert.equal(await p, 'ok');
  assert.equal(synth.said[0].volume, 1);
  const st = sp.status('zh');
  assert.equal(st.ok, true);
  assert.equal(st.matching, 3);
  assert.equal(st.voice, 'Tingting');
  // the test while a villager is talking: it is cut off, and the test line follows a moment later
  const busy = speechOn(device());
  busy.sp.speak('我正在说话呢，说了很久很久。', { lang: 'zh' });
  const r = busy.sp.test('试听！', 'zh');
  assert.equal(busy.synth.cancels, 1);
  busy.synth.run();
  assert.equal(busy.synth.said.length, 0, 'nothing in the same moment as the cancel');
  busy.clock(100);
  busy.synth.run();
  assert.equal(await r, 'ok');
  assert.deepEqual(busy.synth.said.map((x) => x.text), ['试听！']);
  // blocked: the test says so
  const blocked = speechOn(device({ needsTap: true }));
  const q = blocked.sp.test('你好！', 'zh');
  blocked.clock(3000);
  assert.equal(await q, 'silent');
  // WeChat's browser and the like
  const none = new Speech({});
  assert.equal(none.ok, false);
  assert.equal(none.speak('你好'), false);
  assert.equal(await none.test('你好'), 'unsupported');
  assert.equal(none.status().ok, false);
  // a device with voices, none of them Chinese
  const en = speechOn(device({ voices: [VOICES[3]] }));
  assert.equal(en.sp.status('zh').matching, 0);
});
