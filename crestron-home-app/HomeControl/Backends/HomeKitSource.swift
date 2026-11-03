import Foundation
import HomeKit

/// The Matter and HomeKit accessories the owner added in Apple Home, read and controlled
/// through HomeKit on this iPad (no bridge, no server). Lights, outlets and switches,
/// window coverings, thermostats, locks and TVs are mapped; the rest stays in the Home app.
///
/// Ids: "hk:<accessory uuid>:<service uuid>"; rooms "hk:room:<uuid>". Changes arrive by
/// push (HomeKit notifications), so there is no polling after the first read.
@MainActor
final class HomeKitSource: HomeBackend {
    static let sourceName = "homekit"
    static let idPrefix = "hk:"
    static let origin = "homekit"

    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = nil

    private var manager: HMHomeManager?
    private let relay = HomeKitRelay()
    private var homesLoaded = false
    private var publishScheduled = false
    /// Characteristics already subscribed to, by uuid, so each is set up once.
    private var watched: Set<UUID> = []
    /// Debounced writes for dimmers and shades, by characteristic uuid.
    private var pendingWrites: [UUID: Task<Void, Never>] = [:]

    init() {
        relay.onHomesChanged = { [weak self] in self?.homesChanged() }
        relay.onValueChanged = { [weak self] in self?.schedulePublish() }
        relay.onAuthorization = { [weak self] in self?.authorizationChanged() }
    }

    func connect() async throws {
        if manager == nil {
            // Creating the manager is what makes iPadOS ask for Home access the first time.
            let created = HMHomeManager()
            created.delegate = relay
            manager = created
        }
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            if let problem = authorizationProblem() { throw BackendError.notConfigured(problem) }
            if homesLoaded { return }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw BackendError.connection(L("Apple Home didn't answer. Open the Home app once, then try again."))
    }

    func disconnect() {
        for task in pendingWrites.values { task.cancel() }
        pendingWrites.removeAll()
        if let manager {
            for home in manager.homes {
                home.delegate = nil
                for accessory in home.accessories { accessory.delegate = nil }
            }
            manager.delegate = nil
        }
        manager = nil
        homesLoaded = false
        watched.removeAll()
    }

    func fetch() async throws -> HomeSnapshot { snapshot() }

    // MARK: Updates from HomeKit

    private func homesChanged() {
        homesLoaded = true
        guard let manager else { return }
        for home in manager.homes {
            home.delegate = relay
            for accessory in home.accessories { accessory.delegate = relay }
        }
        subscribe()
        if authorizationProblem() == nil { onStatusChange?(.connected) }
        schedulePublish()
    }

    private func authorizationChanged() {
        if let problem = authorizationProblem() {
            onStatusChange?(.reconnecting(problem))
        } else if homesLoaded {
            onStatusChange?(.connected)
        }
    }

    /// "Not allowed…" when the person declined Home access (Settings › Privacy & Security › Home).
    private func authorizationProblem() -> String? {
        guard let manager else { return nil }
        let status = manager.authorizationStatus
        if status.contains(.restricted) || (status.contains(.determined) && !status.contains(.authorized)) {
            return L("Not allowed in Settings › Privacy › Home")
        }
        return nil
    }

    /// Reads every mapped characteristic once and asks for notifications on it.
    private func subscribe() {
        guard let manager else { return }
        for home in manager.homes {
            for accessory in home.accessories {
                for service in accessory.services where Self.mappedServices.contains(service.serviceType) {
                    for characteristic in service.characteristics where Self.readTypes.contains(characteristic.characteristicType) {
                        guard !watched.contains(characteristic.uniqueIdentifier) else { continue }
                        watched.insert(characteristic.uniqueIdentifier)
                        characteristic.enableNotification(true) { _ in }
                        characteristic.readValue { [weak self] _ in
                            Task { @MainActor in self?.schedulePublish() }
                        }
                    }
                }
            }
        }
    }

