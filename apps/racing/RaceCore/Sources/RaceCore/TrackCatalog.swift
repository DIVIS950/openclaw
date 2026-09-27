import Foundation

/// Built-in track database.
///
/// `location` is the approximate circuit center, used for auto-detection (3 km radius) and map framing.
/// Start/finish gates are intentionally NOT hard-coded: a gate 30 m off ruins lap timing, so the gate
/// is either placed by the driver on the satellite map (one tap + drag the arrow) or inferred
/// automatically from the first flying lap (`TrackLocator.inferStartFinish`). Once set, it is saved
/// as a user override and reused.
public enum TrackCatalog {
    private static func t(
        _ id: String, _ name: String, _ country: String, _ city: String, _ kind: TrackKind,
        _ length: Double, _ lat: Double, _ lon: Double, _ notes: String = ""
    ) -> Track {
        Track(
            id: id, name: name, country: country, city: city, kind: kind, length: length,
            location: GeoPoint(lat: lat, lon: lon), notes: notes
        )
    }

    public static let all: [Track] = circuits + karts

    public static let circuits: [Track] = [
        // Central Europe
        t("brno", "Automotodrom Brno", "CZ", "Brno", .circuit, 5403, 49.2031, 16.4444,
          "Fast flowing, big elevation changes. Key: T1 heavy braking downhill, uphill esses, fast T10-T11 before the long uphill finish."),
        t("most", "Autodrom Most", "CZ", "Most", .circuit, 4212, 50.5194, 13.6069,
          "Technical, mostly flat. Tight hairpins reward good exits; long back straight."),
        t("slovakiaring", "Slovakia Ring", "SK", "Orechová Potôň", .circuit, 5922, 48.0564, 17.5617,
          "Long straights and slow hairpins: braking stability and traction out of slow corners dominate."),
        t("hungaroring", "Hungaroring", "HU", "Mogyoród", .circuit, 4381, 47.5789, 19.2486,
          "Twisty, few overtaking spots. T1 downhill heavy braking; long sequence T6-T11 needs rhythm."),
        t("pannonia", "Pannonia-Ring", "HU", "Ostffyasszonyfa", .circuit, 4740, 47.2006, 17.0350),
        t("redbullring", "Red Bull Ring", "AT", "Spielberg", .circuit, 4318, 47.2197, 14.7647,
          "Three big stops uphill T1, T3, T4; fast downhill T9-T10 is where time is found."),
        t("salzburgring", "Salzburgring", "AT", "Salzburg", .circuit, 4241, 47.8228, 13.1706),
        t("poznan", "Tor Poznań", "PL", "Poznań", .circuit, 4083, 52.4186, 16.8117),
        t("nordschleife", "Nürburgring Nordschleife", "DE", "Nürburg", .circuit, 20832, 50.3356, 6.9475,
          "Learn in sections: Hatzenbach, Flugplatz, Fuchsröhre, Adenauer Forst, Karussell, Döttinger Höhe. Safety first, bumps and blind crests."),
        t("nurburgring-gp", "Nürburgring GP", "DE", "Nürburg", .circuit, 5148, 50.3325, 6.9406,
          "T1 Castrol-S heavy braking; Mercedes Arena slow; fast Schumacher-S."),
        t("hockenheim", "Hockenheimring GP", "DE", "Hockenheim", .circuit, 4574, 49.3278, 8.5656,
          "Big stop into the hairpin after the Parabolika; Motodrom stadium section rewards patience."),
        t("sachsenring", "Sachsenring", "DE", "Hohenstein-Ernstthal", .circuit, 3671, 50.7917, 12.6883,
          "Mostly left-handers; blind downhill Waterfall (T11) is the key commitment corner."),
        t("lausitzring", "Lausitzring GP", "DE", "Klettwitz", .circuit, 4345, 51.5344, 13.9281),
        t("oschersleben", "Motorsport Arena Oschersleben", "DE", "Oschersleben", .circuit, 3696, 52.0272, 11.2800),
        t("bilsterberg", "Bilster Berg", "DE", "Bad Driburg", .circuit, 4200, 51.7950, 9.0539,
          "Extreme elevation and blind crests. Commit to references, not sight lines."),
        // Western Europe
        t("spa", "Circuit de Spa-Francorchamps", "BE", "Stavelot", .circuit, 7004, 50.4372, 5.9714,
          "La Source hairpin exit, Eau Rouge/Raidillon commitment, Les Combes braking, Pouhon double-left, Blanchimont, Bus Stop chicane."),
        t("zolder", "Circuit Zolder", "BE", "Heusden-Zolder", .circuit, 4011, 50.9906, 5.2572),
        t("zandvoort", "Circuit Zandvoort", "NL", "Zandvoort", .circuit, 4259, 52.3888, 4.5409,
          "Banked Hugenholtz and Arie Luyendyk corners: use the banking, carry speed."),
        t("assen", "TT Circuit Assen", "NL", "Assen", .circuit, 4542, 52.9614, 6.5236),
        t("paulricard", "Circuit Paul Ricard", "FR", "Le Castellet", .circuit, 5842, 43.2506, 5.7917),
        t("magnycours", "Circuit de Nevers Magny-Cours", "FR", "Magny-Cours", .circuit, 4411, 46.8642, 3.1636,
          "Adelaide hairpin is the biggest stop; Nürburg / 180 / Château d'Eau reward good exits."),
        t("dijon", "Dijon-Prenois", "FR", "Prenois", .circuit, 3801, 47.3625, 4.8992),
        t("silverstone", "Silverstone GP", "GB", "Silverstone", .circuit, 5891, 52.0786, -1.0169,
          "Maggotts-Becketts-Chapel: sacrifice entry for flow. Stowe and Vale/Club braking zones."),
        t("brandshatch", "Brands Hatch GP", "GB", "West Kingsdown", .circuit, 3908, 51.3569, 0.2631,
          "Paddock Hill Bend: blind, downhill, off-camber. Druids hairpin and Graham Hill bend exits."),
        t("donington", "Donington Park", "GB", "Castle Donington", .circuit, 4020, 52.8306, -1.3750,
          "Craner Curves downhill commitment; Melbourne and Goddards hairpins for braking."),
        t("oultonpark", "Oulton Park", "GB", "Little Budworth", .circuit, 4307, 53.1797, -2.6131),
        t("barcelona", "Circuit de Barcelona-Catalunya", "ES", "Montmeló", .circuit, 4657, 41.5700, 2.2611),
        t("jerez", "Circuito de Jerez", "ES", "Jerez", .circuit, 4428, 36.7083, -6.0342),
        t("valencia", "Circuit Ricardo Tormo", "ES", "Cheste", .circuit, 4005, 39.4889, -0.6286),
        t("portimao", "Algarve International Circuit", "PT", "Portimão", .circuit, 4653, 37.2272, -8.6267,
          "Rollercoaster elevation: blind crests into T1 and the final downhill right-hander."),
        t("estoril", "Circuito do Estoril", "PT", "Estoril", .circuit, 4182, 38.7506, -9.3942),
        t("monza", "Autodromo Nazionale Monza", "IT", "Monza", .circuit, 5793, 45.6156, 9.2811,
          "Low downforce. Brake stability into Rettifilo chicane, Roggia, both Lesmos, Ascari, and a clean Parabolica exit."),
        t("imola", "Autodromo Enzo e Dino Ferrari", "IT", "Imola", .circuit, 4909, 44.3439, 11.7167),
        t("mugello", "Autodromo del Mugello", "IT", "Scarperia", .circuit, 5245, 43.9975, 11.3719,
          "Fast, flowing: Arrabbiata 1 & 2 commitment. San Donato heavy braking after the long straight."),
        t("vallelunga", "Vallelunga", "IT", "Campagnano di Roma", .circuit, 4085, 42.1581, 12.3697),
        t("misano", "Misano World Circuit", "IT", "Misano Adriatico", .circuit, 4226, 43.9614, 12.6833),
        t("anderstorp", "Anderstorp Raceway", "SE", "Anderstorp", .circuit, 4025, 57.2644, 13.6011),
        // Rest of the world
        t("suzuka", "Suzuka Circuit", "JP", "Suzuka", .circuit, 5807, 34.8431, 136.5410,
          "Esses rhythm, Degner, hairpin, Spoon, 130R, casio chicane."),
        t("fuji", "Fuji Speedway", "JP", "Oyama", .circuit, 4563, 35.3717, 138.9272),
        t("cota", "Circuit of the Americas", "US", "Austin", .circuit, 5513, 30.1328, -97.6411),
        t("lagunaseca", "WeatherTech Raceway Laguna Seca", "US", "Monterey", .circuit, 3602, 36.5842, -121.7534,
          "Corkscrew: brake uphill blind, aim at the tree, let the car fall. T2 Andretti hairpin double apex."),
        t("roadamerica", "Road America", "US", "Elkhart Lake", .circuit, 6515, 43.7972, -87.9894),
        t("watkinsglen", "Watkins Glen", "US", "Watkins Glen", .circuit, 5430, 42.3369, -76.9272),
        t("roadatlanta", "Michelin Raceway Road Atlanta", "US", "Braselton", .circuit, 4088, 34.1497, -83.8153),
        t("sebring", "Sebring International Raceway", "US", "Sebring", .circuit, 6019, 27.4547, -81.3483,
          "Very bumpy concrete sections; Turn 17 is long and bumpy — stability over aggression."),
        t("ctmp", "Canadian Tire Motorsport Park", "CA", "Bowmanville", .circuit, 3957, 44.0481, -78.6756),
        t("interlagos", "Autódromo José Carlos Pace", "BR", "São Paulo", .circuit, 4309, -23.7036, -46.6997),
        t("bathurst", "Mount Panorama", "AU", "Bathurst", .circuit, 6213, -33.4478, 149.5547),
        t("phillipisland", "Phillip Island", "AU", "Ventnor", .circuit, 4445, -38.5006, 145.2308),
        t("yasmarina", "Yas Marina", "AE", "Abu Dhabi", .circuit, 5281, 24.4672, 54.6031),
        t("bahrain", "Bahrain International Circuit", "BH", "Sakhir", .circuit, 5412, 26.0325, 50.5106),
        t("kyalami", "Kyalami", "ZA", "Midrand", .circuit, 4522, -25.9978, 28.0694),
    ]

