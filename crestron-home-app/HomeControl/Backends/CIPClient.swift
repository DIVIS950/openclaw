import Foundation
import Network

/// Minimal Crestron-over-IP (CIP) client. It connects to the processor the same way a
/// touch panel or XPanel does (TCP 41794, one IP ID) and exchanges digital, analog and
/// serial joins. Packet layout follows the open-source python-cipclient project.
///
/// Every packet is: 1 byte type, 2 bytes big-endian payload length, payload.
/// Joins are 1-based in SIMPL but 0-based on the wire.
@MainActor
final class CIPClient {
    enum State: Equatable {
        case disconnected, connecting, registering, connected
        case failed(String)
    }

    var onStateChange: ((State) -> Void)?
    var onDigital: ((Int, Bool) -> Void)?
    var onAnalog: ((Int, Int) -> Void)?
    var onSerial: ((Int, String) -> Void)?

    private(set) var state: State = .disconnected {
        didSet { if state != oldValue { onStateChange?(state) } }
    }
    /// The processor said this IP ID isn't in its program; retrying won't help.
    private(set) var registrationRejected = false

    private let host: String
    private let port: UInt16
    private let ipId: UInt8
    private var connection: NWConnection?
    private var buffer = Data()
    private var heartbeatTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var wantsConnection = false

    init(host: String, port: UInt16 = 41794, ipId: UInt8) {
        self.host = host
        self.port = port
        self.ipId = ipId
    }

    func start() {
        wantsConnection = true
        registrationRejected = false
        openConnection()
    }

    func stop() {
        wantsConnection = false
        reconnectTask?.cancel()
        heartbeatTask?.cancel()
        connection?.cancel()
        connection = nil
        state = .disconnected
    }

    // MARK: Sending joins

    /// Digital join. `button` uses the touch-panel press/release style most programs expect.
    func setDigital(_ join: Int, _ value: Bool, button: Bool = true) {
        guard join > 0 else { return }
        let j = join - 1
        var high = UInt8((j >> 8) & 0x7F)
        if !value { high |= 0x80 }
        send([0x05, 0x00, 0x06, 0x00, 0x00, 0x03, button ? 0x27 : 0x00, UInt8(j & 0xFF), high])
    }