    private func schedulePublish() {
        // Many values arrive at once after the first read; publish once.
        guard !publishScheduled else { return }
        publishScheduled = true
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(80))
            guard let self else { return }
            self.publishScheduled = false
            self.onChange?(self.snapshot())
        }
    }

    private static let mappedServices: Set<String> = [
        HMServiceTypeLightbulb, HMServiceTypeOutlet, HMServiceTypeSwitch, HMServiceTypeWindowCovering,
        HMServiceTypeThermostat, HMServiceTypeLockMechanism, HMServiceTypeTelevision, HMServiceTypeInputSource,
    ]

    private static let readTypes: Set<String> = [
        HMCharacteristicTypePowerState, HMCharacteristicTypeBrightness,
        HMCharacteristicTypeCurrentPosition, HMCharacteristicTypeTargetPosition, HMCharacteristicTypePositionState,
        HMCharacteristicTypeCurrentTemperature, HMCharacteristicTypeTargetTemperature,
        HMCharacteristicTypeTargetHeatingCooling, HMCharacteristicTypeCurrentHeatingCooling,
        HMCharacteristicTypeCurrentLockMechanismState, HMCharacteristicTypeTargetLockMechanismState,
        HMCharacteristicTypeActive, HMCharacteristicTypeActiveIdentifier, HMCharacteristicTypeConfiguredName,
        HMCharacteristicTypeIdentifier, HMCharacteristicTypeCurrentVisibilityState, HMCharacteristicTypeIsConfigured,
        HMCharacteristicTypeCurrentMediaState,
    ]

    // MARK: HomeKit -> model

    private func snapshot() -> HomeSnapshot {
        var home = HomeSnapshot()
        guard let manager else { return home }
        var roomIds: Set<String> = []
        for hmHome in manager.homes {
            for accessory in hmHome.accessories {
                var mapped = false
                for service in accessory.services {
                    if map(service, of: accessory, into: &home) { mapped = true }
                }
                if mapped, let room = accessory.room {
                    let id = Self.roomId(room)
                    if !roomIds.contains(id) {
                        roomIds.insert(id)
                        home.rooms.append(Room(id: id, name: room.name, floor: nil, origin: Self.origin))
                    }
                }
            }
        }
        return home
    }

    private static func roomId(_ room: HMRoom) -> String { "hk:room:\(room.uniqueIdentifier.uuidString)" }

    /// Adds one service as a device. Returns false for service types the app doesn't show.
    private func map(_ service: HMService, of accessory: HMAccessory, into home: inout HomeSnapshot) -> Bool {
        let id = "hk:\(accessory.uniqueIdentifier.uuidString):\(service.uniqueIdentifier.uuidString)"
        let roomId = accessory.room.map(Self.roomId)
        // An accessory with two lights (say) gets the service name added, so both can be told apart.
        let sameType = accessory.services.filter { $0.serviceType == service.serviceType }.count
        let serviceName = service.name.trimmingCharacters(in: .whitespaces)
        let name = sameType > 1 && !serviceName.isEmpty && serviceName != accessory.name ? "\(accessory.name) \(serviceName)" : accessory.name
        let online = accessory.isReachable
        switch service.serviceType {
        case HMServiceTypeLightbulb:
            let brightness = characteristic(HMCharacteristicTypeBrightness, in: service)
            let on = Self.bool(characteristic(HMCharacteristicTypePowerState, in: service)) ?? false
            let level = on ? ((Self.number(brightness) ?? 100) / 100).clamped01 : 0
            home.lights.append(Light(id: id, name: name, roomId: roomId, level: level, isDimmable: brightness != nil,
                                     isOnline: online, origin: Self.origin))
        case HMServiceTypeOutlet, HMServiceTypeSwitch:
            let on = Self.bool(characteristic(HMCharacteristicTypePowerState, in: service)) ?? false
            home.switches.append(HomeSwitch(id: id, name: name, roomId: roomId, kind: "other", isOn: on, current: nil, origin: Self.origin))
        case HMServiceTypeWindowCovering:
            let current = Self.number(characteristic(HMCharacteristicTypeCurrentPosition, in: service))
            let target = Self.number(characteristic(HMCharacteristicTypeTargetPosition, in: service))
            // Position state: 0 going down, 1 going up, 2 stopped. While moving, show where it's going.
            let moving = Self.number(characteristic(HMCharacteristicTypePositionState, in: service)).map { $0 != 2 } ?? false
            let position = ((moving ? (target ?? current) : current) ?? 0) / 100
            home.shades.append(Shade(id: id, name: name, roomId: roomId, position: position.clamped01, supportsPosition: true,
                                     supportsStop: characteristic(HMCharacteristicTypeHoldPosition, in: service) != nil,
                                     isOnline: online, origin: Self.origin))
        case HMServiceTypeThermostat:
            let current = Self.number(characteristic(HMCharacteristicTypeCurrentTemperature, in: service))
            let targetCharacteristic = characteristic(HMCharacteristicTypeTargetTemperature, in: service)
            let target = Self.number(targetCharacteristic)
            // Target mode: 0 off, 1 heat, 2 cool, 3 auto. Current mode: 0 off, 1 heating, 2 cooling.
            let targetMode = Self.number(characteristic(HMCharacteristicTypeTargetHeatingCooling, in: service)) ?? 0
            let currentMode = Self.number(characteristic(HMCharacteristicTypeCurrentHeatingCooling, in: service))
            var heating: Bool? = currentMode.map { $0 == 1 }
            if heating == nil, let current, let target { heating = targetMode != 0 && current < target - 0.2 }
            let meta = targetCharacteristic?.metadata
            home.climate.append(Climate(id: id, name: name, roomId: roomId, current: current, target: target,
                                        minimum: meta?.minimumValue?.doubleValue ?? 10, maximum: meta?.maximumValue?.doubleValue ?? 38,
                                        step: meta?.stepValue?.doubleValue ?? 0.5, heating: heating, isOnline: online, origin: Self.origin))
        case HMServiceTypeLockMechanism:
            // 0 unsecured, 1 secured, 2 jammed, 3 unknown.
            let state = Self.number(characteristic(HMCharacteristicTypeCurrentLockMechanismState, in: service))
            let locked: Bool? = state == 1 ? true : (state == 0 ? false : nil)
            home.locks.append(DoorLock(id: id, name: name, roomId: roomId, isLocked: locked, origin: Self.origin))
        case HMServiceTypeTelevision:
            home.media.append(television(service, of: accessory, id: id, name: name, roomId: roomId))
        default:
            return false
        }
        return true
    }

    private func television(_ service: HMService, of accessory: HMAccessory, id: String, name: String, roomId: String?) -> MediaZone {
        let active = Self.number(characteristic(HMCharacteristicTypeActive, in: service)) == 1
        let activeId = Self.number(characteristic(HMCharacteristicTypeActiveIdentifier, in: service))
        // Inputs are separate services on the same accessory; hidden or unconfigured ones are skipped.
        let sources: [MediaSource] = accessory.services.filter { $0.serviceType == HMServiceTypeInputSource }.compactMap { input in
            guard let raw = Self.number(characteristic(HMCharacteristicTypeIdentifier, in: input)), let identifier = Int(exactly: raw) else { return nil }
            let hidden = Self.number(characteristic(HMCharacteristicTypeCurrentVisibilityState, in: input)) == 1
            let configured = Self.number(characteristic(HMCharacteristicTypeIsConfigured, in: input))
            if hidden || configured == 0 { return nil }
            let inputName = Self.string(characteristic(HMCharacteristicTypeConfiguredName, in: input)) ?? input.name
            return MediaSource(id: String(identifier), name: inputName)
        }
        // Media state: 0 playing, 1 paused, 2 stopped.
        let mediaState = Self.number(characteristic(HMCharacteristicTypeCurrentMediaState, in: service))
        let tvName = Self.string(characteristic(HMCharacteristicTypeConfiguredName, in: service)) ?? name
        return MediaZone(
            id: id, name: tvName.isEmpty ? name : tvName, roomId: roomId, isOn: active, volume: 0, isMuted: false, hasVolume: false,
            sources: sources, currentSourceId: activeId.flatMap { Int(exactly: $0) }.map { String($0) },
            isPlaying: active && (mediaState ?? 0) == 0, canTransport: true, nowPlaying: nil,
            kind: "tv", canRemote: true, apps: [], channel: nil, origin: Self.origin
        )
    }

    // MARK: Model -> HomeKit

    func perform(_ command: HomeCommand) async throws {
        let service = try findService(for: command.deviceId)
        switch command {
        case let .setLight(_, level):
            let power = try require(HMCharacteristicTypePowerState, in: service, what: L("This light"))
            if level > 0, let brightness = characteristic(HMCharacteristicTypeBrightness, in: service) {
                debounce(brightness, value: NSNumber(value: Swift.max(1, Int((level.clamped01 * 100).rounded()))))
                if Self.bool(power) != true { try await write(NSNumber(value: true), to: power) }
            } else {
                try await write(NSNumber(value: level > 0), to: power)
            }
        case let .setShade(_, position):
            let target = try require(HMCharacteristicTypeTargetPosition, in: service, what: L("This shade"))
            debounce(target, value: NSNumber(value: Int((position.clamped01 * 100).rounded())))
        case .stopShade:
            let hold = try require(HMCharacteristicTypeHoldPosition, in: service, what: L("Stopping this shade"))
            try await write(NSNumber(value: true), to: hold)
        case let .setClimate(_, target):
            let targetTemp = try require(HMCharacteristicTypeTargetTemperature, in: service, what: L("Setting this thermostat"))
            let low = targetTemp.metadata?.minimumValue?.doubleValue ?? 10
            let high = targetTemp.metadata?.maximumValue?.doubleValue ?? 38
            let step = targetTemp.metadata?.stepValue?.doubleValue ?? 0.5
            let size = step > 0 ? step : 0.5
            let snapped = (target / size).rounded() * size
            let value = Swift.min(high, Swift.max(low, snapped.isFinite ? snapped : low))
            try await write(NSNumber(value: value), to: targetTemp)
        case let .setLock(_, locked):
            let target = try require(HMCharacteristicTypeTargetLockMechanismState, in: service, what: L("This lock"))
            try await write(NSNumber(value: locked ? 1 : 0), to: target)
        case let .setSwitch(_, on):
            let power = try require(HMCharacteristicTypePowerState, in: service, what: L("This switch"))
            try await write(NSNumber(value: on), to: power)
        case let .mediaPower(_, on):
            let active = try require(HMCharacteristicTypeActive, in: service, what: L("Media power"))
            try await write(NSNumber(value: on ? 1 : 0), to: active)
        case let .mediaSource(_, sourceId):
            let active = try require(HMCharacteristicTypeActiveIdentifier, in: service, what: L("This input"))
            guard let identifier = Int(sourceId) else { throw BackendError.badResponse(L("Unknown source")) }
            try await write(NSNumber(value: identifier), to: active)
        case let .mediaTransport(_, action):
            switch action {
            case .play, .pause:
                if let state = characteristic(HMCharacteristicTypeTargetMediaState, in: service) {
                    try await write(NSNumber(value: action == .play ? 0 : 1), to: state)
                } else {
                    try await press(Self.remoteKeyPlayPause, in: service)
                }
            case .next: try await press(2, in: service)
            case .previous: try await press(3, in: service)
            }
        case let .tvKey(_, key):
            guard let code = Self.remoteKey(key) else { throw BackendError.notSupported(L("That button")) }
            try await press(code, in: service)
        case .mediaVolume, .mediaMute, .tvApp, .mediaChannel, .recallScene, .setSecurity, .gate, .setMode:
            throw BackendError.notSupported(L("That on Apple Home accessories"))
        }
    }

    private static let remoteKeyPlayPause = 11

    /// HomeKit remote keys (HMCharacteristicValueRemoteKey), by their raw values: 0 rewind,
    /// 1 fast forward, 4–7 arrows, 8 select, 9 back, 10 exit, 11 play/pause, 14 menu, 15 info.
    private static func remoteKey(_ key: TVKey) -> Int? {
        switch key {
        case .up: return 4
        case .down: return 5
        case .left: return 6
        case .right: return 7
        case .ok: return 8
        case .back: return 9
        case .exit: return 10
        case .play, .pause: return remoteKeyPlayPause
        case .menu, .home: return 14
        case .info, .guide: return 15
        case .rewind: return 0
        case .fastForward: return 1
        default: return nil
        }
    }

    private func press(_ code: Int, in service: HMService) async throws {
        let remote = try require(HMCharacteristicTypeRemoteKey, in: service, what: L("The TV remote"))
        try await write(NSNumber(value: code), to: remote)
    }

    private func write(_ value: NSNumber, to characteristic: HMCharacteristic) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            characteristic.writeValue(value) { error in
                if let error {
                    continuation.resume(throwing: BackendError.connection(error.localizedDescription))
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    /// Sliders send many values while dragging; only the last one in 180 ms reaches the accessory.
    private func debounce(_ characteristic: HMCharacteristic, value: NSNumber) {
        let key = characteristic.uniqueIdentifier
        pendingWrites[key]?.cancel()
        pendingWrites[key] = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            characteristic.writeValue(value) { _ in }
            self?.pendingWrites[key] = nil
        }
    }

    private func findService(for id: String) throws -> HMService {
        let parts = id.split(separator: ":")
        guard parts.count == 3, parts[0] == "hk", let manager else {
            throw BackendError.badResponse(L("“{id}” isn't an Apple Home accessory.", ["id": id]))
        }
        let accessoryId = String(parts[1]), serviceId = String(parts[2])
        for home in manager.homes {
            for accessory in home.accessories where accessory.uniqueIdentifier.uuidString == accessoryId {
                if let service = accessory.services.first(where: { $0.uniqueIdentifier.uuidString == serviceId }) { return service }
            }
        }
        throw BackendError.badResponse(L("This device isn't in the system anymore."))
    }

    private func require(_ type: String, in service: HMService, what: String) throws -> HMCharacteristic {
        guard let found = characteristic(type, in: service) else { throw BackendError.notSupported(what) }
        return found
    }

    private func characteristic(_ type: String, in service: HMService) -> HMCharacteristic? {
        service.characteristics.first { $0.characteristicType == type }
    }

    private static func number(_ characteristic: HMCharacteristic?) -> Double? {
        (characteristic?.value as? NSNumber)?.doubleValue
    }

    private static func bool(_ characteristic: HMCharacteristic?) -> Bool? {
        (characteristic?.value as? NSNumber)?.boolValue
    }

    private static func string(_ characteristic: HMCharacteristic?) -> String? {
        characteristic?.value as? String
    }
}

