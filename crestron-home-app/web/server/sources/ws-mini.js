// A very small WebSocket client (RFC 6455): text frames, client-side masking, ping/pong
// and close, over a plain or TLS socket. Node's built-in WebSocket can't relax the
// certificate check for one host, and Samsung TVs answer on port 8002 with a
// self-signed certificate, so this talks to the socket directly.
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OP = { CONTINUATION: 0, TEXT: 1, BINARY: 2, CLOSE: 8, PING: 9, PONG: 10 };

/** Builds one masked frame (clients must mask every frame they send). */
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const len = payload.length;
  const head = len < 126 ? 2 : len < 65536 ? 4 : 10;
  const frame = Buffer.alloc(head + 4 + len);
  frame[0] = 0x80 | opcode;
  if (len < 126) frame[1] = 0x80 | len;
  else if (len < 65536) { frame[1] = 0x80 | 126; frame.writeUInt16BE(len, 2); }
  else { frame[1] = 0x80 | 127; frame.writeBigUInt64BE(BigInt(len), 2); }
  const mask = crypto.randomBytes(4);
  mask.copy(frame, head);
  for (let i = 0; i < len; i++) frame[head + 4 + i] = payload[i] ^ mask[i & 3];
  return frame;
}

/**
 * Events: "open", "message" (text), "close" (code, reason), "error" (Error).
 * readyState: 0 connecting, 1 open, 2 closing, 3 closed.
 */
export class MiniWebSocket extends EventEmitter {
  /** @param {string} url ws:// or wss:// @param {{ rejectUnauthorized?: boolean, timeout?: number }} [opts] */
  constructor(url, { rejectUnauthorized = true, timeout = 8000 } = {}) {
    super();
    this.url = new URL(url);
    this.readyState = 0;
    this.buffer = Buffer.alloc(0);
    this.fragments = null;
    this.closeTimer = null;
    const secure = this.url.protocol === "wss:";
    const host = this.url.hostname;
    const port = Number(this.url.port) || (secure ? 443 : 80);
    this.socket = secure
      ? tls.connect({ host, port, rejectUnauthorized, servername: net.isIP(host) ? undefined : host })
      : net.connect({ host, port });
    this.socket.setNoDelay?.(true);
    this.socket.setTimeout(timeout, () => this.#fail(new Error("The connection timed out.")));
    this.socket.once(secure ? "secureConnect" : "connect", () => this.#handshake());
    this.socket.on("data", (chunk) => this.#onData(chunk));
    this.socket.on("error", (err) => this.#fail(err));
    this.socket.on("close", () => this.#closed(1006, "The connection closed."));
  }

  send(text) {
    if (this.readyState !== 1) throw new Error("The connection isn't open.");
    this.socket.write(encodeFrame(OP.TEXT, Buffer.from(String(text), "utf8")));
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    if (this.readyState === 0) {
      this.readyState = 3;
      this.socket.destroy();
      return;
    }
    this.readyState = 2;
    const body = Buffer.alloc(2 + Buffer.byteLength(reason));
    body.writeUInt16BE(code, 0);
    body.write(reason, 2);
    try { this.socket.write(encodeFrame(OP.CLOSE, body)); } catch {}
    // The peer should answer with its own close frame; don't wait forever for it.
    this.closeTimer = setTimeout(() => this.socket.destroy(), 1000);
    this.closeTimer.unref?.();
  }

  #handshake() {
    this.key = crypto.randomBytes(16).toString("base64");
    const u = this.url;
    const lines = [
      `GET ${u.pathname}${u.search} HTTP/1.1`,
      `Host: ${u.port ? `${u.hostname}:${u.port}` : u.hostname}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${this.key}`,
      "Sec-WebSocket-Version: 13",
      "", "",
    ];
    this.socket.write(lines.join("\r\n"));
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.readyState === 0) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const head = this.buffer.subarray(0, end).toString("latin1").split("\r\n");
      this.buffer = this.buffer.subarray(end + 4);
      const status = Number(head[0].split(" ")[1]);
      const headers = Object.fromEntries(head.slice(1).map((l) => {
        const i = l.indexOf(":");
        return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()];
      }));
      const accept = crypto.createHash("sha1").update(this.key + GUID).digest("base64");
      if (status !== 101 || headers["sec-websocket-accept"] !== accept) {
        return this.#fail(new Error(`The WebSocket handshake failed (${status || "no answer"}).`));
      }
      this.readyState = 1;
      this.socket.setTimeout(0);
      this.emit("open");
    }
    this.#parseFrames();
  }

  #parseFrames() {
    while (this.readyState === 1 || this.readyState === 2) {
      const b = this.buffer;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      const mask = masked ? b.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (b.length < off + len) return;
      let payload = b.subarray(off, off + len);
      if (mask) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buffer = b.subarray(off + len);
      this.#onFrame(fin, opcode, payload);
    }
  }

  #onFrame(fin, opcode, payload) {
    switch (opcode) {
      case OP.CONTINUATION:
        if (!this.fragments) return;
        this.fragments.parts.push(payload);
        if (fin) {
          const { op, parts } = this.fragments;
          this.fragments = null;
          this.#deliver(op, Buffer.concat(parts));
        }
        return;
      case OP.TEXT:
      case OP.BINARY:
        if (!fin) {
          this.fragments = { op: opcode, parts: [payload] };
          return;
        }
        return this.#deliver(opcode, payload);
      case OP.CLOSE: {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
        if (this.readyState === 1) {
          this.readyState = 2;
          try { this.socket.write(encodeFrame(OP.CLOSE, payload.subarray(0, 2))); } catch {}
        }
        this.socket.end();
        return this.#closed(code, reason);
      }
      case OP.PING:
        try { this.socket.write(encodeFrame(OP.PONG, payload)); } catch {}
        return;
      default:
        return; // pong and anything unknown
    }
  }

  #deliver(op, payload) {
    if (op === OP.TEXT) this.emit("message", payload.toString("utf8"));
    else this.emit("binary", payload);
  }

  #fail(err) {
    if (this.readyState === 3) return;
    this.emit("error", err);
    this.socket.destroy();
    this.#closed(1006, err.message);
  }

  #closed(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.closeTimer);
    this.emit("close", code, reason);
  }
}
