// Czech + English strings. A value can be a string or plural forms keyed by
// Intl.PluralRules categories (Czech: one / few / many / other).

const cs = {
  "app.tagline": "Karty, které se ukážou, když jsi v obchodě.",

  "loc.off": "Poloha je vypnutá",
  "loc.turnOn": "Zapnout polohu",
  "loc.searching": "Hledám, kde jsi…",
  "loc.accuracy": "Poloha ± {m}",
  "loc.denied": "Poloha je zakázaná. Povol ji pro tuto stránku v nastavení prohlížeče.",
  "loc.unavailable": "Poloha teď není k dispozici.",
  "loc.why": "Kapsa pak sama ukáže kartu obchodu, ve kterém právě jsi.",

  "here.eyebrow": "Jsi tady",
  "here.at": "{d} od obchodu",
  "here.showCode": "Ukázat kód",
  "here.alsoHere": "Taky tady",
  "near.nearest": "Nejbližší karta",

  "wallet.title": "Karty",
  "wallet.search": "Hledat kartu",
  "wallet.noResults": "Žádná karta neodpovídá „{q}“.",
  "wallet.add": "Přidat kartu",
  "wallet.sample": "Ukázka",
  "wallet.noPlace": "Bez místa",

  "empty.title": "Kapsa je zatím prázdná",
  "empty.body":
    "Naskenuj věrnostní kartu a ulož si, kde je obchod. Až tam příště přijdeš, karta se ukáže sama.",
  "empty.step1": "Naskenuj kód z karty",
  "empty.step2": "Ulož místo obchodu",
  "empty.step3": "V obchodě se karta ukáže sama",
  "empty.add": "Naskenovat první kartu",
  "empty.sample": "Vyzkoušet s ukázkovými kartami",

  "scan.title": "Naskenuj kartu",
  "scan.hint": "Namiř kameru na čárový nebo QR kód",
  "scan.fromPhoto": "Z fotky",
  "scan.manual": "Zadat ručně",
  "scan.torch": "Svítilna",
  "scan.noCamera": "Kamera není k dispozici. Načti kód z fotky nebo ho zadej ručně.",
  "scan.cameraDenied": "Přístup ke kameře je zakázaný. Povol ho v nastavení prohlížeče, nebo použij fotku.",
  "scan.photoNone": "Na fotce jsem kód nenašel. Zkus ostřejší fotku zblízka.",
  "scan.starting": "Zapínám kameru…",
  "scan.reading": "Čtu kód…",

  "form.titleAdd": "Nová karta",
  "form.titleEdit": "Upravit kartu",
  "form.name": "Obchod",
  "form.namePlaceholder": "Např. Bageterie Boulevard",
  "form.hereNow": "Kde právě jsi",
  "form.hereLoading": "Hledám obchody kolem tebe…",
  "form.code": "Číslo karty",
  "form.codePlaceholder": "Číslo pod čárovým kódem",
  "form.format": "Typ kódu",
  "form.formatAuto": "Automaticky",
  "form.formatNone": "Bez kódu (jen číslo)",
  "form.category": "Kategorie",
  "form.color": "Barva",
  "form.photo": "Fotka karty",
  "form.photoAdd": "Vyfotit přední stranu",
  "form.photoRemove": "Odebrat fotku",
  "form.places": "Kde kartu použiješ",
  "form.saveHere": "Uložit místo, kde právě jsem",
  "form.saveHereAcc": "Přesnost ± {m}",
  "form.saveHereOff": "Zapni polohu a ulož místo, kde právě jsi",
  "form.autoBranches": "Hledat pobočky na mapě",
  "form.autoBranchesHint": "Kapsa najde v OpenStreetMap obchody se stejným názvem kolem tebe.",
  "form.note": "Poznámka",
  "form.notePlaceholder": "Např. sleva pro členy, kód do aplikace…",
  "form.save": "Uložit kartu",
  "form.saveChanges": "Uložit změny",
  "form.needName": "Napiš název obchodu.",
  "form.needCode": "Zadej číslo karty, nebo zvol „Bez kódu“.",
  "form.rescan": "Naskenovat znovu",

  "card.close": "Zavřít",
  "card.edit": "Upravit",
  "card.copy": "Kopírovat",
  "card.copied": "Číslo zkopírováno",
  "card.screenOn": "Displej zůstane rozsvícený. Zvyš jas, ať to pokladna načte napoprvé.",
  "card.places": "Místa",
  "card.noPlaces": "Zatím žádné místo. Přidej ho a karta se v obchodě ukáže sama.",
  "card.addHere": "Tady",
  "card.addSearch": "Adresa",
  "card.addMap": "Na mapě",
  "card.placeHere": "Uloženo na místě",
  "card.removePlace": "Odebrat místo",
  "card.branches": {
    one: "Na mapě: {n} pobočka v okolí",
    few: "Na mapě: {n} pobočky v okolí",
    many: "Na mapě: {n} poboček v okolí",
    other: "Na mapě: {n} poboček v okolí",
  },
  "card.branchesNone": "Na mapě zatím žádná pobočka v okolí",
  "card.branchesOff": "Hledání poboček je vypnuté",
  "card.delete": "Smazat kartu",
  "card.deleteConfirm": "Opravdu smazat? Tohle nejde vrátit.",
  "card.deleteYes": "Smazat",
  "card.cancel": "Zrušit",
  "card.deleted": "Karta smazána",
  "card.saved": "Karta uložena",
  "card.placeSaved": "Místo uloženo",
  "card.share": "Sdílet",
  "card.shareText": "Karta {name} do Kapsy",
  "card.linkCopied": "Odkaz na kartu zkopírován",
  "card.used": "Použito {n}×",
  "card.away": "{d} odsud",
  "card.noCode": "Tahle karta nemá kód. Ukaž pokladní číslo.",
  "card.note": "Poznámka",

  "search.title": "Najít adresu",
  "search.placeholder": "Ulice, město nebo název obchodu",
  "search.go": "Hledat",
  "search.none": "Nic jsem nenašel. Zkus to napsat jinak.",
  "search.error": "Hledání nefunguje. Zkontroluj připojení k internetu.",

  "map.title": "Mapa",
  "map.me": "Kde jsem",
  "map.pickTitle": "Posuň mapu tak, aby byl obchod pod špendlíkem",
  "map.pickSave": "Uložit toto místo",
  "map.legendSaved": "Uložené místo",
  "map.legendBranch": "Pobočka z mapy",
  "map.open": "Otevřít kartu",
  "map.back": "Zpět",

  "settings.title": "Nastavení",
  "settings.language": "Jazyk",
  "settings.langAuto": "Podle telefonu",
  "settings.theme": "Vzhled",
  "settings.themeSystem": "Podle telefonu",
  "settings.themeLight": "Světlý",
  "settings.themeDark": "Tmavý",
  "settings.radius": "Kdy jsem v obchodě",
  "settings.radiusHint": "Do jaké vzdálenosti od uloženého místa se karta ukáže nahoře.",
  "settings.autoOpen": "Otevřít kartu sama, když přijdu do obchodu",
  "settings.osm": "Hledat pobočky v OpenStreetMap",
  "settings.osmHint":
    "Při hledání se do OpenStreetMap pošle přibližná poloha a název obchodu. Karty a čísla zůstávají jen v telefonu.",
  "settings.backup": "Záloha",
  "settings.backupHint": "Ulož si soubor se všemi kartami, třeba když měníš telefon.",
  "settings.export": "Uložit zálohu",
  "settings.import": "Nahrát zálohu",
  "settings.imported": {
    one: "Nahrána {n} karta",
    few: "Nahrány {n} karty",
    many: "Nahráno {n} karet",
    other: "Nahráno {n} karet",
  },
  "settings.importError": "Tenhle soubor není záloha Kapsy.",
  "settings.data": "Data",
  "settings.removeSamples": "Smazat ukázkové karty",
  "settings.samplesRemoved": "Ukázkové karty smazány",
  "settings.wipe": "Smazat všechna data",
  "settings.wipeConfirm": "Smaže všechny karty a nastavení z tohoto telefonu.",
  "settings.wiped": "Vše smazáno",
  "settings.install": "Na plochu",
  "settings.installWhy": "Z plochy se Kapsa otevře hned a iPhone jí nesmaže uložené karty.",
  "settings.installIos": "iPhone: v Safari klepni na Sdílet a pak na Přidat na plochu.",
  "settings.installAndroid": "Android: v Chromu otevři menu ⋮ a zvol Instalovat aplikaci.",
  "settings.installButton": "Nainstalovat Kapsu",
  "settings.installed": "Kapsa je nainstalovaná na ploše.",
  "settings.about": "O aplikaci",
  "settings.aboutBody": "Kapsa ukládá karty jen do tohoto telefonu. Mapová data © přispěvatelé OpenStreetMap, podklad © CARTO.",
  "settings.version": "Verze {v}",

  "import.title": "Přidat sdílenou kartu?",
  "import.add": "Přidat do Kapsy",
  "import.invalid": "Odkaz na kartu je poškozený.",

  "update.ready": "Je tu nová verze Kapsy.",
  "update.reload": "Načíst",
  "offline": "Jsi offline. Karty fungují dál.",

  "cat.bakery": "Pekárna",
  "cat.grocery": "Potraviny",
  "cat.coffee": "Kavárna",
  "cat.food": "Jídlo",
  "cat.pharmacy": "Lékárna",
  "cat.beauty": "Drogerie",
  "cat.fashion": "Oblečení",
  "cat.sport": "Sport",
  "cat.fuel": "Benzínka",
  "cat.home": "Dům a hobby",
  "cat.electronics": "Elektronika",
  "cat.other": "Ostatní",
};

