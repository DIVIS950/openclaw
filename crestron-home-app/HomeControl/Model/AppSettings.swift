import Foundation
import Observation

enum ConnectionMode: String, CaseIterable, Identifiable {
    case demo, crestronHome, customProgram

    var id: String { rawValue }

    var title: String {
        switch self {
        case .demo: "Demo house"
        case .crestronHome: "Crestron Home"
        case .customProgram: "Custom program"
        }
    }

    var explanation: String {
        switch self {
        case .demo:
            "A pretend house so you can try the app without a processor."
        case .crestronHome:
            "For systems set up with the Crestron Home setup app (CP4-R, MC4-R, PRO4…). Uses the processor's built-in Web API."
        case .customProgram:
            "For systems your installer programmed in SIMPL, controlled today with Crestron Go. The app connects like a touch panel on its own IP ID and uses a join map."
        }
    }
}

struct CameraConfig: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    /// A URL that returns a JPEG still, e.g. http://192.168.1.60/ISAPI/Streaming/channels/101/picture
    var snapshotURL: String
    var username: String = ""

    var password: String {
        get { Keychain.read("camera.\(id.uuidString)") ?? "" }
        nonmutating set { Keychain.write(newValue, for: "camera.\(id.uuidString)") }
    }
}

/// Everything the user configures. Plain values live in UserDefaults, secrets in the Keychain.
@MainActor
@Observable
final class AppSettings {
    var mode: ConnectionMode
    var host: String
    var apiToken: String
    var cipIpId: String
    var cipPort: Int
    var joinMapJSON: String
    var homeName: String
    var kioskMode: Bool
    var screensaverMinutes: Int
    var cameras: [CameraConfig]

    @ObservationIgnored private let defaults = UserDefaults.standard

    init() {
        let d = UserDefaults.standard
        mode = ConnectionMode(rawValue: d.string(forKey: Keys.mode) ?? "") ?? .demo
        host = d.string(forKey: Keys.host) ?? ""
        apiToken = Keychain.read(Keys.token) ?? ""
        cipIpId = d.string(forKey: Keys.ipId) ?? "03"
        cipPort = d.object(forKey: Keys.port) as? Int ?? 41794
        joinMapJSON = d.string(forKey: Keys.joinMap) ?? JoinMap.example
        homeName = d.string(forKey: Keys.homeName) ?? "Home"
        kioskMode = d.bool(forKey: Keys.kiosk)
        screensaverMinutes = d.object(forKey: Keys.saver) as? Int ?? 5
        cameras = (d.data(forKey: Keys.cameras)).flatMap { try? JSONDecoder().decode([CameraConfig].self, from: $0) } ?? []
    }

    func save() {
        defaults.set(mode.rawValue, forKey: Keys.mode)
        defaults.set(host, forKey: Keys.host)
        Keychain.write(apiToken, for: Keys.token)
        defaults.set(cipIpId, forKey: Keys.ipId)
        defaults.set(cipPort, forKey: Keys.port)
        defaults.set(joinMapJSON, forKey: Keys.joinMap)
        defaults.set(homeName, forKey: Keys.homeName)
        defaults.set(kioskMode, forKey: Keys.kiosk)
        defaults.set(screensaverMinutes, forKey: Keys.saver)
        defaults.set(try? JSONEncoder().encode(cameras), forKey: Keys.cameras)
    }

    /// IP IDs are written in hex in SIMPL (e.g. "03", "1A").
    var parsedIpId: UInt8? {
        let text = cipIpId.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "0x", with: "")
        guard let value = UInt8(text, radix: 16), value >= 0x03 else { return nil }
        return value
    }

    func makeBackend() throws -> HomeBackend {
        switch mode {
        case .demo:
            return DemoBackend()
        case .crestronHome:
            return CrestronHomeBackend(host: host, token: apiToken)
        case .customProgram:
            guard let ipId = parsedIpId else {
                throw BackendError.notConfigured("The IP ID must be a hex number from 03 to FE (e.g. 03 or 1A).")
            }
            guard let port = UInt16(exactly: cipPort) else {
                throw BackendError.notConfigured("The port must be between 1 and 65535.")
            }
            return CustomProgramBackend(host: host, ipId: ipId, port: port, map: try JoinMap.parse(joinMapJSON))
        }
    }

    private enum Keys {
        static let mode = "mode"
        static let host = "host"
        static let token = "crestron.webapi.token"
        static let ipId = "cip.ipid"
        static let port = "cip.port"
        static let joinMap = "cip.joinmap"
        static let homeName = "homeName"
        static let kiosk = "kioskMode"
        static let saver = "screensaverMinutes"
        static let cameras = "cameras"
    }
}
