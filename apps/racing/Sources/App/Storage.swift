import Foundation
import RaceCore
import Security

/// JSON-on-disk persistence. Sessions are one file each (they can be several MB of telemetry);
/// an index keeps the list screen fast.
struct Storage {
    let root: URL

    static let shared = Storage()

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        root = docs.appendingPathComponent("Apex", isDirectory: true)
        for dir in [root, sessionsDir, videosDir] {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }

    var sessionsDir: URL { root.appendingPathComponent("Sessions", isDirectory: true) }
    var videosDir: URL { root.appendingPathComponent("Videos", isDirectory: true) }

    private var encoder: JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.nonConformingFloatEncodingStrategy = .convertToString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
        return e
    }

    private var decoder: JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        d.nonConformingFloatDecodingStrategy = .convertFromString(positiveInfinity: "inf", negativeInfinity: "-inf", nan: "nan")
        return d
    }

    func save<T: Encodable>(_ value: T, as name: String) {
        let url = root.appendingPathComponent(name)
        if let data = try? encoder.encode(value) { try? data.write(to: url, options: .atomic) }
    }

    func load<T: Decodable>(_ type: T.Type, from name: String) -> T? {
        let url = root.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? decoder.decode(type, from: data)
    }

    func saveSession(_ s: Session) {
        if let data = try? encoder.encode(s) {
            try? data.write(to: sessionsDir.appendingPathComponent("\(s.id.uuidString).json"), options: .atomic)
        }
    }

    func loadSessions() -> [Session] {
        let files = (try? FileManager.default.contentsOfDirectory(at: sessionsDir, includingPropertiesForKeys: nil)) ?? []
        return files.filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(Session.self, from: Data(contentsOf: $0)) }
            .sorted { $0.startDate > $1.startDate }
    }

    func deleteSession(_ s: Session) {
        try? FileManager.default.removeItem(at: sessionsDir.appendingPathComponent("\(s.id.uuidString).json"))
        if let v = s.video { try? FileManager.default.removeItem(at: videosDir.appendingPathComponent(v.fileName)) }
    }
}

/// Minimal Keychain wrapper for the Claude API key.
enum Keychain {
    private static let service = "ai.openclaw.apex"

    static func set(_ value: String, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }
}
