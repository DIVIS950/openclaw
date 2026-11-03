import Foundation
import Network

/// One Samsung (Tizen) TV on the home network, driven the way the SmartThings app and the
/// Home Assistant integration do it: a WebSocket on port 8002 for remote keys and apps, a
/// plain HTTP call on port 8001 for whether it's on, and wake-on-LAN to turn it on.
///
/// The first time, the TV shows an "Allow Home Control?" prompt; once accepted it hands out
/// a token that is saved and sent on later connections.
@MainActor
final class SamsungTVClient {
    enum State: Equatable {
        case idle, connecting, waitingForAllow, connected
        case failed(String)
    }

    let host: String
    let mac: String
    private(set) var token: String?
    private(set) var state: State = .idle
    /// nil until the TV has answered (or failed to) on port 8001.
    private(set) var powerOn: Bool?
    private(set) var deviceName: String?
    private(set) var installedApps: [MediaApp] = []
    var onChange: (() -> Void)?
    /// Called with the token the TV hands out after the person taps Allow.
    var onToken: ((String) -> Void)?

    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var listenTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var allowTask: Task<Void, Never>?
    private var wantsConnection = false

    init(host: String, mac: String, token: String?) {
        let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        self.host = cleanHost
        self.mac = mac.trimmingCharacters(in: .whitespacesAndNewlines)
        self.token = (token ?? "").isEmpty ? nil : token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        // The TV's certificate is self-signed: accept it for this host only.
        session = URLSession(configuration: config, delegate: ProcessorTrustDelegate(host: cleanHost), delegateQueue: nil)
    }

    /// Plain words for Settings: paired, waiting for the TV's Allow prompt, standby, not found.
    var statusText: String {
        switch state {
        case .waitingForAllow: return L("Waiting for Allow on the TV")
        case .connected: return L("Paired")
        case .connecting: return L("Looking for the TV…")
        case .idle: return powerOn == false ? L("Off (standby)") : L("Not found")
        case let .failed(reason):
            if powerOn == false { return L("Off (standby)") }
            return powerOn == nil ? L("Not found") : reason
        }
    }

    func start() {
        wantsConnection = true
        open()
    }

    func stop() {
        wantsConnection = false
        reconnectTask?.cancel()
        allowTask?.cancel()
        listenTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        state = .idle
    }

    /// Closes and reopens the socket (Settings › Pair), so the TV shows its Allow prompt again.
    func pair() {
        stop()
        start()
    }

    // MARK: Remote keys and apps

    /// One key press, e.g. "KEY_VOLUP".
    func send(key: String) async throws {
        let params: [String: Any] = ["Cmd": "Click", "DataOfCmd": key, "Option": "false", "TypeOfRemote": "SendRemoteKey"]
        try await send(json: ["method": "ms.remote.control", "params": params])
    }

    /// Opens an app by its Tizen id (Netflix 11101200001, YouTube 111299001912…).
    func launchApp(_ appId: String) async throws {
        let data: [String: Any] = ["action_type": "DEEP_LINK", "appId": appId]
        let params: [String: Any] = ["event": "ed.apps.launch", "to": "host", "data": data]
        try await send(json: ["method": "ms.channel.emit", "params": params])
    }

    /// Asks for the installed apps; the TV answers with an ed.installedApp.get event.
    func requestInstalledApps() {
        let params: [String: Any] = ["event": "ed.installedApp.get", "to": "host"]
        Task { [weak self] in
            try? await self?.send(json: ["method": "ms.channel.emit", "params": params])
        }
    }