    public static let karts: [Track] = [
        t("lonato", "South Garda Karting", "IT", "Lonato del Garda", .kart, 1010, 45.4467, 10.4903,
          "Classic international kart track. Hairpin after the main straight is the key overtaking spot."),
        t("adria-kart", "Adria Karting Raceway", "IT", "Adria", .kart, 1302, 45.0506, 12.1453),
        t("7laghi", "Kartodromo 7 Laghi", "IT", "Castelletto di Branduzzo", .kart, 1200, 45.0697, 9.0981),
        t("genk", "Karting Genk (Horensbergdam)", "BE", "Genk", .kart, 1360, 50.9528, 5.4375,
          "Fast, flowing layout with long sweepers: minimum speed and a smooth line are everything."),
        t("kerpen", "Erftlandring Kerpen", "DE", "Kerpen", .kart, 1107, 50.8878, 6.6789),
        t("wackersdorf", "Prokart Raceland Wackersdorf", "DE", "Wackersdorf", .kart, 1190, 49.3242, 12.1872),
        t("salbris", "Kartdrome Salbris", "FR", "Salbris", .kart, 1300, 47.4300, 2.0500),
        t("zuera", "Motorland Zuera Karting", "ES", "Zuera", .kart, 1700, 41.8500, -0.7800),
        t("pfi", "PFI Kart Circuit", "GB", "Brandon (Lincs)", .kart, 1382, 52.9600, -0.6800),
        t("whiltonmill", "Whilton Mill", "GB", "Whilton", .kart, 1180, 52.2800, -1.1000),
        t("kakucs", "Kakucs Ring", "HU", "Kakucs", .kart, 1300, 47.2400, 19.3600),
        t("portimao-kart", "Kartódromo Internacional do Algarve", "PT", "Portimão", .kart, 1500, 37.2280, -8.6300),
        t("orlando-kart", "Orlando Kart Center", "US", "Orlando", .kart, 1210, 28.4700, -81.4400),
    ]

    public static func track(id: String) -> Track? { all.first { $0.id == id } }
}