    /// Press and release, like tapping a button on a touch panel.
    func pulse(_ join: Int) {
        setDigital(join, true)
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            self?.setDigital(join, false)
        }
    }

    /// Analog join, 0...65535.
    func setAnalog(_ join: Int, _ value: Int) {
        guard join > 0 else { return }
        let j = join - 1
        let v = max(0, min(65535, value))
        send([0x05, 0x00, 0x08, 0x00, 0x00, 0x05, 0x14,
              UInt8((j >> 8) & 0xFF), UInt8(j & 0xFF),
              UInt8((v >> 8) & 0xFF), UInt8(v & 0xFF)])
    }

    func setSerial(_ join: Int, _ text: String) {
        guard join > 0 else { return }
        let j = join - 1
        let bytes = Array(text.utf8.prefix(240))
        let n = bytes.count
        var packet: [UInt8] = [0x12, 0x00, UInt8(8 + n), 0x00, 0x00, 0x00, UInt8(4 + n), 0x34,
                               UInt8((j >> 8) & 0xFF), UInt8(j & 0xFF), 0x03]
        packet += bytes
        send(packet)
    }

    // MARK: Connection

    private func openConnection() {
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            state = .failed("Invalid port \(port)")
            return
        }
        buffer.removeAll()
        let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        connection = conn
        state = .connecting
        // The connection runs on the main queue, so its callbacks are already on the main actor.
        conn.stateUpdateHandler = { [weak self] newState in
            MainActor.assumeIsolated { self?.handle(newState, on: conn) }
        }
        conn.start(queue: .main)
        receive(on: conn)
    }

    private func handle(_ newState: NWConnection.State, on conn: NWConnection) {
        guard conn === connection else { return }
        switch newState {
        case .ready:
            // The processor now sends 0x0F asking us to register our IP ID.
            state = .registering
        case let .failed(error):
            connectionLost("Can't connect to \(host): \(error.localizedDescription)")
        case let .waiting(error):
            connectionLost("Waiting for \(host): \(error.localizedDescription)")
        default:
            break
        }
    }

    private func connectionLost(_ reason: String) {
        heartbeatTask?.cancel()
        connection?.cancel()
        connection = nil
        state = .failed(reason)
        guard wantsConnection, !registrationRejected else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled, let self, self.wantsConnection else { return }
            self.openConnection()
        }
    }

    private func receive(on conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] data, _, isComplete, error in
            MainActor.assumeIsolated {
                guard let self, conn === self.connection else { return }
                if let data, !data.isEmpty {
                    self.buffer.append(data)
                    self.drainPackets()
                }
                if isComplete || error != nil {
                    self.connectionLost(error.map { "Connection closed: \($0.localizedDescription)" }
                        ?? "The processor closed the connection")
                    return
                }
                self.receive(on: conn)
            }
        }
    }

    private func send(_ bytes: [UInt8]) {
        guard let connection else { return }
        connection.send(content: Data(bytes), completion: .contentProcessed { _ in })
    }

    private func startHeartbeat() {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15))
                guard !Task.isCancelled, let self else { return }
                self.send([0x0D, 0x00, 0x02, 0x00, 0x00])
            }
        }
    }

    // MARK: Incoming packets

    private func drainPackets() {
        while buffer.count >= 3 {
            let header = [UInt8](buffer.prefix(3))
            let payloadLength = (Int(header[1]) << 8) | Int(header[2])
            guard buffer.count >= 3 + payloadLength else { return }
            let payload = [UInt8](buffer.dropFirst(3).prefix(payloadLength))
            buffer.removeFirst(3 + payloadLength)
            process(type: header[0], payload: payload)
        }
    }

    private func process(type: UInt8, payload p: [UInt8]) {
        switch type {
        case 0x0F:
            // Registration request: answer with our IP ID.
            send([0x01, 0x00, 0x0B, 0x00, 0x00, 0x00, 0x00, 0x00, ipId, 0x40, 0xFF, 0xFF, 0xF1, 0x01])
        case 0x02:
            if p.starts(with: [0xFF, 0xFF]) {
                registrationRejected = true
                wantsConnection = false
                heartbeatTask?.cancel()
                connection?.cancel()
                connection = nil
                state = .failed(String(format: "IP ID %02X isn't defined in the processor program. Ask your installer to add an XPanel on this IP ID.", Int(ipId)))
            } else {
                // Registered: ask for the current value of every join.
                send([0x05, 0x00, 0x05, 0x00, 0x00, 0x02, 0x03, 0x00])
                startHeartbeat()
                // Some programs never send the end-of-update marker; go live anyway.
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(3))
                    if let self, self.state == .registering { self.state = .connected }
                }
            }
        case 0x05:
            guard p.count >= 4 else { return }
            switch p[3] {
            case 0x00 where p.count >= 6:
                let join = (((Int(p[5]) & 0x7F) << 8) | Int(p[4])) + 1
                onDigital?(join, (p[5] & 0x80) == 0)
            case 0x14 where p.count >= 8:
                let join = ((Int(p[4]) << 8) | Int(p[5])) + 1
                onAnalog?(join, (Int(p[6]) << 8) | Int(p[7]))
            case 0x03 where p.count >= 5 && p[4] == 0x1C:
                // End of the initial update: acknowledge, and we're live.
                state = .connected
                send([0x05, 0x00, 0x05, 0x00, 0x00, 0x02, 0x03, 0x1D])
                send([0x0D, 0x00, 0x02, 0x00, 0x00])
            default:
                break
            }
        case 0x12:
            guard p.count >= 8 else { return }
            let join = ((Int(p[5]) << 8) | Int(p[6])) + 1
            onSerial?(join, String(decoding: p.dropFirst(8), as: UTF8.self))
        case 0x03:
            connectionLost("The processor ended the session")
        default:
            // 0x0D / 0x0E are heartbeats; anything else we don't need.
            break
        }
    }
}