    private func send(json: [String: Any]) async throws {
        guard let socket, state == .connected else { throw BackendError.connection(statusText) }
        let data = try JSONSerialization.data(withJSONObject: json)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    // MARK: Power

    /// Asks the TV on port 8001 whether it is on. Answers "on" or "standby"; no answer at all
    /// means it is fully off or not at this address.
    func refreshPower() async {
        guard let url = URL(string: "http://\(host):8001/api/v2/") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 2
        let before = powerOn
        do {
            let (data, _) = try await session.data(for: request)
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let device = json?["device"] as? [String: Any]
            let power = (device?["PowerState"] as? String ?? "").lowercased()
            // Older models answer without PowerState; answering at all means on.
            powerOn = power.isEmpty ? true : power == "on"
            if let name = device?["name"] as? String, !name.isEmpty {
                deviceName = name.replacingOccurrences(of: "[TV] ", with: "")
            }
        } catch {
            powerOn = nil
        }
        // Back from standby: reconnect right away instead of waiting for the retry.
        if powerOn == true, before != true, wantsConnection, socket == nil { open() }
        if powerOn != before { onChange?() }
    }

    /// Wake-on-LAN: the magic packet to the broadcast address and to the TV itself (needs the MAC).
    func wake() {
        guard let packet = Self.magicPacket(mac) else { return }
        for target in ["255.255.255.255", host] {
            let connection = NWConnection(host: NWEndpoint.Host(target), port: 9, using: .udp)
            connection.stateUpdateHandler = { newState in
                guard case .ready = newState else { return }
                connection.send(content: packet, completion: .contentProcessed { _ in connection.cancel() })
            }
            connection.start(queue: .main)
            // Give up quietly if the network never says ready.
            Task {
                try? await Task.sleep(for: .seconds(3))
                connection.cancel()
            }
        }
    }

    /// 6 × 0xFF then the MAC 16 times. The MAC may use ":" or "-" or nothing.
    static func magicPacket(_ mac: String) -> Data? {
        let hex = mac.replacingOccurrences(of: ":", with: "").replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
        guard hex.count == 12 else { return nil }
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        var packet = Data(repeating: 0xFF, count: 6)
        for _ in 0..<16 { packet.append(contentsOf: bytes) }
        return packet
    }

    // MARK: The socket

    private func open() {
        guard !host.isEmpty else {
            state = .failed(L("Enter the TV's IP address in Settings."))
            return
        }
        guard socket == nil else { return }
        let name = Data("Home Control".utf8).base64EncodedString()
        var text = "wss://\(host):8002/api/v2/channels/samsung.remote.control?name=\(name)"
        if let token { text += "&token=\(token)" }
        guard let url = URL(string: text) else {
            state = .failed(L("“{host}” isn't a valid TV address.", ["host": host]))
            return
        }
        let task = session.webSocketTask(with: url)
        socket = task
        state = .connecting
        onChange?()
        task.resume()
        listen(on: task)
        // Without a token the TV shows an Allow prompt; say so when no answer comes quickly.
        allowTask?.cancel()
        allowTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled, let self, self.socket === task, self.state == .connecting else { return }
            self.state = .waitingForAllow
            self.onChange?()
        }
    }

    private func listen(on task: URLSessionWebSocketTask) {
        listenTask?.cancel()
        listenTask = Task { [weak self] in
            while !Task.isCancelled {
                do {
                    let message = try await task.receive()
                    guard !Task.isCancelled, let self, task === self.socket else { return }
                    self.handle(message)
                } catch {
                    guard !Task.isCancelled, let self, task === self.socket else { return }
                    self.lost(error.localizedDescription)
                    return
                }
            }
        }
    }

    private func handle(_ message: URLSessionWebSocketTask.Message) {
        let data: Data
        switch message {
        case let .string(text): data = Data(text.utf8)
        case let .data(bytes): data = bytes
        @unknown default: return
        }
        guard let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let payload = json["data"] as? [String: Any]
        switch json["event"] as? String ?? "" {
        case "ms.channel.connect":
            if let fresh = payload?["token"] as? String, !fresh.isEmpty, fresh != token {
                token = fresh
                onToken?(fresh)
            }
            allowTask?.cancel()
            state = .connected
            onChange?()
            requestInstalledApps()
        case "ms.channel.unauthorized":
            state = .failed(L("The TV said no. Pair again and tap Allow on the TV."))
            onChange?()
        case "ms.channel.timeOut":
            state = .failed(L("The TV didn't answer the pairing in time. Try again."))
            onChange?()
        case "ed.installedApp.get":
            let list = payload?["data"] as? [[String: Any]] ?? []
            installedApps = list.compactMap { entry in
                guard let id = entry["appId"] as? String, !id.isEmpty, let name = entry["name"] as? String, !name.isEmpty else { return nil }
                return MediaApp(id: id, name: name)
            }
            onChange?()
        default:
            break
        }
    }

    private func lost(_ reason: String) {
        allowTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        // A closed socket right after opening means the TV is in standby or waiting for Allow.
        state = .failed(L("Can't reach the TV at {host}: {error}", ["host": host, "error": reason]))
        onChange?()
        guard wantsConnection else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self, self.wantsConnection, self.socket == nil else { return }
            self.open()
        }
    }
}
