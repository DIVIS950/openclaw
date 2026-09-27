import Foundation
import Observation
import RaceCore

enum GPSSourceMode: String, Codable, CaseIterable, Identifiable {
    case phone, raceBox, nmea
    var id: String { rawValue }
    var title: String {
        switch self {
        case .phone: "iPhone GPS + motion fusion"
        case .raceBox: "RaceBox (25 Hz)"
        case .nmea: "Bluetooth NMEA receiver"
        }
    }
}

struct AppSettings: Codable, Equatable {
    var gpsSource: GPSSourceMode = .phone
    var voiceDelta = true
    var voiceLapTimes = true
    var goProAutoRecord = true
    var selectedVehicleID: UUID?
    /// Seconds the delta bar spans at full scale.
    var deltaBarRange = 1.0

    init() {}

    /// Tolerant decoding so settings saved by older versions keep loading when fields are added.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = AppSettings()
        gpsSource = try c.decodeIfPresent(GPSSourceMode.self, forKey: .gpsSource) ?? d.gpsSource
        voiceDelta = try c.decodeIfPresent(Bool.self, forKey: .voiceDelta) ?? d.voiceDelta
        voiceLapTimes = try c.decodeIfPresent(Bool.self, forKey: .voiceLapTimes) ?? d.voiceLapTimes
        goProAutoRecord = try c.decodeIfPresent(Bool.self, forKey: .goProAutoRecord) ?? d.goProAutoRecord
        selectedVehicleID = try c.decodeIfPresent(UUID.self, forKey: .selectedVehicleID)
        deltaBarRange = try c.decodeIfPresent(Double.self, forKey: .deltaBarRange) ?? d.deltaBarRange
    }
}

/// App-wide state: tracks, sessions, vehicles and settings.
@MainActor
@Observable
final class AppModel {
    private let storage = Storage.shared

    var settings: AppSettings { didSet { storage.save(settings, as: "settings.json") } }
    var vehicles: [Vehicle] { didSet { storage.save(vehicles, as: "vehicles.json") } }
    /// User edits to built-in tracks (gates, sectors) and user-created tracks, keyed by id.
    private var trackOverrides: [String: Track] { didSet { storage.save(trackOverrides, as: "tracks.json") } }
    private(set) var sessions: [Session] = []

    let coach = CoachService()
    let goPro = GoProService()

    init() {
        settings = storage.load(AppSettings.self, from: "settings.json") ?? AppSettings()
        vehicles = storage.load([Vehicle].self, from: "vehicles.json")
            ?? [Vehicle(name: "My car", vehicleClass: .car), Vehicle(name: "My kart", vehicleClass: .kart)]
        trackOverrides = storage.load([String: Track].self, from: "tracks.json") ?? [:]
        sessions = storage.loadSessions()
    }

    // MARK: Tracks

    var tracks: [Track] {
        let builtIn = TrackCatalog.all.map { trackOverrides[$0.id] ?? $0 }
        let custom = trackOverrides.values.filter { t in !TrackCatalog.all.contains { $0.id == t.id } }
        return (builtIn + custom).sorted { $0.name < $1.name }
    }

    func track(id: String) -> Track? { tracks.first { $0.id == id } }

    func saveTrack(_ t: Track) { trackOverrides[t.id] = t }

    func resetTrack(_ t: Track) { trackOverrides[t.id] = nil }

    // MARK: Vehicles

    var selectedVehicle: Vehicle? {
        vehicles.first { $0.id == settings.selectedVehicleID } ?? vehicles.first
    }

    // MARK: Sessions

    func save(_ session: Session) {
        storage.saveSession(session)
        if let i = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[i] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }

    func delete(_ session: Session) {
        storage.deleteSession(session)
        sessions.removeAll { $0.id == session.id }
    }

    func sessions(for trackID: String) -> [Session] { sessions.filter { $0.trackID == trackID } }

    /// All-time best lap at a track (used as the default live delta reference).
    func bestLap(trackID: String, vehicleClass: VehicleClass? = nil) -> Lap? {
        sessions(for: trackID)
            .filter { vehicleClass == nil || $0.vehicle?.vehicleClass == vehicleClass }
            .compactMap(\.bestLap)
            .min { $0.time < $1.time }
    }

    var videosDir: URL { storage.videosDir }
}
