// Line icons drawn on a 24px grid, stroke-only so they take the text color.
const P = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11.5h13V9"/><path d="M10 20.5V15h4v5.5"/>',
  bulb: '<path d="M9.2 17.5h5.6"/><path d="M10 20.5h4"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.7.6 1 1.3 1 2.1v.2h5.4v-.2c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z"/>',
  bulbOff: '<path d="M9.2 17.5h5.6"/><path d="M10 20.5h4"/><path d="M12 3a6 6 0 0 0-3.7 10.7c.7.6 1 1.3 1 2.1v.2h5.4v-.2c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 3z"/><path d="M4 4l16 16"/>',
  blinds: '<path d="M3.5 4h17"/><path d="M5 4v9.5h14V4"/><path d="M5 7.2h14M5 10.4h14"/><path d="M12 13.5V18"/><circle cx="12" cy="19.6" r="1.4"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2.6"/><circle cx="12" cy="14.2" r="3"/><circle cx="12" cy="7.6" r=".9"/>',
  shield: '<path d="M12 3 4.8 5.8v5.6c0 4.5 3 8.2 7.2 9.6 4.2-1.4 7.2-5.1 7.2-9.6V5.8z"/>',
  shieldCheck: '<path d="M12 3 4.8 5.8v5.6c0 4.5 3 8.2 7.2 9.6 4.2-1.4 7.2-5.1 7.2-9.6V5.8z"/><path d="m9 12.2 2.1 2.1 4-4.2"/>',
  shieldAlert: '<path d="M12 3 4.8 5.8v5.6c0 4.5 3 8.2 7.2 9.6 4.2-1.4 7.2-5.1 7.2-9.6V5.8z"/><path d="M12 8.2v4.6"/><path d="M12 16.2h.01"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><path d="M12 14.5v2"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2.6"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.3-1.5"/><path d="M12 14.5v2"/>',
  gate: '<path d="M3 20.5V5M21 20.5V5"/><path d="M3 8h18M3 16.5h18"/><path d="M7.5 8v8.5M12 8v8.5M16.5 8v8.5"/>',
  camera: '<rect x="2.8" y="6.5" width="13.2" height="11" rx="2.6"/><path d="m16 10.6 5.2-3v8.8l-5.2-3"/>',
  sliders: '<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.4"/><circle cx="10" cy="17" r="2.4"/>',
  power: '<path d="M12 3.5V11"/><path d="M6.8 6.6a7.6 7.6 0 1 0 10.4 0"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  moon: '<path d="M20 14.6A8.2 8.2 0 0 1 9.4 4 8.2 8.2 0 1 0 20 14.6z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  sunrise: '<path d="M3 18.5h18"/><path d="M6.8 18.5a5.2 5.2 0 0 1 10.4 0"/><path d="M12 3.5v5M9.6 6 12 3.5 14.4 6"/><path d="M4.4 11.4l1.4 1.4M19.6 11.4l-1.4 1.4"/>',
  away: '<path d="M14 3.5h4.5a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M9.5 8 5.5 12l4 4"/><path d="M5.5 12H15"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2.6"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>',
  fork: '<path d="M7 3v7.5a2 2 0 0 0 2 2V21"/><path d="M11 3v7.5a2 2 0 0 1-2 2"/><path d="M9 3v5"/><path d="M17.5 21V3c-2.2 1.5-3.2 4-3.2 7.2 0 2.5.9 3.8 3.2 3.8"/>',
  book: '<path d="M5 4.6A1.6 1.6 0 0 1 6.6 3H19v14.5H6.6A1.6 1.6 0 0 0 5 19.1z"/><path d="M5 19.1a1.6 1.6 0 0 0 1.6 1.6H19v-3.2"/>',
  sparkle: '<path d="M11 3.5l1.7 4.8L17.5 10l-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7z"/><path d="M18 15.5l.7 1.8 1.8.7-1.8.7L18 20.5l-.7-1.8-1.8-.7 1.8-.7z"/>',
  sofa: '<path d="M4.5 11V8.2a3 3 0 0 1 3-3h9a3 3 0 0 1 3 3V11"/><path d="M2.5 13.2a2 2 0 0 1 4 0v2.3h11v-2.3a2 2 0 0 1 4 0v5.3h-19z"/><path d="M5 18.5v2M19 18.5v2"/>',
  bed: '<path d="M3 19.5V6"/><path d="M3 13h18v6.5"/><path d="M3 16.2h18"/><path d="M7 13v-2.3A1.7 1.7 0 0 1 8.7 9h2.6A1.7 1.7 0 0 1 13 10.7V13"/>',
  desk: '<rect x="3" y="4" width="18" height="12" rx="2.2"/><path d="M8.5 20.5h7M12 16v4.5"/>',
  door: '<path d="M4.5 21h15"/><path d="M7 21V4.2a1.2 1.2 0 0 1 1.2-1.2h7.6A1.2 1.2 0 0 1 17 4.2V21"/><path d="M14 12.2h.01"/>',
  tree: '<path d="M12 21v-4.5"/><path d="M12 3 6.2 11.5h3.1l-3.1 5h11.6l-3.1-5h3.1z"/>',
  car: '<path d="M4.5 17h15v-4l-2-5.2h-11L4.5 13z"/><path d="M5 17v2.5M19 17v2.5"/><path d="M4.5 13h15"/><path d="M8 15h.01M16 15h.01"/>',
  bath: '<path d="M3.5 12h17v2.8a5.2 5.2 0 0 1-5.2 5.2H8.7a5.2 5.2 0 0 1-5.2-5.2z"/><path d="M6 12V5.8a2.3 2.3 0 0 1 4.3-1.2"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
  up: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
  down: '<path d="M12 5v13.5M6.5 13l5.5 5.5 5.5-5.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.8"/>',
  volume: '<path d="M4 9.5h3.5L12 5.2v13.6l-4.5-4.3H4z"/><path d="M15.5 9.2a4 4 0 0 1 0 5.6M18 6.7a7.5 7.5 0 0 1 0 10.6"/>',
  mute: '<path d="M4 9.5h3.5L12 5.2v13.6l-4.5-4.3H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  back: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  deleteKey: '<path d="M9 5.5h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-6-6.5z"/><path d="m12.5 9.5 5 5M17.5 9.5l-5 5"/>',
  open: '<path d="M12 4.5v15"/><path d="M9 12H3.5M6 9l-3 3 3 3"/><path d="M15 12h5.5M18 9l3 3-3 3"/>',
  closeIn: '<path d="M12 4.5v15"/><path d="M3 12h6M6 9l3 3-3 3"/><path d="M21 12h-6M18 9l-3 3 3 3"/>',
  bolt: '<path d="M13 3 5.5 13h6l-1 8L18 11h-6z"/>',
  wifi: '<path d="M4.5 10a11 11 0 0 1 15 0"/><path d="M7.5 13.3a6.6 6.6 0 0 1 9 0"/><path d="M12 17.2h.01"/>',
};

