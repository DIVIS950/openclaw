// A pretend house, used by the server's demo mode and by the browser when it
// can't reach a home server (so the app can always be tried).
import { applyCommand } from "./model.js";

// Made-up tracks and shows for the demo house.
const PLAYLISTS = {
  "src-spotify": [
    { title: "Golden Hour Drive", artist: "The Paper Lanterns", album: "Coastline" },
    { title: "Slow Morning", artist: "Mira Vale", album: "Kitchen Radio" },
    { title: "Neon Harbor", artist: "Atlas & Wren", album: "Night Ferry" },
    { title: "Linen", artist: "June Okafor", album: "Soft Rooms" },
  ],
  "src-appletv": [
    { title: "The Long Coast", artist: "Season 2 · Episode 4", album: "Apple TV" },
    { title: "Kitchen Masters", artist: "Season 5 · Episode 1", album: "Apple TV" },
  ],
  "src-cable": [{ title: "Večerní zprávy", artist: "Kanál 7", album: "Satelit" }],
  "src-radio": [{ title: "Ranní jazz", artist: "Rádio 88,5", album: "Rádio" }],
};
const track = (sourceId, index = 0) => {
  const list = PLAYLISTS[sourceId];
  return list ? { ...list[((index % list.length) + list.length) % list.length] } : null;
};

