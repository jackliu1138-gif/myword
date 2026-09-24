// Voice chat: a WebRTC mesh between everyone on the server (the game server relays the
// signalling), each voice played through Web Audio with its volume and left / right balance set by
// where that player stands. Without a microphone (TVs, projectors) it still receives everyone.
//
// Each pair of players has one connection; the player with the smaller id makes the offer, so
// offers never cross. The audio transceiver is negotiated as send-and-receive from the start and
// the microphone is attached later with replaceTrack, which needs no renegotiation.

export class Voice {
  constructor(net, getContext) {
    this.net = net;
    this.getContext = getContext;
    this.peers = new Map();
    this.ice = [];
    this.stream = null;
    this.track = null;
    this.muted = false;
    this.mode = 'proximity';
    this.range = 48;
    this.volume = 1;
    this.level = 0;
    this.analyser = null;
    this.buf = new Uint8Array(256);
  }

  setIce(list) {
    this.ice = Array.isArray(list) ? list : [];
  }

  get micOn() {
    return !!this.track;
  }

  // Make sure there is a connection with this player (the lower id sends the offer).
  connect(id) {
    id = String(id);
    let peer = this.peers.get(id);
    if (peer) return peer;
    if (typeof RTCPeerConnection === 'undefined') return null;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    peer = { id, pc, pending: [], transceiver: null, initiator: String(this.net.id) < id, level: 0, speaking: false };
    this.peers.set(id, peer);
    pc.onicecandidate = (e) => { if (e.candidate) this.net.send({ t: 'rtc', to: id, d: { c: e.candidate.toJSON() } }); };
    pc.ontrack = (e) => this.attach(peer, e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && peer.initiator && !peer.retry) {
        peer.retry = setTimeout(() => {
          peer.retry = null;
          if (this.peers.get(id) === peer && pc.connectionState === 'failed') this.offer(peer, true);
        }, 1500);
      }
    };
    if (peer.initiator) {
      peer.transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.track) peer.transceiver.sender.replaceTrack(this.track).catch(() => {});
      this.offer(peer);
    }
    return peer;
  }

  async offer(peer, restart = false) {
    try {
      const pc = peer.pc;
      await pc.setLocalDescription(await pc.createOffer(restart ? { iceRestart: true } : undefined));
      this.net.send({ t: 'rtc', to: peer.id, d: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
    } catch (e) { console.warn('voice offer', e); }
  }

  async signal(from, d) {
    if (!d) return;
    const peer = this.connect(from);
    if (!peer) return;
    const pc = peer.pc;
    try {
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') {
          const tr = pc.getTransceivers().find((x) => x.receiver && x.receiver.track && x.receiver.track.kind === 'audio');
          if (tr) {
            tr.direction = 'sendrecv';
            peer.transceiver = tr;
            if (this.track) await tr.sender.replaceTrack(this.track).catch(() => {});
          }
          await pc.setLocalDescription(await pc.createAnswer());
          this.net.send({ t: 'rtc', to: from, d: { sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } } });
        }
      } else if (d.c) {
        if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {});
        else peer.pending.push(d.c);
      }
    } catch (e) { console.warn('voice signal', e); }
  }

  attach(peer, stream) {
    if (peer.stream === stream) return;
    peer.stream = stream;
    // Chrome only feeds remote WebRTC audio into Web Audio while a media element plays it too
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = stream;
    peer.el = el;
    const ctx = this.getContext();
    if (ctx && ctx.createMediaStreamSource) {
      try {
        el.muted = true;
        const src = ctx.createMediaStreamSource(stream);
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        src.connect(gain);
        if (pan) gain.connect(pan).connect(ctx.destination); else gain.connect(ctx.destination);
        Object.assign(peer, { src, gain, pan, analyser: an, buf: new Uint8Array(an.fftSize), ctx });
      } catch (e) {
        el.muted = false;
      }
    }
    el.play().catch(() => {});
  }

  // Asks for the microphone (needs https or localhost). Throws Error('insecure' | 'unsupported' | 'denied').
  async enableMic() {
    if (this.track) return;
    if (typeof window !== 'undefined' && window.isSecureContext === false) throw new Error('insecure');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof RTCPeerConnection === 'undefined') throw new Error('unsupported');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      throw new Error(e && e.name === 'NotAllowedError' ? 'denied' : 'unsupported');
    }
    this.stream = stream;
    this.track = stream.getAudioTracks()[0];
    this.track.enabled = !this.muted;
    for (const p of this.peers.values()) if (p.transceiver) p.transceiver.sender.replaceTrack(this.track).catch(() => {});
    const ctx = this.getContext();
    if (ctx) {
      try {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 256;
        this.micSource = ctx.createMediaStreamSource(stream);
        this.micSource.connect(this.analyser);
      } catch (e) { this.analyser = null; }
    }
    this.announce();
  }

  disableMic() {
    if (!this.track) return;
    for (const p of this.peers.values()) if (p.transceiver) p.transceiver.sender.replaceTrack(null).catch(() => {});
    for (const tr of this.stream.getTracks()) tr.stop();
    try { if (this.micSource) this.micSource.disconnect(); } catch (e) { /* ignore */ }
    this.stream = this.track = this.analyser = this.micSource = null;
    this.level = 0;
    this.announce();
  }

  setMuted(m) {
    this.muted = !!m;
    if (this.track) this.track.enabled = !this.muted;
    this.announce();
  }

  announce() {
    this.net.send({ t: 'voice', on: !!this.track, muted: this.muted });
  }

  remove(id) {
    id = String(id);
    const p = this.peers.get(id);
    if (!p) return;
    clearTimeout(p.retry);
    try { p.pc.close(); } catch (e) { /* ignore */ }
    try { if (p.src) p.src.disconnect(); if (p.gain) p.gain.disconnect(); } catch (e) { /* ignore */ }
    if (p.el) { p.el.srcObject = null; }
    this.peers.delete(id);
  }

  stop() {
    for (const id of [...this.peers.keys()]) this.remove(id);
    this.disableMic();
  }

  // Once every few frames: loudness by distance, balance by direction, who is talking.
  // positionOf(id) -> [x, y, z] or null; yaw: the listener's facing.
  update(listener, yaw, positionOf) {
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const measure = (an, buf) => {
      an.getByteTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      return Math.sqrt(s / buf.length);
    };
    for (const p of this.peers.values()) {
      const pos = positionOf(p.id);
      let vol = this.volume, pan = 0;
      if (this.mode === 'proximity') {
        if (!pos) vol = 0;
        else {
          const dx = pos[0] - listener[0], dy = pos[1] - listener[1], dz = pos[2] - listener[2];
          const d = Math.hypot(dx, dy, dz);
          const near = 6;
          const k = d <= near ? 1 : Math.max(0, 1 - (d - near) / Math.max(1, this.range - near));
          vol *= k * k;
          pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.75 : 0;
        }
      }
      if (p.gain) {
        const now = p.ctx.currentTime;
        p.gain.gain.setTargetAtTime(vol, now, 0.08);
        if (p.pan) p.pan.pan.setTargetAtTime(pan, now, 0.08);
      } else if (p.el && !p.el.muted) p.el.volume = Math.max(0, Math.min(1, vol));
      if (p.analyser) {
        p.level = Math.max(measure(p.analyser, p.buf), p.level * 0.8);
        p.speaking = p.level > 0.025;
      }
    }
    if (this.analyser && this.track && !this.muted) this.level = Math.max(measure(this.analyser, this.buf), this.level * 0.8);
    else this.level = 0;
  }
}