export function icon(name, extraClass = "") {
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${P[name] ?? P.sparkle}</svg>`;
}

const ROOM_ICONS = [
  ["kitchen", "fork"], ["dining", "fork"], ["living", "sofa"], ["family", "sofa"], ["lounge", "sofa"],
  ["bed", "bed"], ["master", "bed"], ["guest", "bed"], ["kid", "bed"], ["nursery", "bed"],
  ["office", "desk"], ["study", "book"], ["library", "book"], ["bath", "bath"], ["patio", "sun"],
  ["garden", "tree"], ["yard", "tree"], ["outdoor", "tree"], ["pool", "sun"], ["garage", "car"],
  ["entry", "door"], ["foyer", "door"], ["hall", "door"], ["theater", "film"], ["cinema", "film"],
  ["media", "film"], ["tv", "film"], ["gym", "bolt"], ["wine", "fork"],
];

export function roomIcon(name) {
  const n = String(name).toLowerCase();
  return ROOM_ICONS.find(([k]) => n.includes(k))?.[1] ?? "grid";
}

export function sceneIcon(scene) {
  const n = scene.name.toLowerCase();
  if (/night|sleep|bed/.test(n)) return "moon";
  if (/morning|wake|sunrise/.test(n)) return "sunrise";
  if (/away|leave|vacation/.test(n)) return "away";
  if (/welcome|home|arrive/.test(n)) return "home";
  if (/movie|tv|cinema|film/.test(n)) return "film";
  if (/dinner|cook|kitchen|meal/.test(n)) return "fork";
  if (/read|book/.test(n)) return "book";
  if (/off/.test(n)) return "power";
  if (/bright|on$|all on/.test(n)) return "sun";
  return { lighting: "bulb", shades: "blinds", media: "music", climate: "sun" }[scene.kind] ?? "sparkle";
}