/** @type {typeof cs} */
const en = {
  "app.tagline": "Your cards, ready the moment you walk in.",

  "loc.off": "Location is off",
  "loc.turnOn": "Turn on location",
  "loc.searching": "Finding where you are…",
  "loc.accuracy": "Location ± {m}",
  "loc.denied": "Location is blocked. Allow it for this site in your browser settings.",
  "loc.unavailable": "Location isn't available right now.",
  "loc.why": "Kapsa then shows the card for the shop you're in.",

  "here.eyebrow": "You're here",
  "here.at": "{d} from the shop",
  "here.showCode": "Show code",
  "here.alsoHere": "Also here",
  "near.nearest": "Nearest card",

  "wallet.title": "Cards",
  "wallet.search": "Search cards",
  "wallet.noResults": "No card matches “{q}”.",
  "wallet.add": "Add card",
  "wallet.sample": "Sample",
  "wallet.noPlace": "No place yet",

  "empty.title": "Your pocket is empty",
  "empty.body": "Scan a loyalty card and save where the shop is. Next time you walk in, the card shows up by itself.",
  "empty.step1": "Scan the code on the card",
  "empty.step2": "Save where the shop is",
  "empty.step3": "In the shop, the card pops up",
  "empty.add": "Scan your first card",
  "empty.sample": "Try it with sample cards",

  "scan.title": "Scan a card",
  "scan.hint": "Point the camera at the barcode or QR code",
  "scan.fromPhoto": "From photo",
  "scan.manual": "Type it in",
  "scan.torch": "Flashlight",
  "scan.noCamera": "The camera isn't available. Read the code from a photo or type it in.",
  "scan.cameraDenied": "Camera access is blocked. Allow it in your browser settings, or use a photo.",
  "scan.photoNone": "No code found in that photo. Try a sharper, closer shot.",
  "scan.starting": "Starting the camera…",
  "scan.reading": "Reading the code…",

  "form.titleAdd": "New card",
  "form.titleEdit": "Edit card",
  "form.name": "Shop",
  "form.namePlaceholder": "e.g. Bageterie Boulevard",
  "form.hereNow": "Where you are now",
  "form.hereLoading": "Looking for shops around you…",
  "form.code": "Card number",
  "form.codePlaceholder": "The number under the barcode",
  "form.format": "Code type",
  "form.formatAuto": "Automatic",
  "form.formatNone": "No code (number only)",
  "form.category": "Category",
  "form.color": "Colour",
  "form.photo": "Card photo",
  "form.photoAdd": "Take a photo of the front",
  "form.photoRemove": "Remove photo",
  "form.places": "Where you use it",
  "form.saveHere": "Save the place I'm at now",
  "form.saveHereAcc": "Accuracy ± {m}",
  "form.saveHereOff": "Turn on location to save where you are",
  "form.autoBranches": "Find branches on the map",
  "form.autoBranchesHint": "Kapsa looks up shops with the same name around you in OpenStreetMap.",
  "form.note": "Note",
  "form.notePlaceholder": "e.g. member discount, app code…",
  "form.save": "Save card",
  "form.saveChanges": "Save changes",
  "form.needName": "Enter the shop name.",
  "form.needCode": "Enter the card number, or choose “No code”.",
  "form.rescan": "Scan again",

  "card.close": "Close",
  "card.edit": "Edit",
  "card.copy": "Copy",
  "card.copied": "Number copied",
  "card.screenOn": "The screen stays on. Turn the brightness up so the till reads it first time.",
  "card.places": "Places",
  "card.noPlaces": "No places yet. Add one and the card shows up by itself in the shop.",
  "card.addHere": "Here",
  "card.addSearch": "Address",
  "card.addMap": "On map",
  "card.placeHere": "Saved on the spot",
  "card.removePlace": "Remove place",
  "card.branches": {
    one: "On the map: {n} branch nearby",
    few: "On the map: {n} branches nearby",
    many: "On the map: {n} branches nearby",
    other: "On the map: {n} branches nearby",
  },
  "card.branchesNone": "No branches found nearby yet",
  "card.branchesOff": "Branch search is off",
  "card.delete": "Delete card",
  "card.deleteConfirm": "Delete for good? This can't be undone.",
  "card.deleteYes": "Delete",
  "card.cancel": "Cancel",
  "card.deleted": "Card deleted",
  "card.saved": "Card saved",
  "card.placeSaved": "Place saved",
  "card.share": "Share",
  "card.shareText": "{name} card for Kapsa",
  "card.linkCopied": "Card link copied",
  "card.used": "Used {n}×",
  "card.away": "{d} away",
  "card.noCode": "This card has no code. Show the number at the till.",
  "card.note": "Note",

  "search.title": "Find an address",
  "search.placeholder": "Street, city or shop name",
  "search.go": "Search",
  "search.none": "Nothing found. Try different wording.",
  "search.error": "Search isn't working. Check your internet connection.",

  "map.title": "Map",
  "map.me": "My location",
  "map.pickTitle": "Move the map so the shop is under the pin",
  "map.pickSave": "Save this place",
  "map.legendSaved": "Saved place",
  "map.legendBranch": "Branch from the map",
  "map.open": "Open card",
  "map.back": "Back",

  "settings.title": "Settings",
  "settings.language": "Language",
  "settings.langAuto": "Phone default",
  "settings.theme": "Appearance",
  "settings.themeSystem": "Phone default",
  "settings.themeLight": "Light",
  "settings.themeDark": "Dark",
  "settings.radius": "When I'm in the shop",
  "settings.radiusHint": "How close to a saved place you need to be for the card to show up on top.",
  "settings.autoOpen": "Open the card by itself when I walk in",
  "settings.osm": "Find branches in OpenStreetMap",
  "settings.osmHint":
    "Searching sends your rough location and the shop name to OpenStreetMap. Cards and numbers stay on this phone.",
  "settings.backup": "Backup",
  "settings.backupHint": "Save a file with all your cards, for example when you switch phones.",
  "settings.export": "Save backup",
  "settings.import": "Restore backup",
  "settings.imported": {
    one: "{n} card restored",
    few: "{n} cards restored",
    many: "{n} cards restored",
    other: "{n} cards restored",
  },
  "settings.importError": "That file isn't a Kapsa backup.",
  "settings.data": "Data",
  "settings.removeSamples": "Remove sample cards",
  "settings.samplesRemoved": "Sample cards removed",
  "settings.wipe": "Delete all data",
  "settings.wipeConfirm": "This deletes every card and setting on this phone.",
  "settings.wiped": "Everything deleted",
  "settings.install": "Home screen",
  "settings.installWhy": "From the home screen Kapsa opens instantly, and iPhone won't clear your saved cards.",
  "settings.installIos": "iPhone: in Safari tap Share, then Add to Home Screen.",
  "settings.installAndroid": "Android: in Chrome open the ⋮ menu and choose Install app.",
  "settings.installButton": "Install Kapsa",
  "settings.installed": "Kapsa is installed on your home screen.",
  "settings.about": "About",
  "settings.aboutBody": "Kapsa keeps your cards on this phone only. Map data © OpenStreetMap contributors, tiles © CARTO.",
  "settings.version": "Version {v}",

  "import.title": "Add a shared card?",
  "import.add": "Add to Kapsa",
  "import.invalid": "That card link is broken.",

  "update.ready": "A new version of Kapsa is ready.",
  "update.reload": "Reload",
  "offline": "You're offline. Your cards still work.",

  "cat.bakery": "Bakery",
  "cat.grocery": "Groceries",
  "cat.coffee": "Coffee",
  "cat.food": "Food",
  "cat.pharmacy": "Pharmacy",
  "cat.beauty": "Beauty",
  "cat.fashion": "Fashion",
  "cat.sport": "Sport",
  "cat.fuel": "Fuel",
  "cat.home": "Home & DIY",
  "cat.electronics": "Electronics",
  "cat.other": "Other",
};

