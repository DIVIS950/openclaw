// Minimal Crestron-over-IP (CIP) client: joins the processor like a touch panel or
// XPanel (TCP 41794, one IP ID) and exchanges digital, analog and serial joins.
// Packet layout follows the open-source python-cipclient project. Every packet is
// 1 byte type + 2 bytes big-endian payload length + payload; joins are 1-based in
// SIMPL and 0-based on the wire.
import { EventEmitter } from "node:events";
import net from "node:net";

export class CIPClient extends EventEmitter {
  constructor({ host, port = 41794, ipId }) {
    super();
    this.host = host;
    this.port = port;
    this.ipId = ipId;
    this.state = "disconnected"; // connecting | registering | connected | failed
    this.lastError = null;
    this.rejected = false;
    this.wanted = false;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.heartbeat = null;
    this.reconnect = null;
  }

  start() {
    this.wanted = true;
    this.rejected = false;
    this.#open();
  }

  stop() {
    this.wanted = false;
    clearTimeout(this.reconnect);
    clearInterval(this.heartbeat);
    this.socket?.destroy();
    this.socket = null;
    this.#setState("disconnected");
  }

  setDigital(join, value, button = true) {
    if (!(join > 0)) return;
    const j = join - 1;
    let high = (j >> 8) & 0x7f;
    if (!value) high |= 0x80;
    this.#send([0x05, 0x00, 0x06, 0x00, 0x00, 0x03, button ? 0x27 : 0x00, j & 0xff, high]);
  }

  /** Press and release, like tapping a touch-panel button. */
  pulse(join) {
    this.setDigital(join, true);
    setTimeout(() => this.setDigital(join, false), 200);
  }

  setAnalog(join, value) {
    if (!(join > 0)) return;
    const j = join - 1;
    const v = Math.max(0, Math.min(65535, Math.round(value)));
    this.#send([0x05, 0x00, 0x08, 0x00, 0x00, 0x05, 0x14, (j >> 8) & 0xff, j & 0xff, (v >> 8) & 0xff, v & 0xff]);
  }

  setSerial(join, text) {
    if (!(join > 0)) return;
    const j = join - 1;
    const bytes = Buffer.from(String(text), "utf8").subarray(0, 240);
    const n = bytes.length;
    this.#send(Buffer.concat([Buffer.from([0x12, 0x00, 8 + n, 0x00, 0x00, 0x00, 4 + n, 0x34, (j >> 8) & 0xff, j & 0xff, 0x03]), bytes]));
  }

  #setState(state, error = null) {
    if (error) this.lastError = error;
    if (state === this.state) return;
    this.state = state;
    this.emit("state", state, error);
  }

  #open() {
    this.buffer = Buffer.alloc(0);
    this.#setState("connecting");
    const socket = net.createConnection({ host: this.host, port: this.port });
    this.socket = socket;
    socket.setNoDelay(true);
    socket.setTimeout(45000); // three missed heartbeats
    // The processor sends 0x0F asking us to register once the socket is up.
    socket.on("connect", () => this.#setState("registering"));
    socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.#drain();
    });
    socket.on("timeout", () => socket.destroy(new Error("no answer from the processor")));
    socket.on("error", (err) => { this.lastError = `Can't connect to ${this.host}: ${err.message}`; });
    socket.on("close", () => {
      if (socket !== this.socket) return;
      this.socket = null;
      clearInterval(this.heartbeat);
      this.#setState("failed", this.lastError ?? "The processor closed the connection");
      if (this.wanted && !this.rejected) this.reconnect = setTimeout(() => this.#open(), 3000);
    });
  }

  #send(bytes) {
    if (this.socket && !this.socket.destroyed) this.socket.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  }

  #drain() {
    while (this.buffer.length >= 3) {
      const length = (this.buffer[1] << 8) | this.buffer[2];
      if (this.buffer.length < 3 + length) return;
      const type = this.buffer[0];
      const payload = this.buffer.subarray(3, 3 + length);
      this.buffer = this.buffer.subarray(3 + length);
      this.#process(type, payload);
    }
  }

  #process(type, p) {
    switch (type) {
      case 0x0f: // registration request: answer with our IP ID
        this.#send([0x01, 0x00, 0x0b, 0x00, 0x00, 0x00, 0x00, 0x00, this.ipId, 0x40, 0xff, 0xff, 0xf1, 0x01]);
        break;
      case 0x02: // registration result
        if (p[0] === 0xff && p[1] === 0xff) {
          this.rejected = true;
          this.lastError = `IP ID ${this.ipId.toString(16).toUpperCase().padStart(2, "0")} isn't defined in the processor program. Ask your installer to add an XPanel on this IP ID.`;
          this.socket?.destroy();
        } else {
          // Ask for the current value of every join, and keep the session alive.
          this.#send([0x05, 0x00, 0x05, 0x00, 0x00, 0x02, 0x03, 0x00]);
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => this.#send([0x0d, 0x00, 0x02, 0x00, 0x00]), 15000);
          // Some programs never send the end-of-update marker; go live anyway.
          setTimeout(() => { if (this.state === "registering") this.#setState("connected"); }, 3000);
        }
        break;
      case 0x05:
        if (p.length < 4) return;
        if (p[3] === 0x00 && p.length >= 6) {
          const join = (((p[5] & 0x7f) << 8) | p[4]) + 1;
          this.emit("digital", join, (p[5] & 0x80) === 0);
        } else if (p[3] === 0x14 && p.length >= 8) {
          this.emit("analog", ((p[4] << 8) | p[5]) + 1, (p[6] << 8) | p[7]);
        } else if (p[3] === 0x03 && p.length >= 5 && p[4] === 0x1c) {
          // End of the initial update: acknowledge, and we're live.
          this.#send([0x05, 0x00, 0x05, 0x00, 0x00, 0x02, 0x03, 0x1d]);
          this.#send([0x0d, 0x00, 0x02, 0x00, 0x00]);
          this.#setState("connected");
        }
        break;
      case 0x12:
        if (p.length >= 8) this.emit("serial", ((p[5] << 8) | p[6]) + 1, p.subarray(8).toString("utf8"));
        break;
      case 0x03: // processor ended the session
        this.socket?.destroy();
        break;
      default: // 0x0d / 0x0e heartbeats and anything else we don't need
        break;
    }
  }
}
