# Jak připojit aplikaci k Crestronu (iPad přes Wi‑Fi)

Aplikace Home Control běží přímo na iPadu a mluví s procesorem Crestron po domácí Wi‑Fi, stejně jako dotykový panel. Žádný další počítač není potřeba. Vše níže uděláte jednou.

## Co budete potřebovat

| Od koho | Co | K čemu |
|---|---|---|
| Instalatér | **IP adresu procesoru** (např. 192.168.1.20) | Kam se aplikace připojí |
| Instalatér | **IP ID** nového XPanelu (hex, např. `0A`) | Aplikace se hlásí jako panel |
| Instalatér | **Soubor `joinmap.json`** | Co je světlo, žaluzie, termostat… a jaká mají čísla |
| Vy | iPad s iPadOS 17+, na domácí Wi‑Fi | Na zdi nebo v ruce |
| Vy | Aplikaci z TestFlightu | Viz `TESTFLIGHT.md` |

Zpráva pro instalatéra je připravená v `ZPRAVA-PRO-INSTALATERA.md`. Čísla joinů instalatér vepíše do sdílené stránky **Místnosti a zařízení**; ta vám pak jedním klepnutím vyrobí `joinmap.json`.

## 1. Nainstalujte aplikaci

1. Na iPadu nainstalujte z App Storu zdarma aplikaci **TestFlight**.
2. Otevřete pozvánku do TestFlightu (e‑mail nebo odkaz) a klepněte na **Instalovat**.
3. Spusťte **Home Control**. Při prvním spuštění ukazuje ukázkový dům, abyste si ji mohli prohlédnout.

## 2. Připojte Crestron

1. V aplikaci otevřete **Nastavení** (ozubené kolo vlevo dole) › **Systém**.
2. Vyberte typ **Vlastní program** (custom program).
3. Vyplňte:
   - **Adresa procesoru:** IP adresa od instalatéra.
   - **IP ID:** dvě hexadecimální číslice od instalatéra (např. `0A`).
   - **Port:** nechte `41794`.
4. **Join mapa:** klepněte na **Importovat soubor** a vyberte `joinmap.json` (ze Souborů, iCloudu, AirDropu nebo přílohy e‑mailu). Nebo **Vložit** a vložte text souboru.
   Pod tlačítkem se objeví např. „Join mapa: 48 zařízení · 12 místností“.
5. Klepněte na **Uložit a připojit**.

Do 10 sekund se nahoře v postranním panelu rozsvítí zelená tečka **Připojeno** a objeví se vaše místnosti. Zkuste rozsvítit jedno světlo.

### Když se nepřipojí

| Hláška | Co to znamená | Řešení |
|---|---|---|
| „Žádná odpověď z … na portu panelu“ | Špatná IP, nebo iPad není na stejné Wi‑Fi | Zkontrolujte IP; vypněte na iPadu VPN; zkuste z telefonu na stejné Wi‑Fi otevřít `http://<IP>` |
| „IP ID … není v programu definováno“ | Instalatér XPanel na tomto IP ID ještě nepřidal, nebo je jiné | Ověřte IP ID u instalatéra |
| Připojeno, ale nic nereaguje | Čísla v join mapě nesedí | Pošlete instalatérovi, co nefunguje; opraví čísla ve sdílené stránce, vy znovu importujete |
| Připojení procesor odmítá | Zapnutá autentizace (4‑Series) | Instalatér povolí toto IP ID, nebo vypne autentizaci pro panely |

## 3. iPad na zdi

- **Nastavení iPadu › Zobrazení a jas › Automatický zámek: Nikdy.**
- V aplikaci **Nastavení › Režim nástěnného panelu: zapnuto.** Po několika minutách ukáže velké hodiny (StandBy); zvonek ho probudí.
- **Nastavení iPadu › Zpřístupnění › Asistovaný přístup**: zapněte a spusťte ho v Home Control trojím stisknutím horního tlačítka. iPad pak zůstane v aplikaci.
- Jas nechte **automatický**; v noci je tmavý režim.

## 4. Apple Home / Matter (volitelné)

