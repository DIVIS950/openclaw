// A pretend house, used by the server's demo mode and by the browser when it
// can't reach a home server (so the app can always be tried).
import { applyCommand } from "./model.js";

export function sampleHome() {
  const sources = [
    { id: "src-appletv", name: "Apple TV" },
    { id: "src-spotify", name: "Spotify" },
    { id: "src-cable", name: "Cable TV" },
    { id: "src-radio", name: "Radio" },
  ];
  const light = (id, name, roomId, level, dimmable = true) => ({ id, name, roomId, level, dimmable, online: true });
  const shade = (id, name, roomId, position, canStop = false) => ({ id, name, roomId, position, hasPosition: true, canStop, online: true });
  const zone = (id, name, roomId, on, volume, sourceId) => ({
    id, name, roomId, on, volume, muted: false, hasVolume: true, sources, sourceId,
  });
  return {
    rooms: [
      { id: "living", name: "Living Room" },
      { id: "kitchen", name: "Kitchen" },
      { id: "dining", name: "Dining Room" },
      { id: "master", name: "Master Bedroom" },
      { id: "office", name: "Office" },
      { id: "patio", name: "Patio" },
      { id: "entry", name: "Entry" },
    ],
    lights: [
      light("l1", "Ceiling", "living", 0.8),
      light("l2", "Floor lamp", "living", 0.4),
      light("l3", "Cove", "living", 0),
      light("l4", "Pendants", "kitchen", 1),
      light("l5", "Under cabinet", "kitchen", 0.6),
      light("l6", "Chandelier", "dining", 0),
      light("l7", "Bedside", "master", 0.3),
      light("l8", "Ceiling", "master", 0),
      light("l9", "Desk", "office", 0.9),
      light("l10", "String lights", "patio", 0, false),
      light("l11", "Foyer", "entry", 0.5),
    ],
    shades: [
      shade("sh1", "Window shades", "living", 1, true),
      shade("sh2", "Blackout", "master", 0, true),
      shade("sh3", "Sheers", "master", 0.5),
      shade("sh4", "Office blinds", "office", 0.7),
    ],
    scenes: [
      { id: "s-welcome", name: "Welcome", roomId: null, kind: "lighting", active: false },
      { id: "s-goodnight", name: "Good Night", roomId: null, kind: "lighting", active: false },
      { id: "s-away", name: "Away", roomId: null, kind: "other", active: false },
      { id: "s-morning", name: "Morning", roomId: null, kind: "lighting", active: false },
      { id: "s-movie", name: "Movie Time", roomId: "living", kind: "media", active: false },
      { id: "s-dinner", name: "Dinner", roomId: "dining", kind: "lighting", active: false },
      { id: "s-cooking", name: "Cooking", roomId: "kitchen", kind: "lighting", active: false },
      { id: "s-read", name: "Reading", roomId: "master", kind: "lighting", active: false },
    ],
    media: [
      zone("m-living", "Living Room", "living", true, 0.35, "src-appletv"),
      zone("m-kitchen", "Kitchen", "kitchen", true, 0.25, "src-spotify"),
      zone("m-master", "Master Bedroom", "master", false, 0.2, null),
      zone("m-patio", "Patio", "patio", false, 0.5, null),
    ],
    locks: [
      { id: "lock-front", name: "Front door", roomId: "entry", locked: true },
      { id: "lock-patio", name: "Patio door", roomId: "patio", locked: false },
    ],
    security: [
      { id: "alarm", name: "House alarm", mode: "disarmed", needsCode: true, canArmHome: true, canArmAway: true },
    ],
    gates: [
      { id: "gate-drive", name: "Driveway gate", state: "closed", separateOpenClose: true, canStop: true },
    ],
    sensors: [],
  };
}

export class DemoEngine {
  constructor(onChange) {
    this.state = sampleHome();
    this.onChange = onChange;
    this.gateEnd = { "gate-drive": "closed" };
    this.timers = new Set();
  }

  snapshot() {
    return structuredClone(this.state);
  }

  perform(cmd) {
    const s = this.state;
    applyCommand(s, cmd);
    if (cmd.type === "recallScene") this.#runScene(cmd.id);
    if (cmd.type === "gate" && cmd.action !== "stop") {
      // A real gate takes a while to travel; report the end position later.
      const t = setTimeout(() => {
        this.timers.delete(t);
        const gate = s.gates.find((g) => g.id === cmd.id);
        if (!gate) return;
        const opening = cmd.action === "open" || (cmd.action === "trigger" && this.gateEnd[cmd.id] !== "open");
        gate.state = opening ? "open" : "closed";
        this.gateEnd[cmd.id] = gate.state;
        this.onChange?.(this.snapshot());
      }, 4000);
      this.timers.add(t);
    }
    this.onChange?.(this.snapshot());
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  #runScene(id) {
    const s = this.state;
    const setLights = (roomId, level) => {
      for (const l of s.lights) if (roomId == null || l.roomId === roomId) l.level = level;
    };
    for (const scene of s.scenes) scene.active = scene.id === id;
    switch (id) {
      case "s-welcome": setLights(null, 0.7); break;
      case "s-morning":
        setLights(null, 0.5);
        for (const sh of s.shades) sh.position = 1;
        break;
      case "s-goodnight":
        setLights(null, 0);
        for (const l of s.locks) l.locked = true;
        for (const m of s.media) m.on = false;
        break;
      case "s-away":
        setLights(null, 0);
        for (const m of s.media) m.on = false;
        for (const p of s.security) p.mode = "armedAway";
        break;
      case "s-movie": {
        setLights("living", 0.12);
        for (const sh of s.shades) if (sh.roomId === "living") sh.position = 0;
        const tv = s.media.find((m) => m.id === "m-living");
        if (tv) { tv.on = true; tv.sourceId = "src-appletv"; }
        break;
      }
      case "s-dinner": setLights("dining", 0.45); setLights("kitchen", 0.6); break;
      case "s-cooking": setLights("kitchen", 1); break;
      case "s-read": setLights("master", 0.35); break;
    }
  }
}