export function sampleHome() {
  const sources = [
    { id: "src-appletv", name: "Apple TV" },
    { id: "src-spotify", name: "Spotify" },
    { id: "src-cable", name: "Satelit" },
    { id: "src-radio", name: "Rádio" },
  ];
  const light = (id, name, roomId, level, dimmable = true) => ({ id, name, roomId, level, dimmable, online: true });
  const shade = (id, name, roomId, position, canStop = true) => ({ id, name, roomId, position, hasPosition: true, canStop, online: true });
  const zone = (id, name, roomId, on, volume, sourceId) => ({
    id, name, roomId, on, volume, muted: false, hasVolume: true, sources, sourceId,
    playing: on, canTransport: true, nowPlaying: on ? track(sourceId) : null,
  });
  const climate = (id, name, roomId, current, target) => ({
    id, name, roomId, current, target, min: 5, max: 30, step: 0.5, heating: current < target - 0.2, online: true,
  });
  const room = (id, name, floor) => ({ id, name, floor });
  return {
    rooms: [
      room("obyvak", "Obývák", "1.NP"),
      room("kuchyne", "Kuchyně", "1.NP"),
      room("jidelna", "Jídelna", "1.NP"),
      room("knihovna", "Knihovna", "1.NP"),
      room("zadveri", "Zádveří", "1.NP"),
      room("loznice", "Ložnice", "2.NP"),
      room("pokoj", "Pokoj pro hosty", "2.NP"),
      room("koupelna", "Koupelna", "2.NP"),
      room("pracovna", "Pracovna", "3.NP"),
      room("klub", "Klub", "Suterén"),
      room("sauna", "Sauna", "Suterén"),
      room("fitko", "Fitko", "Suterén"),
      room("zahrada", "Zahrada", "Venek"),
      room("garaz", "Garáž", "Venek"),
    ],
    lights: [
      light("l1", "Strop", "obyvak", 0.8),
      light("l2", "Bodovky", "obyvak", 0.5),
      light("l3", "Obraz", "obyvak", 0, false),
      light("l4", "Kuchyň", "kuchyne", 1),
      light("l5", "Linka", "kuchyne", 0.6),
      light("l6", "Lustr", "jidelna", 0),
      light("l7", "Bodovky", "jidelna", 0.4),
      light("l8", "Lampy", "knihovna", 0),
      light("l9", "Halogen", "knihovna", 0.7),
      light("l10", "Zádveří", "zadveri", 0.5),
      light("l11", "Schody", "zadveri", 0.3),
      light("l12", "Bodovky", "loznice", 0.3),
      light("l13", "Lampičky", "loznice", 0),
      light("l14", "Strop", "pokoj", 0),
      light("l15", "Sprcha", "koupelna", 0, false),
      light("l16", "Zrcátko", "koupelna", 0.8),
      light("l17", "Bodovky", "pracovna", 0.9),
      light("l18", "Strop", "klub", 0),
      light("l19", "Bar", "klub", 0),
      light("l20", "Strop", "fitko", 0, false),
      light("l21", "Zahrada", "zahrada", 0, false),
      light("l22", "Cesta", "zahrada", 0.6, false),
      light("l23", "Fasáda", "zahrada", 0.6, false),
      light("l24", "Garáž", "garaz", 0, false),
    ],
    shades: [
      shade("sh1", "Žaluzie okno", "obyvak", 1),
      shade("sh2", "Žaluzie terasa", "obyvak", 0.6),
      shade("sh3", "Žaluzie", "kuchyne", 1),
      shade("sh4", "Žaluzie", "jidelna", 0.5),
      shade("sh5", "Žaluzie", "loznice", 0),
      shade("sh6", "Střešní okno", "pracovna", 0.7),
    ],
    scenes: [
      { id: "s-welcome", name: "Příjezd", roomId: null, kind: "lighting", active: false },
      { id: "s-goodnight", name: "Dobrou noc", roomId: null, kind: "lighting", active: false },
      { id: "s-away", name: "Odchod", roomId: null, kind: "other", active: false },
      { id: "s-alloff", name: "Vypnout vše", roomId: null, kind: "lighting", active: false },
      { id: "s-movie", name: "Televize", roomId: "obyvak", kind: "media", active: false },
      { id: "s-read", name: "Čtení", roomId: "obyvak", kind: "lighting", active: false },
      { id: "s-party", name: "Party", roomId: "obyvak", kind: "lighting", active: false },
      { id: "s-dinner", name: "Večeře", roomId: "jidelna", kind: "lighting", active: false },
      { id: "s-cinema", name: "Kino", roomId: "klub", kind: "media", active: false },
    ],
    media: [
      zone("m-obyvak", "Obývák", "obyvak", true, 0.35, "src-appletv"),
      zone("m-kuchyne", "Kuchyně", "kuchyne", true, 0.25, "src-spotify"),
      zone("m-klub", "Klub", "klub", false, 0.4, null),
      zone("m-zahrada", "Zahrada", "zahrada", false, 0.5, null),
    ],
    locks: [
      { id: "lock-front", name: "Vchodové dveře", roomId: "zadveri", locked: true },
      { id: "lock-garden", name: "Dveře na zahradu", roomId: "obyvak", locked: false },
    ],
    // The house has four alarm zones, each armed or off with one tap (no code), like the current panel.
    security: [
      { id: "z-dum", name: "Dům", mode: "disarmed", needsCode: false, canArmHome: false, canArmAway: true },
      { id: "z-garaz", name: "Garáž", mode: "armedAway", needsCode: false, canArmHome: false, canArmAway: true },
      { id: "z-klub", name: "Klub", mode: "disarmed", needsCode: false, canArmHome: false, canArmAway: true },
      { id: "z-sauna", name: "Sauna", mode: "disarmed", needsCode: false, canArmHome: false, canArmAway: true },
    ],
    gates: [
      { id: "gate-main", name: "Brána", state: "closed", separateOpenClose: true, canStop: true },
      { id: "gate-drive", name: "Vjezd ke garáži", state: "closed", separateOpenClose: true, canStop: true },
      { id: "gate-garage", name: "Garáž", state: "closed", separateOpenClose: true, canStop: true },
      { id: "gate-back", name: "Vjezd vzadu", state: "closed", separateOpenClose: false, canStop: false },
    ],
    sensors: [],
    doorbells: [
      { id: "bell-front", name: "Brána", cameraId: "demo-door", lockId: "lock-front", ringAt: null },
    ],
    climate: [
      climate("c-obyvak", "Obývák", "obyvak", 21.6, 22),
      climate("c-kuchyne", "Kuchyně", "kuchyne", 21.4, 21),
      climate("c-jidelna", "Jídelna", "jidelna", 21.2, 21.5),
      climate("c-knihovna", "Knihovna", "knihovna", 20.8, 21),
      climate("c-loznice", "Ložnice", "loznice", 19.6, 19.5),
      climate("c-pokoj", "Pokoj pro hosty", "pokoj", 18.2, 18),
      climate("c-koupelna", "Koupelna", "koupelna", 22.4, 24),
      climate("c-pracovna", "Pracovna", "pracovna", 20.4, 21),
      climate("c-klub", "Klub", "klub", 18.8, 19),
      climate("c-fitko", "Fitko", "fitko", 17.6, 18),
    ],
    modes: [
      {
        id: "heat-mode", name: "Topení v domě", kind: "heating", value: "individual",
        options: [
          { id: "on", name: "Zapnuto" },
          { id: "individual", name: "Individuální" },
          { id: "eco", name: "Útlum" },
          { id: "off", name: "Vypnuto" },
        ],
      },
    ],
    switches: [
      { id: "sw-sauna", name: "Sauna", roomId: "sauna", kind: "sauna", on: false, current: 24 },
      { id: "sw-pir", name: "Venkovní světla na pohyb", roomId: "zahrada", kind: "motion", on: true, current: null },
    ],
  };
}

