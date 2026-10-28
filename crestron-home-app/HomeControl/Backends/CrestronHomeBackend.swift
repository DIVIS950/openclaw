import Foundation

/// Talks to a Crestron Home OS processor through its local REST API
/// (`https://<processor>/cws/api`). Endpoint paths and field names follow traffic
/// verified against real processors by the open-source CH2HA integration.
///
/// Auth works in two steps: the Web API token from the Crestron Home setup app is sent
/// once to `/login`, which returns an `authkey` used on every other call. The key
/// expires after ~10 idle minutes; a 401/511 means "log in again".
@MainActor
final class CrestronHomeBackend: HomeBackend {
    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = .seconds(4)

    private let host: String
    private let token: String
    private let session: URLSession
    private var authKey: String?

    /// Scene types Crestron Home uses for relays, gates and other momentary I/O.
    private static let ioSceneTypes: Set<String> = ["genericio", "generic i/o", "i/o"]
    private static let rawMax = 65535.0

    init(host: String, token: String) {
        let cleanHost = host
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.host = cleanHost
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10
        session = URLSession(configuration: config, delegate: ProcessorTrustDelegate(host: cleanHost), delegateQueue: nil)
    }

    func connect() async throws {
        guard !host.isEmpty, !token.isEmpty else {
            throw BackendError.notConfigured("Enter the processor address and Web API token in Settings.")
        }
        try await login()
    }

    func disconnect() {
        authKey = nil
        session.invalidateAndCancel()
    }

    // MARK: Reading

    func fetch() async throws -> HomeSnapshot {
        // Rooms and lights must work; the rest depends on what the system has.
        async let roomsRaw = list("/rooms", key: "rooms", required: true)
        async let lightsRaw = list("/lights", key: "lights", required: true)
        async let shadesRaw = list("/shades", key: "shades")
        async let scenesRaw = list("/scenes", key: "scenes")
        async let mediaRaw = list("/mediarooms", key: "mediaRooms")
        async let locksRaw = list("/doorlocks", key: "doorLocks")
        async let securityRaw = list("/securitydevices", key: "securityDevices")
        async let sensorsRaw = list("/sensors", key: "sensors")

        var home = HomeSnapshot()
        home.rooms = try await roomsRaw.compactMap { d -> Room? in
            guard let id = Self.idString(d["id"]) else { return nil }
            return Room(id: id, name: d["name"] as? String ?? "Room \(id)")
        }
        home.lights = try await lightsRaw.compactMap { d -> Light? in
            guard let id = Self.idString(d["id"]) else { return nil }
            let subType = (d["subType"] as? String ?? "").lowercased()
            return Light(
                id: id,
                name: d["name"] as? String ?? "Light",
                roomId: Self.idString(d["roomId"]),
                level: (Self.number(d["level"]) ?? 0) / Self.rawMax,
                isDimmable: !subType.contains("switch"),
                isOnline: Self.isOnline(d)
            )
        }
        home.shades = try await shadesRaw.compactMap { d -> Shade? in
            guard let id = Self.idString(d["id"]) else { return nil }
            return Shade(
                id: id,
                name: d["name"] as? String ?? "Shade",
                roomId: Self.idString(d["roomId"]),
                position: (Self.number(d["position"]) ?? 0) / Self.rawMax,
                isOnline: Self.isOnline(d)
            )
        }

        let sensors: [HomeSensor] = try await sensorsRaw.compactMap { d -> HomeSensor? in
            guard let id = Self.idString(d["id"]) else { return nil }
            return HomeSensor(
                id: id,
                name: d["name"] as? String ?? "Sensor",
                roomId: Self.idString(d["roomId"]),
                kind: d["subType"] as? String ?? "",
                isActive: Self.presenceIsActive(d["presence"])
            )
        }
        home.sensors = sensors

        for d in try await scenesRaw {
            guard let id = Self.idString(d["id"]) else { continue }
            let name = d["name"] as? String ?? "Scene"
            let type = (d["type"] as? String ?? "").lowercased()
            if Self.ioSceneTypes.contains(type) {
                // Relay / gate trigger. Use a sensor with a matching name for open/closed status.
                let sensor = sensors.first { $0.name.localizedCaseInsensitiveContains(name) }
                    ?? sensors.first { $0.name.localizedCaseInsensitiveContains("gate") }
                home.gates.append(Gate(
                    id: id,
                    name: name,
                    state: sensor.map { $0.isActive ? .open : .closed } ?? .unknown,
                    hasSeparateOpenClose: false,
                    canStop: false
                ))
            } else {
                home.scenes.append(HomeScene(
                    id: id,
                    name: name,
                    roomId: Self.idString(d["roomId"]),
                    kind: Self.sceneKind(type),
                    isActive: d["status"] as? Bool ?? false
                ))
            }
        }

        home.media = try await mediaRaw.compactMap { d -> MediaZone? in
            guard let id = Self.idString(d["id"]) else { return nil }
            let sources = (d["availableSources"] as? [[String: Any]] ?? []).compactMap { s -> MediaSource? in
                guard let sid = Self.idString(s["id"]) else { return nil }
                return MediaSource(id: sid, name: s["sourceName"] as? String ?? "Source \(sid)")
            }
            let volumeControls = (d["availableVolumeControls"] as? [Any] ?? []).map { "\($0)".lowercased() }
            return MediaZone(
                id: id,
                name: d["name"] as? String ?? "Media",
                roomId: Self.idString(d["roomId"]) ?? id,
                isOn: (d["currentPowerState"] as? String ?? "").lowercased() == "on",
                volume: ((Self.number(d["currentVolumeLevel"]) ?? 0) / Self.rawMax).clamped01,
                isMuted: (d["currentMuteState"] as? String ?? "").lowercased() == "muted",
                hasVolume: !volumeControls.contains("none"),
                sources: sources,
                currentSourceId: Self.idString(d["currentSourceId"])
            )
        }

        home.locks = try await locksRaw.compactMap { d -> DoorLock? in
            guard let id = Self.idString(d["id"]) else { return nil }
            // Firmware reports "Locked"/"Unlocked"; the docs show lowercase. Compare loosely.
            let status = (d["status"] as? String ?? "").lowercased()
            return DoorLock(
                id: id,
                name: d["name"] as? String ?? "Lock",
                roomId: Self.idString(d["roomId"]),
                isLocked: status == "locked" ? true : status == "unlocked" ? false : nil
            )
        }

        home.security = try await securityRaw.compactMap { d -> SecurityPanel? in
            guard let id = Self.idString(d["id"]) else { return nil }
            return SecurityPanel(
                id: id,
                name: d["name"] as? String ?? "Security",
                mode: Self.securityMode(d["currentState"] as? String)
            )
        }
        return home
    }