/// HomeKit's delegate callbacks, handed to the source as plain closures on the main actor.
/// HomeKit calls delegates on the main thread; the fallback covers anything else.
private final class HomeKitRelay: NSObject, HMHomeManagerDelegate, HMHomeDelegate, HMAccessoryDelegate {
    var onHomesChanged: (@MainActor () -> Void)?
    var onValueChanged: (@MainActor () -> Void)?
    var onAuthorization: (@MainActor () -> Void)?

    func homeManagerDidUpdateHomes(_ manager: HMHomeManager) { run(onHomesChanged) }
    func homeManagerDidUpdatePrimaryHome(_ manager: HMHomeManager) { run(onHomesChanged) }
    func homeManager(_ manager: HMHomeManager, didAdd home: HMHome) { run(onHomesChanged) }
    func homeManager(_ manager: HMHomeManager, didRemove home: HMHome) { run(onHomesChanged) }
    func homeManager(_ manager: HMHomeManager, didUpdate status: HMHomeManagerAuthorizationStatus) { run(onAuthorization) }

    func home(_ home: HMHome, didAdd accessory: HMAccessory) { run(onHomesChanged) }
    func home(_ home: HMHome, didRemove accessory: HMAccessory) { run(onHomesChanged) }
    func home(_ home: HMHome, didAdd room: HMRoom) { run(onHomesChanged) }
    func home(_ home: HMHome, didRemove room: HMRoom) { run(onHomesChanged) }
    func home(_ home: HMHome, didUpdateNameFor room: HMRoom) { run(onHomesChanged) }
    func home(_ home: HMHome, didUpdate room: HMRoom, for accessory: HMAccessory) { run(onHomesChanged) }

    func accessory(_ accessory: HMAccessory, service: HMService, didUpdateValueFor characteristic: HMCharacteristic) { run(onValueChanged) }
    func accessoryDidUpdateReachability(_ accessory: HMAccessory) { run(onValueChanged) }
    func accessoryDidUpdateName(_ accessory: HMAccessory) { run(onHomesChanged) }
    func accessory(_ accessory: HMAccessory, didUpdateNameFor service: HMService) { run(onHomesChanged) }

    private func run(_ body: (@MainActor () -> Void)?) {
        guard let body else { return }
        if Thread.isMainThread {
            MainActor.assumeIsolated(body)
        } else {
            DispatchQueue.main.async { MainActor.assumeIsolated(body) }
        }
    }
}