export const DICTS = { cs, en };
export const LANGS = ["cs", "en"];

let current = "cs";

/**
 * Language from the phone: Czech or Slovak -> Czech, anything else -> English.
 * @param {readonly string[]} languages
 */
export function detectLang(languages) {
  for (const lang of languages) {
    const base = lang.toLowerCase().split("-")[0];
    if (base === "cs" || base === "sk") {
      return "cs";
    }
    if (base === "en") {
      return "en";
    }
  }
  return "en";
}

/** @param {string} lang */
export function setLang(lang) {
  current = LANGS.includes(lang) ? lang : "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
}

export function getLang() {
  return current;
}

/** BCP 47 locale for number formatting. */
export function locale() {
  return current === "cs" ? "cs-CZ" : "en-GB";
}

/**
 * Translate a key. `{name}` placeholders are filled from `vars`; `vars.n` picks the plural form.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars = {}) {
  let value = DICTS[current]?.[key] ?? DICTS.en[key] ?? key;
  if (typeof value === "object") {
    const n = Number(vars.n ?? 0);
    const rule = new Intl.PluralRules(locale()).select(n);
    value = value[rule] ?? value.other;
  }
  return String(value).replace(/\{(\w+)\}/g, (m, name) => (name in vars ? String(vars[name]) : m));
}
