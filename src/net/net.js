// Connection to a Lumencraft multiplayer server: one WebSocket carrying small JSON messages.
// Messages are handled strictly in arrival order (the welcome can arrive gzipped and needs an
// asynchronous unpack, so everything goes through one promise chain).

export const PROTOCOL = 1;

// "game.example.com", "1.2.3.4:8080", "https://game.example.com", "wss://..." -> WebSocket URL.
// Empty: the server this page came from, at the same path (the game can be reverse-proxied under
// a subpath, e.g. a hub serving it at /games/lumencraft/ alongside other games on one origin).
export function serverUrl(input, loc = typeof location !== 'undefined' ? location : null) {
  let s = String(input || '').trim();
  const pageSecure = loc && loc.protocol === 'https:';
  if (!s) {
    if (!loc || !/^https?:$/.test(loc.protocol)) return null;
    const base = loc.pathname.replace(/[^/]*$/, ''); // this page's own directory
    return `${pageSecure ? 'wss' : 'ws'}://${loc.host}${base}ws`;
  }
  if (/^https?:\/\//i.test(s)) s = s.replace(/^http/i, 'ws');
  if (!/^wss?:\/\//i.test(s)) {
    // bare host: a domain is assumed to have https; a plain IP address (or a local name) usually
    // doesn't, unless this page itself came over https
    const plain = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/|$)/.test(s);
    s = (pageSecure || !plain ? 'wss://' : 'ws://') + s;
  }
  const u = new URL(s);
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/ws';
  return u.toString();
}

async function gunzipText(buf) {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

export class NetClient {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.chain = Promise.resolve();
    this.open = false;
    this.id = null;
    this.rtt = 0;
    this.pingTimer = null;
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  // Resolves with the welcome message, rejects with Error(code) ('password', 'full', 'nameTaken',
  // 'version', 'badName', 'unreachable', 'timeout').
  connect(url, hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code) => { if (!settled) { settled = true; reject(new Error(code)); } };
      let ws;
      try { ws = new WebSocket(url); } catch (e) { fail('unreachable'); return; }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const timer = setTimeout(() => { fail('timeout'); try { ws.close(); } catch (e) { /* ignore */ } }, 12000);
      ws.onopen = () => ws.send(JSON.stringify({ ...hello, t: 'hello', v: PROTOCOL, gz: typeof DecompressionStream !== 'undefined' }));
      ws.onerror = () => fail('unreachable');
      ws.onclose = () => {
        clearTimeout(timer);
        const was = this.open;
        this.open = false;
        clearInterval(this.pingTimer);
        fail('unreachable');
        if (was && this.handlers.close) this.handlers.close();
      };
      ws.onmessage = (ev) => {
        this.chain = this.chain.then(async () => {
          const text = typeof ev.data === 'string' ? ev.data : await gunzipText(ev.data);
          const m = JSON.parse(text);
          if (m.t === 'welcome') {
            clearTimeout(timer);
            settled = true;
            this.open = true;
            this.id = m.id;
            this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 4000);
            resolve(m);
            return;
          }
          if (m.t === 'err') { clearTimeout(timer); fail(m.code); return; }
          if (m.t === 'pong') { this.rtt = performance.now() - m.c; this.online = m.n; return; }
          const h = this.handlers[m.t];
          if (h) h(m);
        }).catch((e) => console.error('net message', e));
      };
    });
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.open = false;
    clearInterval(this.pingTimer);
    this.handlers = {};
    try { if (this.ws) this.ws.close(); } catch (e) { /* ignore */ }
  }
}
