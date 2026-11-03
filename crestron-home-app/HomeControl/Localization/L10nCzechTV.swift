import Foundation

// Czech texts, keyed by the English text used in the code (see L10n.swift).
// Wording follows web/public/shared/i18n-cs.js.

extension L10n {
    /// The TV remote, Samsung TVs, Apple Home and the join map file.
    static let csTV: [(String, String)] = [
        // The remote
        ("Remote", "Dálkový ovladač"),
        ("Input", "Vstup"),
        ("Channel", "Kanál"),
        ("Channel {n}", "Kanál {n}"),
        ("Apps", "Aplikace"),
        ("Back", "Zpět"),
        ("Menu", "Nabídka"),
        ("Exit", "Konec"),
        ("Info", "Info"),
        ("Guide", "Program"),
        ("Television", "Televize"),
        ("The TV remote", "Dálkový ovladač televize"),
        ("That button", "Toto tlačítko"),
        ("That on a TV", "Tohle na televizi"),
        ("Setting the volume level on this TV", "Nastavení úrovně hlasitosti na této televizi"),
        ("Turning on this TV without its MAC address", "Zapnutí této televize bez MAC adresy"),
        // Samsung TVs
        ("Samsung TVs", "Televize Samsung"),
        ("Add TV", "Přidat televizi"),
        ("IP address", "IP adresa"),
        ("MAC address (optional, for turning on)", "MAC adresa (nepovinné, pro zapnutí)"),
        ("No room", "Bez místnosti"),
        ("Status", "Stav"),
        ("Pair", "Spárovat"),
        ("Paired", "Spárováno"),
        ("Waiting for Allow on the TV", "Čeká na povolení na televizi"),
        ("Allow Home Control on the TV screen", "Povolte Home Control na obrazovce televize"),
        ("Looking for the TV…", "Hledám televizi…"),
        ("Off (standby)", "Vypnuto (pohotovostní režim)"),
        ("Not found", "Nenalezeno"),
        ("Enter the TV's IP address in Settings.", "Zadejte v Nastavení IP adresu televize."),
        ("“{host}” isn't a valid TV address.", "„{host}“ není platná adresa televize."),
        ("The TV said no. Pair again and tap Allow on the TV.", "Televize odmítla. Spárujte znovu a na televizi klepněte na Povolit."),
        ("The TV didn't answer the pairing in time. Try again.", "Televize na párování včas neodpověděla. Zkuste to znovu."),
        ("Can't reach the TV at {host}: {error}", "Televize na adrese {host} není dostupná: {error}"),
        ("Add a Samsung TV in Settings.", "Přidejte v Nastavení televizi Samsung."),
        ("Pair opens the connection once; the TV then asks whether to allow Home Control. Tap Allow on the TV with its own remote. The TV must be on.",
         "Spárovat jednou otevře spojení; televize se pak zeptá, zda Home Control povolit. Klepněte na Povolit ovladačem televize. Televize musí být zapnutá."),
        ("Each TV is controlled directly over Wi-Fi: inputs, apps, channels and the remote. Turning on from standby needs the MAC address (on the TV: Settings › General › Network › Network Status).",
         "Každá televize se ovládá přímo přes Wi-Fi: vstupy, aplikace, kanály a dálkový ovladač. Zapnutí z pohotovostního režimu vyžaduje MAC adresu (na televizi: Nastavení › Obecné › Síť › Stav sítě)."),
        // Apple Home
        ("Show Apple Home accessories", "Zobrazit příslušenství Apple Home"),
        ("Not allowed in Settings › Privacy › Home", "Nepovoleno v Nastavení › Soukromí a zabezpečení › Domácnost"),
        ("Apple Home didn't answer. Open the Home app once, then try again.", "Apple Home neodpověděl. Otevřete jednou aplikaci Domácnost a zkuste to znovu."),
        ("Open the Home app to add Matter and HomeKit accessories; they then show up here.", "Příslušenství Matter a HomeKit přidáte v aplikaci Domácnost; pak se objeví zde."),
        ("Matter and HomeKit accessories you added in the Home app appear next to the Crestron devices, in rooms of the same name. If nothing shows up, allow Home Control in Settings › Privacy & Security › Home, or open the Home app to add accessories.",
         "Příslušenství Matter a HomeKit přidané v aplikaci Domácnost se objeví vedle zařízení Crestron, v místnostech stejného jména. Pokud se nic neobjeví, povolte Home Control v Nastavení › Soukromí a zabezpečení › Domácnost, nebo příslušenství přidejte v aplikaci Domácnost."),
        ("This light", "Toto světlo"),
        ("This shade", "Tato žaluzie"),
        ("This lock", "Tento zámek"),
        ("This input", "Tento vstup"),
        ("That on Apple Home accessories", "Tohle u příslušenství Apple Home"),
        ("“{id}” isn't an Apple Home accessory.", "„{id}“ není příslušenství Apple Home."),
        // The join map file
        ("Import join map file", "Načíst soubor s mapou joinů"),
        ("Paste join map", "Vložit mapu joinů"),
        ("Join map imported.", "Mapa joinů načtena."),
        ("Join map: {devices} · {rooms}", "Mapa joinů: {devices} · {rooms}"),
        ("No join map yet. Ask your installer for joinmap.json and open it here from Files or AirDrop.",
         "Zatím žádná mapa joinů. Požádejte technika o soubor joinmap.json a otevřete ho zde ze Souborů nebo přes AirDrop."),
        ("Ask your installer for a free XPanel IP ID in the program and the joinmap.json file for this app (the join numbers your Crestron Go panel uses). Don't reuse the IP ID of a panel that's in use.",
         "Požádejte technika o volné IP ID pro XPanel v programu a o soubor joinmap.json pro tuto aplikaci (čísla joinů, která používá váš panel Crestron Go). Nepoužívejte IP ID panelu, který je v provozu."),
    ]

    /// "one|other" -> [one, few (2–4), many (0, 5+)].
    static let csTVPlurals: [(String, [String])] = [
        ("{n} device|{n} devices", ["{n} zařízení", "{n} zařízení", "{n} zařízení"]),
    ]
}