    // MARK: Commands

    func perform(_ command: HomeCommand) async throws {
        switch command {
        case let .setLight(id, level):
            try await post("/lights/SetState", body: ["lights": [["id": Self.jsonId(id), "level": Self.raw(level), "time": 0]]])
        case let .setShade(id, position):
            try await post("/shades/SetState", body: ["shades": [["id": Self.jsonId(id), "position": Self.raw(position)]]])
        case .stopShade:
            throw BackendError.notSupported("Stopping shades")
        case let .recallScene(id):
            try await post("/scenes/recall/\(id)")
        case let .mediaPower(id, on):
            try await post("/mediarooms/\(id)/power/\(on ? "on" : "off")")
        case let .mediaVolume(id, level):
            // Volume is written as 0-100 percent (not the 0-65535 scale it reads back in).
            try await post("/mediarooms/\(id)/volume/\(Int((level.clamped01 * 100).rounded()))")
        case let .mediaMute(id, muted):
            try await post("/mediarooms/\(id)/\(muted ? "mute" : "unmute")")
        case let .mediaSource(id, sourceId):
            try await post("/mediarooms/\(id)/selectsource/\(sourceId)")
        case let .setLock(id, locked):
            try await post("/doorlocks/\(locked ? "lock" : "unlock")/\(id)")
        case let .setSecurity(id, mode, code):
            let verb: String
            switch mode {
            case .armedAway: verb = "armaway"
            case .armedHome: verb = "armhome"
            case .disarmed: verb = "disarm"
            case .alarm, .unknown: throw BackendError.notSupported("That security mode")
            }
            try await post("/securitydevices/\(verb)/\(id)", body: ["code": code ?? ""])
        case let .gate(id, action):
            // Crestron Home gates are momentary I/O scenes: recalling one pulses the relay.
            guard action != .stop else { throw BackendError.notSupported("Stopping the gate") }
            try await post("/scenes/recall/\(id)")
        }
    }

    // MARK: HTTP

