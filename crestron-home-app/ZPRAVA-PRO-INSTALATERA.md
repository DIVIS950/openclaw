# Zpráva pro instalatéra Crestronu

Zkopírujte a pošlete e‑mailem nebo zprávou. Doplňte jen oslovení.

---

Dobrý den,

chci na našem Crestronu používat vlastní aplikaci na iPadu místo Crestron Go. Aplikace se k procesoru připojuje stejně jako dotykový panel (XPanel přes CIP, port 41794). Potřeboval bych od vás prosím tyto věci:

1. **Nový XPanel v programu** na volném IP ID (například 0x0A), napojený na stejné signály jako současný iPad (Crestron Go). Zkopírování symbolu stávajícího panelu na nové IP ID obvykle stačí. Prosím nepoužívat IP ID panelu, který už běží.

2. **IP adresu procesoru** v domácí síti a typ procesoru (např. CP3, CP4, MC4).

3. **Seznam joinů** pro nový XPanel – u každého světla, žaluzie, scény, termostatu, brány, zóny alarmu a sauny čísla signálů:
   - stmívaná světla: analogový join úrovně (0–65535) a případně digitální on/off + feedback,
   - spínaná světla: digitální on/off (nebo toggle) + feedback,
   - žaluzie: analog polohy, nebo digitální nahoru/dolů/stop,
   - scény a tlačítka (Vypnout vše, Televize, Čtení, Party, Vypnout AV…): digitální press + feedback,
   - termostaty: analog aktuální teploty a žádané teploty (°C × 10, tedy 215 = 21,5 °C), feedback „topí“; pokud je žádaná teplota jen tlačítky +/−, tak ta,
   - režim topení (Zapnuto / Individuální / …): digitální tlačítka + feedback,
   - sauna: digitální zapnout/vypnout + feedback, analog teploty,
   - brány a vrata (Brána, Vjezd ke garáži, Garáž, Vjezd vzadu): digitální otevřít/zavřít/stop nebo impuls + feedback otevřeno/zavřeno,
   - zóny alarmu (Dům, Garáž, Klub, Sauna): digitální zajistit/odjistit (nebo toggle) + feedback zajištěno,
   - zámky dveří a zvonek, pokud jsou v programu.

   Čísla stačí vepsat do tohoto seznamu, kde je každé zařízení připravené: **(sem vložte odkaz na stránku „Místnosti a zařízení“)**. U každé položky jsou políčka D (digitální), A (analogový) a S (sériový).

4. Pokud má procesor zapnutou **autentizaci** (časté u 4‑Series), prosím povolit připojení pro toto IP ID, nebo mi dát přihlašovací údaje.

5. **Web XPanel:** chtěl bych aplikaci provozovat jako HTML5 Web XPanel přímo z procesoru (bez dalšího zařízení). Prosím ověřte, že to procesor umí (4‑Series s firmwarem 2.500+, nebo 3‑Series s firmwarem 1.7000+), u XPanelu v programu zapněte podporu Web XPanel a nahrajte do procesoru soubor `HomeView.ch5z`, který vám pošlu (Toolbox, nebo `ch5-cli deploy -t controlsystem`). Napište mi prosím typ procesoru a verzi firmwaru.

Nic jiného v programu měnit nepotřebuji. Současný panel zůstane fungovat beze změny.

Děkuji,
