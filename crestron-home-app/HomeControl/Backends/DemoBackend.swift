import Foundation

/// A pretend house so the app can be tried (and designed) without a processor.
@MainActor
final class DemoBackend: HomeBackend {
    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = nil

    private var state = DemoBackend.sampleHome()

    func connect() async throws {
        try await Task.sleep(for: .milliseconds(300))
    }

    func disconnect() {}

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

    private var lastGateEnd: [String: GateState] = ["gate-drive": .closed]
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
        "src-cable": [NowPlaying(title: "Evening News", artist: "Channel 7", album: "Cable TV")],
        "src-radio": [NowPlaying(title: "Morning Jazz", artist: "Radio 88.5", album: "Radio")],
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
        for i in state.scenes.indices { state.scenes[i].isActive = state.scenes[i].id == id }
        switch id {
        case "s-welcome": setLights(nil, 0.7)
        case "s-goodnight":
            setLights(nil, 0)
            for i in state.locks.indices { state.locks[i].isLocked = true }
            mediaOff()
        case "s-away":
            setLights(nil, 0)
            mediaOff()
            for i in state.security.indices { state.security[i].mode = .armedAway }
        case "s-movie":
            setLights("living", 0.12)
            for i in state.shades.indices where state.shades[i].roomId == "living" { state.shades[i].position = 0 }
            if let i = state.media.firstIndex(where: { $0.id == "m-living" }) {
                state.media[i].isOn = true
                state.media[i].currentSourceId = "src-appletv"
                state.media[i].isPlaying = true
                state.media[i].nowPlaying = Self.track("src-appletv")
            }
        case "s-dinner": setLights("dining", 0.45); setLights("kitchen", 0.6)
        case "s-bright-kitchen": setLights("kitchen", 1)
        case "s-read": setLights("master", 0.35)
        default: break
        }
    }

    static func sampleHome() -> HomeSnapshot {
        let rooms = [
            Room(id: "living", name: "Living Room"),
            Room(id: "kitchen", name: "Kitchen"),
            Room(id: "dining", name: "Dining Room"),
            Room(id: "master", name: "Master Bedroom"),
            Room(id: "office", name: "Office"),
            Room(id: "patio", name: "Patio"),
            Room(id: "entry", name: "Entry"),
        ]
        let sources = [
            MediaSource(id: "src-appletv", name: "Apple TV"),
            MediaSource(id: "src-spotify", name: "Spotify"),
            MediaSource(id: "src-cable", name: "Cable TV"),
            MediaSource(id: "src-radio", name: "Radio"),
        ]
        return HomeSnapshot(
            rooms: rooms,
            lights: [
                Light(id: "l1", name: "Ceiling", roomId: "living", level: 0.8),
                Light(id: "l2", name: "Floor Lamp", roomId: "living", level: 0.4),
                Light(id: "l3", name: "Cove", roomId: "living", level: 0),
                Light(id: "l4", name: "Pendants", roomId: "kitchen", level: 1),
                Light(id: "l5", name: "Under Cabinet", roomId: "kitchen", level: 0.6),
                Light(id: "l6", name: "Chandelier", roomId: "dining", level: 0),
                Light(id: "l7", name: "Bedside", roomId: "master", level: 0.3),
                Light(id: "l8", name: "Ceiling", roomId: "master", level: 0),
                Light(id: "l9", name: "Desk", roomId: "office", level: 0.9),
                Light(id: "l10", name: "String Lights", roomId: "patio", level: 0, isDimmable: false),
                Light(id: "l11", name: "Foyer", roomId: "entry", level: 0.5),
            ],
            shades: [
                Shade(id: "sh1", name: "Window Shades", roomId: "living", position: 1, supportsStop: true),
                Shade(id: "sh2", name: "Blackout", roomId: "master", position: 0, supportsStop: true),
                Shade(id: "sh3", name: "Sheers", roomId: "master", position: 0.5),
                Shade(id: "sh4", name: "Office Blinds", roomId: "office", position: 0.7),
            ],
            scenes: [
                HomeScene(id: "s-welcome", name: "Welcome", kind: .lighting),
                HomeScene(id: "s-goodnight", name: "Good Night", kind: .lighting),
                HomeScene(id: "s-away", name: "Away", kind: .other),
                HomeScene(id: "s-movie", name: "Movie Time", roomId: "living", kind: .media),
                HomeScene(id: "s-dinner", name: "Dinner", roomId: "dining", kind: .lighting),
                HomeScene(id: "s-bright-kitchen", name: "Cooking", roomId: "kitchen", kind: .lighting),
                HomeScene(id: "s-read", name: "Reading", roomId: "master", kind: .lighting),
            ],
            media: [
                MediaZone(id: "m-living", name: "Living Room", roomId: "living", isOn: true, volume: 0.35,
                          isMuted: false, sources: sources, currentSourceId: "src-appletv",
                          isPlaying: true, canTransport: true, nowPlaying: track("src-appletv")),
                MediaZone(id: "m-kitchen", name: "Kitchen", roomId: "kitchen", isOn: true, volume: 0.25,
                          isMuted: false, sources: sources, currentSourceId: "src-spotify",
                          isPlaying: true, canTransport: true, nowPlaying: track("src-spotify")),
                MediaZone(id: "m-master", name: "Master Bedroom", roomId: "master", isOn: false, volume: 0.2,
                          isMuted: false, sources: sources, currentSourceId: nil, canTransport: true),
                MediaZone(id: "m-patio", name: "Patio", roomId: "patio", isOn: false, volume: 0.5,
                          isMuted: false, sources: sources, currentSourceId: nil, canTransport: true),
            ],
            locks: [
                DoorLock(id: "lock-front", name: "Front Door", roomId: "entry", isLocked: true),
                DoorLock(id: "lock-patio", name: "Patio Door", roomId: "patio", isLocked: false),
            ],
            security: [
                SecurityPanel(id: "alarm", name: "House Alarm", mode: .disarmed),
            ],
            gates: [
                Gate(id: "gate-drive", name: "Driveway Gate", state: .closed, hasSeparateOpenClose: true, canStop: true),
            ],
            sensors: [
                HomeSensor(id: "sen1", name: "Entry Motion", roomId: "entry", kind: "OccupancySensor", isActive: false),
            ],
            doorbells: [
                Doorbell(id: "bell-front", name: "Front Door", cameraName: "Front Door", lockId: "lock-front"),
            ]
        )
    }
}