export class DemoEngine {
  constructor(onChange) {
    this.state = sampleHome();
    this.onChange = onChange;
    this.gateEnd = Object.fromEntries(this.state.gates.map((g) => [g.id, g.state]));
    this.timers = new Set();
    this.trackIndex = new Map();
    // Rooms warm up or cool down slowly toward their target; the sauna heats up when on.
    this.climateTimer = setInterval(() => this.#tickClimate(), 4000);
    this.climateTimer.unref?.();
  }

  #tickClimate() {
    const s = this.state;
    const mode = s.modes.find((m) => m.kind === "heating")?.value ?? "on";
    let changed = false;
    for (const c of s.climate) {
      // "Útlum" lowers every room by 3 °C; "Vypnuto" lets rooms cool toward 16 °C.
      const goal = mode === "off" ? 16 : mode === "eco" ? c.target - 3 : c.target;
      const diff = goal - c.current;
      const heating = mode !== "off" && diff > 0.2;
      if (Math.abs(diff) > 0.05) {
        c.current = Math.round((c.current + Math.sign(diff) * 0.1) * 10) / 10;
        changed = true;
      }
      if (c.heating !== heating) { c.heating = heating; changed = true; }
    }
    for (const sw of s.switches) {
      if (sw.kind !== "sauna") continue;
      const goal = sw.on ? 85 : 24;
      if (Math.abs(goal - sw.current) >= 1) {
        sw.current += Math.sign(goal - sw.current) * (sw.on ? 3 : 1);
        changed = true;
      }
    }
    if (changed) this.onChange?.(this.snapshot());
  }

  /** Pretends someone pressed the doorbell. */
  ring(id) {
    const bell = this.state.doorbells.find((b) => b.id === id) ?? this.state.doorbells[0];
    if (!bell) return;
    bell.ringAt = Date.now();
    this.onChange?.(this.snapshot());
  }

  snapshot() {
    return structuredClone(this.state);
  }

  perform(cmd) {
    const s = this.state;
    applyCommand(s, cmd);
    if (cmd.type === "recallScene") this.#runScene(cmd.id);
    if (cmd.type.startsWith("media")) this.#media(cmd);
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
    clearInterval(this.climateTimer);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  #media(cmd) {
    const zone = this.state.media.find((m) => m.id === cmd.id);
    if (!zone) return;
    if (cmd.type === "mediaSource") {
      this.trackIndex.set(zone.id, 0);
      zone.nowPlaying = track(zone.sourceId);
      zone.playing = true;
    } else if (cmd.type === "mediaPower") {
      zone.playing = cmd.on;
      if (cmd.on && !zone.sourceId) zone.sourceId = zone.sources[1]?.id ?? zone.sources[0]?.id ?? null;
      zone.nowPlaying = cmd.on ? track(zone.sourceId, this.trackIndex.get(zone.id) ?? 0) : null;
    } else if (cmd.type === "mediaTransport" && (cmd.action === "next" || cmd.action === "previous")) {
      const i = (this.trackIndex.get(zone.id) ?? 0) + (cmd.action === "next" ? 1 : -1);
      this.trackIndex.set(zone.id, i);
      zone.nowPlaying = track(zone.sourceId, i);
      zone.playing = true;
    }
  }

  #runScene(id) {
    const s = this.state;
    const setLights = (roomId, level) => {
      for (const l of s.lights) if (roomId == null || l.roomId === roomId) l.level = level;
    };
    for (const scene of s.scenes) scene.active = scene.id === id;
    switch (id) {
      case "s-welcome":
        setLights("zadveri", 0.8); setLights("obyvak", 0.7); setLights("kuchyne", 0.7);
        for (const p of s.security) if (p.id === "z-dum") p.mode = "disarmed";
        break;
      case "s-alloff": setLights(null, 0); break;
      case "s-goodnight":
        setLights(null, 0);
        for (const l of s.locks) l.locked = true;
        for (const m of s.media) { m.on = false; m.playing = false; m.nowPlaying = null; }
        break;
      case "s-away":
        setLights(null, 0);
        for (const m of s.media) { m.on = false; m.playing = false; m.nowPlaying = null; }
        for (const p of s.security) p.mode = "armedAway";
        for (const sh of s.shades) sh.position = 0;
        break;
      case "s-movie": {
        setLights("obyvak", 0.12);
        for (const sh of s.shades) if (sh.roomId === "obyvak") sh.position = 0;
        const tv = s.media.find((m) => m.id === "m-obyvak");
        if (tv) { tv.on = true; tv.sourceId = "src-appletv"; tv.playing = true; tv.nowPlaying = track("src-appletv"); }
        break;
      }
      case "s-cinema": {
        setLights("klub", 0.1);
        const tv = s.media.find((m) => m.id === "m-klub");
        if (tv) { tv.on = true; tv.sourceId = "src-appletv"; tv.playing = true; tv.nowPlaying = track("src-appletv", 1); }
        break;
      }
      case "s-party": {
        setLights("obyvak", 0.6); setLights("kuchyne", 0.8); setLights("jidelna", 0.5);
        const z = s.media.find((m) => m.id === "m-obyvak");
        if (z) { z.on = true; z.sourceId = "src-spotify"; z.playing = true; z.volume = 0.55; z.nowPlaying = track("src-spotify", 2); }
        break;
      }
      case "s-dinner": setLights("jidelna", 0.45); setLights("kuchyne", 0.6); break;
      case "s-read": setLights("obyvak", 0.2); setLights("knihovna", 0.8); break;
    }
  }
}
