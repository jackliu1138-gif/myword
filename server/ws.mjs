// A small WebSocket server (RFC 6455) on top of node:http, so the game server needs no packages:
// text and binary messages, fragmented messages, ping / pong, close, 64-bit lengths, a size cap.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maxMessage = 1 << 20 } = {}) {
    super();
    this.socket = socket;
    this.maxMessage = maxMessage;
    this.buf = Buffer.alloc(0);
    this.frags = null;
    this.open = true;
    this.closed = false;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const op = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        if (b.readUInt32BE(2) !== 0) { this.close(1009); return; }
        len = b.readUInt32BE(6);
        off = 10;
      }
      if (len > this.maxMessage) { this.close(1009); return; }
      if (!masked) { this.close(1002); return; } // browsers always mask
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.frame(fin, op, payload);
    }
  }

  frame(fin, op, payload) {
    if (op === 8) { this.close(payload.length >= 2 ? payload.readUInt16BE(0) : 1000); return; }
    if (op === 9) { this.sendFrame(10, payload); return; }
    if (op === 10) { this.emit('pong'); return; }
    if (op === 0) {
      if (!this.frags) { this.close(1002); return; }
      this.frags.chunks.push(payload);
      this.frags.size += payload.length;
      if (this.frags.size > this.maxMessage) { this.close(1009); return; }
      if (fin) {
        const { op: first, chunks } = this.frags;
        this.frags = null;
        this.deliver(first, Buffer.concat(chunks));
      }
      return;
    }
    if (op !== 1 && op !== 2) { this.close(1003); return; }
    if (!fin) { this.frags = { op, chunks: [payload], size: payload.length }; return; }
    this.deliver(op, payload);
  }

  deliver(op, data) {
    this.emit('message', op === 1 ? data.toString('utf8') : data, op === 2);
  }

  sendFrame(op, data) {
    if (!this.open || this.socket.destroyed) return;
    const len = data.length;
    let head;
    if (len < 126) {
      head = Buffer.alloc(2);
      head[1] = len;
    } else if (len < 65536) {
      head = Buffer.alloc(4);
      head[1] = 126;
      head.writeUInt16BE(len, 2);
    } else {
      head = Buffer.alloc(10);
      head[1] = 127;
      head.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
      head.writeUInt32BE(len >>> 0, 6);
    }
    head[0] = 0x80 | op;
    this.socket.cork();
    this.socket.write(head);
    this.socket.write(data);
    this.socket.uncork();
  }

  send(text) {
    this.sendFrame(1, Buffer.from(text, 'utf8'));
  }

  sendBinary(buf) {
    this.sendFrame(2, buf);
  }

  ping() {
    this.sendFrame(9, Buffer.alloc(0));
  }

  // bytes queued for this client (a slow connection backs up here)
  get buffered() {
    return this.socket.writableLength;
  }

  close(code = 1000) {
    if (!this.open) return;
    const p = Buffer.alloc(2);
    p.writeUInt16BE(code, 0);
    this.sendFrame(8, p);
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this.finish();
  }

  finish() {
    this.open = false;
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }
}

// Completes the HTTP upgrade handshake; returns the connection, or null after rejecting it.
export function acceptUpgrade(req, socket, opts) {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    return null;
  }
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  return new WebSocketConnection(socket, opts);
}
