import Foundation
import Observation
import SwiftUI

enum ConnectionMode: String, CaseIterable, Identifiable {
    case demo, crestronHome, customProgram

    var id: String { rawValue }

    var title: String {
        switch self {
        case .demo: L("Demo house")
        case .crestronHome: "Crestron Home"
        case .customProgram: L("Custom program")
        }
    }

    var explanation: String {
        switch self {
        case .demo:
            L("A pretend house so you can try the app without a processor.")
        case .crestronHome:
            L("For systems set up with the Crestron Home setup app (CP4-R, MC4-R, PRO4…). Uses the processor's built-in Web API.")
        case .customProgram:
            L("For systems your installer programmed in SIMPL, controlled today with Crestron Go. The app connects like a touch panel on its own IP ID and uses a join map.")
        }
    }
}

/// Light or dark look for Home View (the iPad design). Automatic follows the iPad.
enum Appearance: String, CaseIterable, Identifiable {
    case automatic, light, dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .automatic: L("Automatic")
        case .light: L("Light mode")
        case .dark: L("Dark mode")
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .automatic: nil
        case .light: .light
        case .dark: .dark
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

/// A Samsung TV reached over Wi-Fi. The pairing token the TV hands out lives in the Keychain.
struct SamsungTVConfig: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    /// IP address on the home network, e.g. 192.168.1.80.
    var host: String
    /// For turning it on from standby (wake-on-LAN). Optional.
    var mac: String = ""
    /// The room (from the main system) its tile sits in. Optional.
    var roomId: String? = nil

    var token: String {
        get { Keychain.read("samsungtv.\(id.uuidString)") ?? "" }
        nonmutating set { Keychain.write(newValue, for: "samsungtv.\(id.uuidString)") }
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
    var appearance: Appearance
    /// The app's language: Czech unless changed in Settings.
    var language: AppLanguage
    /// Anthropic API key for Ask Home (kept in the Keychain).
    var assistantKey: String
    /// Town or city for the weather and for sunrise/sunset schedules.
    var location: HomeLocation?
    /// Show the Matter and HomeKit accessories from Apple Home next to the main system.
    var homeKitEnabled: Bool
    /// Samsung TVs controlled directly over Wi-Fi.
    var samsungTVs: [SamsungTVConfig]

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
        appearance = Appearance(rawValue: d.string(forKey: Keys.appearance) ?? "") ?? .automatic
        let savedLanguage = AppLanguage(rawValue: d.string(forKey: Keys.language) ?? "") ?? .cs
        language = savedLanguage
        L10n.language = savedLanguage
        assistantKey = Keychain.read(Keys.assistantKey) ?? ""
        location = d.data(forKey: Keys.location).flatMap { try? JSONDecoder().decode(HomeLocation.self, from: $0) }
        homeKitEnabled = d.bool(forKey: Keys.homeKit)
        samsungTVs = (d.data(forKey: Keys.samsungTVs)).flatMap { try? JSONDecoder().decode([SamsungTVConfig].self, from: $0) } ?? []
    }

    /// Switches the app's language. The root view is rebuilt for it (see HomeControlApp).
    func setLanguage(_ newValue: AppLanguage) {
        L10n.language = newValue
        language = newValue
        defaults.set(newValue.rawValue, forKey: Keys.language)
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
        defaults.set(appearance.rawValue, forKey: Keys.appearance)
        defaults.set(language.rawValue, forKey: Keys.language)
        Keychain.write(assistantKey.trimmingCharacters(in: .whitespacesAndNewlines), for: Keys.assistantKey)
        if let location {
            defaults.set(try? JSONEncoder().encode(location), forKey: Keys.location)
        } else {
            defaults.removeObject(forKey: Keys.location)
        }
        defaults.set(homeKitEnabled, forKey: Keys.homeKit)
        defaults.set(try? JSONEncoder().encode(samsungTVs), forKey: Keys.samsungTVs)
    }

    /// True when the demo house is shown without a location: it uses a sample place and weather.
    var usesSamplePlace: Bool { location == nil && mode == .demo }

    /// The location to use. The demo house gets a sample place in this iPad's time zone,
    /// so sunrise and sunset look right.
    var effectiveLocation: HomeLocation? {
        if let location { return location }
        guard mode == .demo else { return nil }
        let lon = Double(TimeZone.current.secondsFromGMT()) / 240
        let unit: TemperatureUnit = Locale.current.measurementSystem == .us ? .fahrenheit : .celsius
        return HomeLocation(place: L("Demo town"), lat: 40, lon: lon, unit: unit)
    }

    /// IP IDs are written in hex in SIMPL (e.g. "03", "1A").
    var parsedIpId: UInt8? {
        let text = cipIpId.trimmingCharacters(in: .whitespaces).lowercased().replacingOccurrences(of: "0x", with: "")
        guard let value = UInt8(text, radix: 16), (0x03...0xFE).contains(value) else { return nil }
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
                throw BackendError.notConfigured(L("The IP ID must be a hex number from 03 to FE (e.g. 03 or 1A)."))
            }
            guard let port = UInt16(exactly: cipPort), port > 0 else {
                throw BackendError.notConfigured(L("The port must be between 1 and 65535."))
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
        static let appearance = "appearance"
        static let language = "language"
        static let assistantKey = "anthropic.apikey"
        static let location = "location"
        static let homeKit = "homekit.enabled"
        static let samsungTVs = "samsungtvs"
    }
}
