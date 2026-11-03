import Foundation

/// A pretend house so the app can be tried (and designed) without a processor.
@MainActor
final class DemoBackend: HomeBackend {
    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = nil

    private var state = DemoBackend.sampleHome()

    init() {
        for gate in state.gates { lastGateEnd[gate.id] = gate.state }
    }

    func connect() async throws {
        try await Task.sleep(for: .milliseconds(300))
        startClimate()
    }

    func disconnect() {
        climateTask?.cancel()
        climateTask = nil
    }

    func fetch() async throws -> HomeSnapshot { state }

    func perform(_ command: HomeCommand) async throws {
        state.apply(command)
        switch command {
        case let .recallScene(id):
            runScene(id)
        case .mediaPower, .mediaSource, .mediaTransport:
            updateMedia(command)
        case let .gate(id, action) where action != .stop:
            // A real gate takes a while; report the end position after a few seconds.
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(4))
                guard let self, let i = self.state.gates.firstIndex(where: { $0.id == id }) else { return }
                let opening = action == .open || (action == .trigger && self.lastGateEnd[id] != .open)
                self.state.gates[i].state = opening ? .open : .closed
                self.lastGateEnd[id] = self.state.gates[i].state
                self.onChange?(self.state)
            }
        default:
            break
        }
        onChange?(state)
    }

    private var lastGateEnd: [String: GateState] = [:]
    private var climateTask: Task<Void, Never>?
    /// Which track each room is on, so next and previous step through the list.
    private var trackIndex: [String: Int] = [:]

    /// Pretends someone pressed the doorbell (Settings › Test doorbell).
    func ring(_ id: String) {
        guard let i = state.doorbells.firstIndex(where: { $0.id == id }) ?? state.doorbells.indices.first else { return }
        state.doorbells[i].ringAt = Date()
        onChange?(state)
    }

    // Made-up tracks and shows for the demo house.
    private static let playlists: [String: [NowPlaying]] = [
        "src-spotify": [
            NowPlaying(title: "Golden Hour Drive", artist: "The Paper Lanterns", album: "Coastline"),
            NowPlaying(title: "Slow Morning", artist: "Mira Vale", album: "Kitchen Radio"),
            NowPlaying(title: "Neon Harbor", artist: "Atlas & Wren", album: "Night Ferry"),
            NowPlaying(title: "Linen", artist: "June Okafor", album: "Soft Rooms"),
        ],
        "src-appletv": [
            NowPlaying(title: "The Long Coast", artist: "Season 2 · Episode 4", album: "Apple TV"),
            NowPlaying(title: "Kitchen Masters", artist: "Season 5 · Episode 1", album: "Apple TV"),
        ],
        "src-cable": [NowPlaying(title: "Večerní zprávy", artist: "Kanál 7", album: "Satelit")],
        "src-radio": [NowPlaying(title: "Ranní jazz", artist: "Rádio 88,5", album: "Rádio")],
    ]

    private static func track(_ sourceId: String?, _ index: Int = 0) -> NowPlaying? {
        guard let sourceId, let list = playlists[sourceId], !list.isEmpty else { return nil }
        return list[((index % list.count) + list.count) % list.count]
    }

    private func updateMedia(_ command: HomeCommand) {
        switch command {
        case let .mediaSource(id, _):
            guard let i = state.media.firstIndex(where: { $0.id == id }) else { return }
            trackIndex[id] = 0
            state.media[i].nowPlaying = Self.track(state.media[i].currentSourceId)
            state.media[i].isPlaying = true
        case let .mediaPower(id, on):
            guard let i = state.media.firstIndex(where: { $0.id == id }) else { return }
            state.media[i].isPlaying = on
            if on && state.media[i].currentSourceId == nil {
                let sources = state.media[i].sources
                state.media[i].currentSourceId = sources.count > 1 ? sources[1].id : sources.first?.id
            }
            state.media[i].nowPlaying = on ? Self.track(state.media[i].currentSourceId, trackIndex[id] ?? 0) : nil
        case let .mediaTransport(id, action) where action == .next || action == .previous:
            guard let i = state.media.firstIndex(where: { $0.id == id }) else { return }
            let next = (trackIndex[id] ?? 0) + (action == .next ? 1 : -1)
            trackIndex[id] = next
            state.media[i].nowPlaying = Self.track(state.media[i].currentSourceId, next)
            state.media[i].isPlaying = true
        default:
            break
        }
    }

    private func mediaOff() {
        for i in state.media.indices {
            state.media[i].isOn = false
            state.media[i].isPlaying = false
            state.media[i].nowPlaying = nil
        }
    }

    private func runScene(_ id: String) {
        func setLights(_ roomId: String?, _ level: Double) {
            for i in state.lights.indices where roomId == nil || state.lights[i].roomId == roomId {
                state.lights[i].level = level
            }
        }
        func play(_ zoneId: String, _ sourceId: String, track index: Int, volume: Double? = nil) {
            guard let i = state.media.firstIndex(where: { $0.id == zoneId }) else { return }
            state.media[i].isOn = true
            state.media[i].currentSourceId = sourceId
            state.media[i].isPlaying = true
            state.media[i].nowPlaying = Self.track(sourceId, index)
            if let volume { state.media[i].volume = volume }
        }
        for i in state.scenes.indices { state.scenes[i].isActive = state.scenes[i].id == id }
        switch id {
        case "s-welcome":
            setLights("zadveri", 0.8)
            setLights("obyvak", 0.7)
            setLights("kuchyne", 0.7)
            for i in state.security.indices where state.security[i].id == "z-dum" { state.security[i].mode = .disarmed }
        case "s-alloff":
            setLights(nil, 0)
        case "s-goodnight":
            setLights(nil, 0)
            for i in state.locks.indices { state.locks[i].isLocked = true }
            mediaOff()
        case "s-away":
            setLights(nil, 0)
            mediaOff()
            for i in state.security.indices { state.security[i].mode = .armedAway }
            for i in state.shades.indices { state.shades[i].position = 0 }
        case "s-movie":
            setLights("obyvak", 0.12)
            for i in state.shades.indices where state.shades[i].roomId == "obyvak" { state.shades[i].position = 0 }
            play("m-obyvak", "src-appletv", track: 0)
        case "s-cinema":
            setLights("klub", 0.1)
            play("m-klub", "src-appletv", track: 1)
        case "s-party":
            setLights("obyvak", 0.6)
            setLights("kuchyne", 0.8)
            setLights("jidelna", 0.5)
            play("m-obyvak", "src-spotify", track: 2, volume: 0.55)
        case "s-dinner":
            setLights("jidelna", 0.45)
            setLights("kuchyne", 0.6)
        case "s-read":
            setLights("obyvak", 0.2)
            setLights("knihovna", 0.8)
        default:
            break
        }
    }

    // MARK: Heating

    /// Rooms warm up or cool down slowly toward their target; the sauna heats up when on.
    /// Same as #tickClimate in web/public/shared/demo.js, every 4 seconds.
    private func tickClimate() {
        let mode = state.heatingMode?.value ?? "on"
        var changed = false
        for i in state.climate.indices {
            let c = state.climate[i]
            guard let current = c.current, let target = c.target else { continue }
            // "Útlum" lowers every room by 3 °C; "Vypnuto" lets rooms cool toward 16 °C.
            let goal: Double = mode == "off" ? 16 : (mode == "eco" ? target - 3 : target)
            let diff = goal - current
            let heating = mode != "off" && diff > 0.2
            if abs(diff) > 0.05 {
                state.climate[i].current = ((current + (diff > 0 ? 0.1 : -0.1)) * 10).rounded() / 10
                changed = true
            }
            if c.heating != heating {
                state.climate[i].heating = heating
                changed = true
            }
        }
        for i in state.switches.indices where state.switches[i].isSauna {
            let sauna = state.switches[i]
            let now = sauna.current ?? 24
            let goal: Double = sauna.isOn ? 85 : 24
            if abs(goal - now) >= 1 {
                let direction: Double = goal > now ? 1 : -1
                let speed: Double = sauna.isOn ? 3 : 1
                state.switches[i].current = now + direction * speed
                changed = true
            }
        }
        if changed { onChange?(state) }
    }

    private func startClimate() {
        climateTask?.cancel()
        climateTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(4))
                guard !Task.isCancelled, let self else { return }
                self.tickClimate()
            }
        }
    }

    // MARK: The house

    /// The owner's house: floors 1.NP, 2.NP, 3.NP, Suterén and Venek. Same ids, names and
    /// values as sampleHome() in web/public/shared/demo.js.
    static func sampleHome() -> HomeSnapshot {
        let sources = [
            MediaSource(id: "src-appletv", name: "Apple TV"),
            MediaSource(id: "src-spotify", name: "Spotify"),
            MediaSource(id: "src-cable", name: "Satelit"),
            MediaSource(id: "src-radio", name: "Rádio"),
        ]
        func light(_ id: String, _ name: String, _ roomId: String, _ level: Double, dimmable: Bool = true) -> Light {
            Light(id: id, name: name, roomId: roomId, level: level, isDimmable: dimmable)
        }
        func shade(_ id: String, _ name: String, _ roomId: String, _ position: Double) -> Shade {
            Shade(id: id, name: name, roomId: roomId, position: position, supportsStop: true)
        }
        func zone(_ id: String, _ name: String, _ roomId: String, on: Bool, volume: Double, source: String?) -> MediaZone {
            MediaZone(id: id, name: name, roomId: roomId, isOn: on, volume: volume, isMuted: false, sources: sources,
                      currentSourceId: source, isPlaying: on, canTransport: true, nowPlaying: on ? DemoBackend.track(source) : nil)
        }
        func thermostat(_ id: String, _ name: String, _ roomId: String, _ current: Double, _ target: Double) -> Climate {
            Climate(id: id, name: name, roomId: roomId, current: current, target: target, heating: current < target - 0.2)
        }
        func zoneAlarm(_ id: String, _ name: String, _ mode: SecurityMode) -> SecurityPanel {
            SecurityPanel(id: id, name: name, mode: mode, needsCode: false, canArmHome: false, canArmAway: true)
        }
        var home = HomeSnapshot()
        home.rooms = [
            Room(id: "obyvak", name: "Obývák", floor: "1.NP"),
            Room(id: "kuchyne", name: "Kuchyně", floor: "1.NP"),
            Room(id: "jidelna", name: "Jídelna", floor: "1.NP"),
            Room(id: "knihovna", name: "Knihovna", floor: "1.NP"),
            Room(id: "zadveri", name: "Zádveří", floor: "1.NP"),
            Room(id: "loznice", name: "Ložnice", floor: "2.NP"),
            Room(id: "pokoj", name: "Pokoj pro hosty", floor: "2.NP"),
            Room(id: "koupelna", name: "Koupelna", floor: "2.NP"),
            Room(id: "pracovna", name: "Pracovna", floor: "3.NP"),
            Room(id: "klub", name: "Klub", floor: "Suterén"),
            Room(id: "sauna", name: "Sauna", floor: "Suterén"),
            Room(id: "fitko", name: "Fitko", floor: "Suterén"),
            Room(id: "zahrada", name: "Zahrada", floor: "Venek"),
            Room(id: "garaz", name: "Garáž", floor: "Venek"),
        ]
        home.lights = [
            light("l1", "Strop", "obyvak", 0.8),
            light("l2", "Bodovky", "obyvak", 0.5),
            light("l3", "Obraz", "obyvak", 0, dimmable: false),
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
            light("l15", "Sprcha", "koupelna", 0, dimmable: false),
            light("l16", "Zrcátko", "koupelna", 0.8),
            light("l17", "Bodovky", "pracovna", 0.9),
            light("l18", "Strop", "klub", 0),
            light("l19", "Bar", "klub", 0),
            light("l20", "Strop", "fitko", 0, dimmable: false),
            light("l21", "Zahrada", "zahrada", 0, dimmable: false),
            light("l22", "Cesta", "zahrada", 0.6, dimmable: false),
            light("l23", "Fasáda", "zahrada", 0.6, dimmable: false),
            light("l24", "Garáž", "garaz", 0, dimmable: false),
        ]
        home.shades = [
            shade("sh1", "Žaluzie okno", "obyvak", 1),
            shade("sh2", "Žaluzie terasa", "obyvak", 0.6),
            shade("sh3", "Žaluzie", "kuchyne", 1),
            shade("sh4", "Žaluzie", "jidelna", 0.5),
            shade("sh5", "Žaluzie", "loznice", 0),
            shade("sh6", "Střešní okno", "pracovna", 0.7),
        ]
        home.scenes = [
            HomeScene(id: "s-welcome", name: "Příjezd", kind: .lighting),
            HomeScene(id: "s-goodnight", name: "Dobrou noc", kind: .lighting),
            HomeScene(id: "s-away", name: "Odchod", kind: .other),
            HomeScene(id: "s-alloff", name: "Vypnout vše", kind: .lighting),
            HomeScene(id: "s-movie", name: "Televize", roomId: "obyvak", kind: .media),
            HomeScene(id: "s-read", name: "Čtení", roomId: "obyvak", kind: .lighting),
            HomeScene(id: "s-party", name: "Party", roomId: "obyvak", kind: .lighting),
            HomeScene(id: "s-dinner", name: "Večeře", roomId: "jidelna", kind: .lighting),
            HomeScene(id: "s-cinema", name: "Kino", roomId: "klub", kind: .media),
        ]
        home.media = [
            zone("m-obyvak", "Obývák", "obyvak", on: true, volume: 0.35, source: "src-appletv"),
            zone("m-kuchyne", "Kuchyně", "kuchyne", on: true, volume: 0.25, source: "src-spotify"),
            zone("m-klub", "Klub", "klub", on: false, volume: 0.4, source: nil),
            zone("m-zahrada", "Zahrada", "zahrada", on: false, volume: 0.5, source: nil),
        ]
        home.locks = [
            DoorLock(id: "lock-front", name: "Vchodové dveře", roomId: "zadveri", isLocked: true),
            DoorLock(id: "lock-garden", name: "Dveře na zahradu", roomId: "obyvak", isLocked: false),
        ]
        // Four alarm zones, each armed or off with one tap (no code), like the current panel.
        home.security = [
            zoneAlarm("z-dum", "Dům", .disarmed),
            zoneAlarm("z-garaz", "Garáž", .armedAway),
            zoneAlarm("z-klub", "Klub", .disarmed),
            zoneAlarm("z-sauna", "Sauna", .disarmed),
        ]
        home.gates = [
            Gate(id: "gate-main", name: "Brána", state: .closed, hasSeparateOpenClose: true, canStop: true),
            Gate(id: "gate-drive", name: "Vjezd ke garáži", state: .closed, hasSeparateOpenClose: true, canStop: true),
            Gate(id: "gate-garage", name: "Garáž", state: .closed, hasSeparateOpenClose: true, canStop: true),
            Gate(id: "gate-back", name: "Vjezd vzadu", state: .closed, hasSeparateOpenClose: false, canStop: false),
        ]
        home.sensors = []
        home.doorbells = [
            Doorbell(id: "bell-front", name: "Brána", cameraName: nil, lockId: "lock-front"),
        ]
        home.climate = [
            thermostat("c-obyvak", "Obývák", "obyvak", 21.6, 22),
            thermostat("c-kuchyne", "Kuchyně", "kuchyne", 21.4, 21),
            thermostat("c-jidelna", "Jídelna", "jidelna", 21.2, 21.5),
            thermostat("c-knihovna", "Knihovna", "knihovna", 20.8, 21),
            thermostat("c-loznice", "Ložnice", "loznice", 19.6, 19.5),
            thermostat("c-pokoj", "Pokoj pro hosty", "pokoj", 18.2, 18),
            thermostat("c-koupelna", "Koupelna", "koupelna", 22.4, 24),
            thermostat("c-pracovna", "Pracovna", "pracovna", 20.4, 21),
            thermostat("c-klub", "Klub", "klub", 18.8, 19),
            thermostat("c-fitko", "Fitko", "fitko", 17.6, 18),
        ]
        home.modes = [
            HomeMode(id: "heat-mode", name: "Topení v domě", kind: "heating", value: "individual", options: [
                ModeOption(id: "on", name: "Zapnuto"),
                ModeOption(id: "individual", name: "Individuální"),
                ModeOption(id: "eco", name: "Útlum"),
                ModeOption(id: "off", name: "Vypnuto"),
            ]),
        ]
        home.switches = [
            HomeSwitch(id: "sw-sauna", name: "Sauna", roomId: "sauna", kind: "sauna", isOn: false, current: 24),
            HomeSwitch(id: "sw-pir", name: "Venkovní světla na pohyb", roomId: "zahrada", kind: "motion", isOn: true, current: nil),
        ]
        return home
    }
}
