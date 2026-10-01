// iPhone and iPad: by default a web page's sound (and its speech) goes through the "ambient" audio
// session, which the silent switch (an iPad's silent mode) mutes. Games and the villagers' voices
// should play as a video does: the "playback" session. Safari 17 lets a page ask for it
// (navigator.audioSession); before that, a silent clip looping in an <audio> element puts the page
// in it. While the microphone is on (voice chat) the page records as well.

const SILENT_WAV = 'data:audio/wav;base64,UklGRsQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YaAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

const nav = typeof navigator !== 'undefined' ? navigator : null;
export const IS_IOS = !!nav && (/iP(hone|ad|od)/.test(nav.platform || '') || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1));

let recording = false;
let clip = null;

function setType(type) {
  try {
    const s = nav && nav.audioSession;
    if (!s) return false;
    if (s.type !== type) s.type = type;
    return true;
  } catch (e) {
    return false;
  }
}

// From a tap (and at start): sound plays even with the silent switch on.
export function playThroughSilentSwitch() {
  if (setType(recording ? 'play-and-record' : 'playback')) return;
  if (!IS_IOS || typeof document === 'undefined' || document.hidden) return;
  if (!clip) {
    clip = document.createElement('audio');
    clip.setAttribute('x-webkit-airplay', 'deny');
    clip.setAttribute('playsinline', '');
    clip.preload = 'auto';
    clip.loop = true;
    clip.src = SILENT_WAV;
    // (not playing on in the background: the next tap starts it again)
    document.addEventListener('visibilitychange', () => { if (document.hidden && clip) clip.pause(); });
  }
  if (clip.paused) clip.play().catch(() => {});
}

// The microphone on or off (voice chat).
export function setRecording(on) {
  recording = !!on;
  setType(recording ? 'play-and-record' : 'playback');
}
