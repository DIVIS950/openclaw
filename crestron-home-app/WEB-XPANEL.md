# Home View na procesoru Crestron (zdarma, bez dalšího počítače)

Procesor Crestron umí sám hostovat webovou stránku a mluvit s ní po Wi‑Fi (Crestron tomu říká **HTML5 Web XPanel**). Home View se tak nahraje přímo do procesoru. Na iPadu se otevře v Safari z adresy procesoru a přidá na plochu jako aplikace. Žádný Raspberry Pi, žádný účet u Applu, žádné poplatky.

## Co musí platit

| | |
|---|---|
| Procesor | **4‑Series** (CP4, MC4, …) s firmwarem **2.500 nebo novějším**, nebo **3‑Series** (CP3, AV3, PRO3, …) s firmwarem **1.7000 nebo novějším**. MC3 a TPCS‑4SM Web XPanel neumí. |
| Licence | Není potřeba. Crestron licenci Mobility pro Web XPanel v prohlížeči zrušil. |
| Síť | iPad a procesor na stejné domácí síti. Prohlížeč se připojuje na port **49200** (zabezpečený WebSocket). |
| Program | Instalatér přidá do programu SIMPL **XPanel** na volném IP ID (např. `0A`) napojený na stejné signály jako stávající panel. Na 4‑Series se u symbolu zapne podpora Web XPanel. |

## Postup

### 1. Instalatér (jednou)

1. Přidá XPanel na volné IP ID a pošle vám IP adresu procesoru a IP ID.
2. Vyplní čísla joinů do sdílené stránky **Místnosti a zařízení** (odkaz máte v `ZPRAVA-PRO-INSTALATERA.md`). Stránka vyrobí `joinmap.json`.
3. Nahraje soubor **`HomeView.ch5z`** do procesoru (Crestron Toolbox › Web XPanel / HTML project, nebo `npx ch5-cli deploy -H <ip> -t controlsystem HomeView.ch5z`). Soubor vzniká v sekci 2 níže; můžete mu ho poslat vy.
4. Pokud má procesor zapnutou autentizaci, založí vám uživatele (jméno + heslo) pro web procesoru.

### 2. Soubor `HomeView.ch5z`

Vyrobí ho GitHub sám při každé změně (záložka **Actions › Home View Web XPanel › Artifacts**), nebo kdokoli s Node 22:

```bash
cd crestron-home-app/web/xpanel
npm install
npm run build            # -> dist/HomeView.ch5z
```

Volitelně se dá do balíčku rovnou zapéct adresa a join mapa, pak aplikace nic nevyžaduje:

```bash
HOST=192.168.1.20 IPID=0A JOINMAP=../../joinmap.json npm run build
```

### 3. iPad (5 minut)

1. V Safari otevřete `https://<IP procesoru>/` (např. `https://192.168.1.20/`). Certifikát procesoru je vlastní, Safari se zeptá; potvrďte **Pokračovat**. Případně se přihlaste uživatelem od instalatéra.
2. Otevře se Home View. Průvodce nastavením vás provede: IP adresa procesoru, IP ID, import `joinmap.json` (ze Souborů nebo vložením), test jednoho světla.
3. **Sdílet › Přidat na plochu.** Od té doby se spouští jako aplikace, na celou obrazovku, s modrou ikonou.
4. **Nastavení iPadu › Zobrazení a jas › Automatický zámek: Nikdy**, v aplikaci **Nastavení › Režim nástěnného panelu**, a **Asistovaný přístup**, aby iPad zůstal v aplikaci.

Nastavení (IP, IP ID, join mapa, oblíbené, rozložení) si Safari pamatuje v tomto iPadu. Další iPad nebo telefon otevře stejnou adresu a projde průvodcem také.

## Co funguje a co ne

- **Funguje:** světla, žaluzie, scény, topení, sauna, režimy, brány, zóny alarmu, zámky, zvonek (pop‑up), audio/video, oblíbené, rozvrhy a časovače (běží v iPadu, který je na zdi stále zapnutý), StandBy, čeština.
- **Asistent Ask Home:** volitelný; klíč Anthropic API se zadává v Nastavení a zůstává jen v tomto iPadu. Pár korun měsíčně.
- **Kamery:** jen ty, které umí https obrázek nebo stream, protože stránka procesoru je https a Safari nepustí http obrázky do https stránky. Jinak kamery zůstávají ve své aplikaci.
- **Apple Home / Matter a Samsung TV:** jen v nativní iPad aplikaci, ne ve Web XPanelu (Safari se k nim nedostane).

## Když se nepřipojí

| Co vidíte | Příčina | Řešení |
|---|---|---|
| Stránka se vůbec nenačte | Špatná IP, jiná Wi‑Fi, nebo program není nahraný | Zkuste `https://<IP>/` v Safari; ověřte u instalatéra |
| „Nepřihlášeno“ / přesměrování na přihlášení | Procesor má zapnutou autentizaci | Přihlaste se jménem a heslem od instalatéra, pak stránku obnovte |
| „IP ID není v programu“ / připojení odmítnuto | XPanel na tomto IP ID chybí, nebo IP ID už používá jiný panel | Instalatér ověří IP ID |
| Připojeno, ale nic nereaguje | Čísla joinů nesedí | Instalatér opraví čísla na sdílené stránce, vy znovu importujete |
| Funguje, ale po chvíli „Odpojeno“ | iPad usnul nebo vypadla Wi‑Fi | Automatický zámek Nikdy; aplikace se připojí sama znovu |

---

# Home View on the Crestron processor (free, no extra computer)

The processor hosts the page itself (Crestron's **HTML5 Web XPanel**) and talks to Safari over Wi‑Fi on port 49200. Needs a 4‑Series with firmware 2.500+ or a 3‑Series with 1.7000+ (not MC3/TPCS‑4SM); no license.

1. **Installer:** adds an XPanel on a free IP ID, fills the join numbers into the shared Rooms page (which makes `joinmap.json`), loads `HomeView.ch5z` onto the processor (Toolbox or `npx ch5-cli deploy -H <ip> -t controlsystem HomeView.ch5z`).
2. **The file:** GitHub Actions builds it (Actions › Home View Web XPanel › Artifacts), or `cd crestron-home-app/web/xpanel && npm install && npm run build`. Optional: `HOST=… IPID=… JOINMAP=… npm run build` bakes the settings in.
3. **iPad:** Safari → `https://<processor-ip>/` → accept the certificate → the setup guide (IP, IP ID, import join map, test a light) → Share › Add to Home Screen → Auto-Lock Never, wall panel mode, Guided Access.

Works: everything in the house, favorites, schedules and timers (they run on the always-on wall iPad), StandBy, Czech. Optional Ask Home with your own key. Cameras only over https. Apple Home/Matter and Samsung TV are native-app only.
