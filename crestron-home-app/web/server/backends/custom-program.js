// For dealer-programmed (SIMPL) systems: connects as a touch panel over CIP and feeds
// the joins to the shared join-map logic (../../public/shared/joinmap.js), which the
// browser also uses when the app runs as a Crestron Web XPanel.
import { JoinMapHome, parseJoinMap, runOps } from "../../public/shared/joinmap.js";
import { CIPClient } from "./cip-client.js";

export { parseJoinMap };

export class CustomProgramBackend {
  pollMs = null; // the processor pushes join changes

  constructor({ host, ipId, port, joinMap }) {
    this.host = String(host ?? "").trim();
    this.home = new JoinMapHome(parseJoinMap(joinMap));
    this.client = new CIPClient({ host: this.host, port, ipId });
    this.onChange = null;
    this.onStatus = null;
    this.publishTimer = null;
    this.client.on("digital", (join, value) => { this.home.setDigital(join, value); this.#schedulePublish(); });
    this.client.on("analog", (join, value) => { this.home.setAnalog(join, value); this.#schedulePublish(); });
    this.client.on("serial", (join, text) => { this.home.setSerial(join, text); this.#schedulePublish(); });
    this.client.on("state", (state, error) => {
      if (state === "connected") this.onStatus?.({ connection: "connected" });
      if (state === "failed") this.onStatus?.({ connection: "failed", message: error });
    });
  }

  /** The parsed join map (tests and the setup page read it). */
  get map() { return this.home.map; }
  get digital() { return this.home.digital; }
  get analog() { return this.home.analog; }
  get serial() { return this.home.serial; }

  async connect() {
    if (!this.host) throw new Error("Enter the processor address in Setup.");
    this.client.start();
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (this.client.state === "connected") return;
      if (this.client.rejected) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const reason = this.client.lastError ?? `No answer from ${this.host} on the touch-panel port. Check the address and IP ID.`;
    if (this.client.rejected) this.client.stop();
    // Otherwise leave the client retrying in the background; the store reports the error.
    throw new Error(reason);
  }

  disconnect() {
    clearTimeout(this.publishTimer);
    this.client.stop();
  }

  async fetch() {
    return this.home.snapshot();
  }

  #schedulePublish() {
    // A burst of joins arrives at once (the initial update); publish once.
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => {
      this.publishTimer = null;
      this.onChange?.(this.home.snapshot());
    }, 60);
  }

  async perform(cmd) {
    if (this.client.state !== "connected") throw new Error("Not connected to the processor yet.");
    await runOps(this.home.plan(cmd), this.client);
  }
}