Zařízení Matter přidáváte jako dosud v aplikaci **Domácnost** (Apple Home). Pak v Home Control: **Nastavení › Apple Home › Zobrazit zařízení z Apple Home: zapnuto.** iPad se zeptá na povolení; potvrďte. Světla, zásuvky, termostaty, žaluzie, zámky a televize z Domácnosti se objeví vedle zařízení Crestronu, ve stejných místnostech, jaké mají v Domácnosti.

## 5. Samsung TV (volitelné)

Televize se ovládá přímo po Wi‑Fi, bez cloudu SmartThings (SmartThings od roku 2025 ruší přístupové tokeny po 24 hodinách, což se na nástěnný panel nehodí).

1. Na televizi: **Nastavení › Všeobecné › Síť › Stav sítě** – opište **IP adresu**; a **Správce externích zařízení › Správce připojení zařízení: zapnuto**.
2. V Home Control: **Nastavení › Samsung TV › Přidat**: název, IP adresa, místnost, případně MAC adresa (pro zapnutí z pohotovostního režimu).
3. Klepněte na **Spárovat**. Na televizi se objeví dotaz **Povolit Home Control?** → **Povolit**. Hotovo; televize si aplikaci pamatuje.

Pak má televize v Home Control vlastní kartu: vstupy (HDMI), kanály, aplikace (Netflix, YouTube, Disney+, …) a dálkový ovladač.

> Některé nejnovější modely (2024+) dotaz na povolení nezobrazí a nelze je takto ovládat. Pak zůstává ovládání přes HDMI (Apple TV) nebo Crestron.

## 6. Asistent Ask Home (volitelné, pár korun měsíčně)

**Nastavení › Asistent › Klíč Anthropic API.** Klíč zůstává jen v tomto iPadu (v Keychain). Bez klíče aplikace funguje normálně, jen bez hlasového asistenta.

## Bezpečnost

- Aplikace mluví s procesorem jen na domácí Wi‑Fi. Nic neotvírejte na routeru.
- Pro hosty používejte **hostovskou Wi‑Fi**; z ní se k procesoru nedostanou.
- Odemknutí dveří a otevření brány vyžaduje přidržení / přejetí; alarm vypnete jen kódem. Asistent ani náhodné klepnutí to neudělá.
- Přístup aplikace může instalatér kdykoli zrušit smazáním jejího IP ID z programu.

---

# How to connect the app to Crestron (iPad over Wi‑Fi)

Home Control runs on the iPad and talks to the Crestron processor over home Wi‑Fi, like a touch panel. No extra computer. You do everything below once.

**You need from the installer:** the processor's **IP address**, a free **IP ID** for a new XPanel (hex, e.g. `0A`), and the **`joinmap.json`** file (the installer fills the join numbers into the shared **Rooms and devices** page, which makes the file).

1. **Install:** TestFlight from the App Store, open the invitation, install Home Control. (See `TESTFLIGHT.md`.)
2. **Connect:** Settings › System › **Custom program** → processor IP, IP ID, port `41794` → **Import join map file** (from Files, iCloud, AirDrop or an email attachment) → **Save and connect**. Within 10 seconds the sidebar shows a green **Connected** dot and your rooms.
3. **Wall iPad:** Auto-Lock Never; Wall panel mode on in the app; Guided Access (triple-click the top button) so it stays in the app.
4. **Apple Home / Matter (optional):** Settings › Apple Home › Show Apple Home accessories. Matter devices you added in the Home app appear next to the Crestron ones.
5. **Samsung TV (optional):** on the TV, note its IP and enable Device Connection Manager; in the app, Settings › Samsung TVs › Add → Pair → accept **Allow** on the TV. Local Wi‑Fi control, no SmartThings cloud (its tokens now expire every 24 hours).
6. **Ask Home (optional):** Settings › Assistant › Anthropic API key, stored only on this iPad.

If it won't connect: wrong IP or a different Wi‑Fi/VPN; the IP ID isn't in the program yet; a 4‑Series processor with authentication on (the installer allows this IP ID). If it connects but nothing moves, a join number is wrong: the installer fixes it on the shared page, you import again.