    private func login() async throws {
        var request = URLRequest(url: try url("/login"))
        request.setValue(token, forHTTPHeaderField: "Crestron-RestAPI-AuthToken")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, status) = try await send(request)
        guard status == 200 else {
            throw BackendError.http(status, "Login failed. Check the Web API token (it changes after some firmware updates).")
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        // The docs say `AuthKey`, real processors send `authkey`.
        guard let key = (json["authkey"] ?? json["AuthKey"]) as? String, !key.isEmpty else {
            throw BackendError.badResponse("Login returned no auth key. Is the Web API enabled in Crestron Home?")
        }
        authKey = key
    }

    @discardableResult
    private func post(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        try await call("POST", path, body: body)
    }

    private func list(_ path: String, key: String, required: Bool = false) async throws -> [[String: Any]] {
        do {
            return try await call("GET", path)[key] as? [[String: Any]] ?? []
        } catch BackendError.notSupported where !required {
            return []
        } catch BackendError.http(let status, _) where !required && status != 401 && status != 511 {
            return []
        }
    }

    private func call(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        if authKey == nil { try await login() }
        var (data, status) = try await send(makeRequest(method, path, body: body))
        if status == 401 || status == 511 {
            authKey = nil
            try await login()
            (data, status) = try await send(makeRequest(method, path, body: body))
        }
        let text = String(decoding: data, as: UTF8.self)
        // Unknown paths answer HTTP 200 with a text banner instead of a 404.
        if text.contains("Pyng Rest API") || text.contains("Refer to the user") {
            throw BackendError.notSupported(path)
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (200..<300).contains(status) else {
            throw BackendError.http(status, json?["errorMessage"] as? String ?? String(text.prefix(160)))
        }
        return json ?? [:]
    }

    private func makeRequest(_ method: String, _ path: String, body: [String: Any]?) throws -> URLRequest {
        var request = URLRequest(url: try url(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authKey { request.setValue(authKey, forHTTPHeaderField: "Crestron-RestAPI-AuthKey") }
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send(_ request: URLRequest) async throws -> (Data, Int) {
        do {
            let (data, response) = try await session.data(for: request)
            return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw BackendError.connection("Can't reach the processor at \(host): \(error.localizedDescription)")
        }
    }

    private func url(_ path: String) throws -> URL {
        guard let url = URL(string: "https://\(host)/cws/api\(path)") else {
            throw BackendError.notConfigured("“\(host)” isn't a valid processor address.")
        }
        return url
    }

    // MARK: Parsing helpers (ids and numbers come back as Int or String depending on firmware)

    private static func idString(_ value: Any?) -> String? {
        switch value {
        case let s as String: return s.isEmpty ? nil : s
        case let n as NSNumber: return n.stringValue
        default: return nil
        }
    }

    private static func number(_ value: Any?) -> Double? {
        switch value {
        case let n as NSNumber: return n.doubleValue
        case let s as String: return Double(s)
        default: return nil
        }
    }

    private static func jsonId(_ id: String) -> Any { Int(id).map { $0 as Any } ?? id }

    private static func raw(_ fraction: Double) -> Int { Int((fraction.clamped01 * rawMax).rounded()) }

    private static func isOnline(_ d: [String: Any]) -> Bool {
        (d["connectionStatus"] as? String)?.lowercased() != "offline"
    }

    private static func sceneKind(_ type: String) -> SceneKind {
        if type.contains("light") { return .lighting }
        if type.contains("shade") { return .shades }
        if type.contains("media") { return .media }
        if type.contains("climate") || type.contains("thermostat") { return .climate }
        return .other
    }

    private static func securityMode(_ state: String?) -> SecurityMode {
        let s = (state ?? "").lowercased()
        if s.contains("alarm") { return .alarm }
        if s.contains("away") { return .armedAway }
        if s.contains("home") || s.contains("stay") { return .armedHome }
        if s.contains("disarm") { return .disarmed }
        return .unknown
    }

    /// Sensors report "Open"/"Closed", "Present"/"Vacant", or combined "OpenOrOn"/"CloseOrOff".
    private static func presenceIsActive(_ value: Any?) -> Bool {
        let s = "\(value ?? "")".lowercased().replacingOccurrences(of: " ", with: "").replacingOccurrences(of: "_", with: "")
        return ["present", "occupied", "open", "on", "openoron"].contains(s)
    }
}

/// Crestron processors use self-signed certificates. Accept them only for the processor
/// address typed in Settings; every other host gets normal certificate checks.
final class ProcessorTrustDelegate: NSObject, URLSessionDelegate {
    private let host: String

    init(host: String) {
        self.host = host.split(separator: ":").first.map(String.init) ?? host
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              challenge.protectionSpace.host.caseInsensitiveCompare(host) == .orderedSame,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
}
